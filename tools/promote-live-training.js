#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { EventEmitter } = require('events');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const livePromotionDir = path.join(repoRoot, 'tools', 'reports', 'live-promotion');
  const args = {
    pid: null,
    port: 9229,
    timeoutMs: 20000,
    exportFile: path.join(livePromotionDir, 'exported-bots.js'),
    summaryFile: path.join(livePromotionDir, 'snapshot-summary.json'),
    destination: path.join(repoRoot, 'runtime', 'js', 'bot-roster.js'),
    publish: true,
    publishReport: path.join(livePromotionDir, 'published-bots-report.json')
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pid' && argv[i + 1]) args.pid = Number(argv[++i]);
    else if (arg === '--port' && argv[i + 1]) args.port = Number(argv[++i]);
    else if (arg === '--timeout-ms' && argv[i + 1]) args.timeoutMs = Number(argv[++i]);
    else if (arg === '--export-file' && argv[i + 1]) args.exportFile = path.resolve(argv[++i]);
    else if (arg === '--summary-file' && argv[i + 1]) args.summaryFile = path.resolve(argv[++i]);
    else if (arg === '--destination' && argv[i + 1]) args.destination = path.resolve(argv[++i]);
    else if (arg === '--publish-report' && argv[i + 1]) args.publishReport = path.resolve(argv[++i]);
    else if (arg === '--no-publish') args.publish = false;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.help) {
    if (!Number.isInteger(args.pid) || args.pid <= 0) {
      throw new Error('A live Node training process id is required. Pass --pid <number>.');
    }
    if (!Number.isInteger(args.port) || args.port <= 0) {
      throw new Error(`Invalid --port value: ${args.port}`);
    }
    if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
      throw new Error(`Invalid --timeout-ms value: ${args.timeoutMs}`);
    }
  }

  return args;
}

function printHelp() {
  console.log('Usage: node tools/promote-live-training.js --pid <node-pid> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --pid <number>           Node pid for the active training process');
  console.log('  --port <number>          Inspector port to open/connect to (default: 9229)');
  console.log('  --timeout-ms <number>    Timeout for inspector operations (default: 20000)');
  console.log('  --export-file <path>     Where to write the live snapshot export');
  console.log('  --summary-file <path>    Where to write the snapshot summary json');
  console.log('  --destination <path>     Runtime roster destination for publish-bots');
  console.log('  --publish-report <path>  Where to write the publish report');
  console.log('  --no-publish             Snapshot the export, but do not update runtime/js/bot-roster.js');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Unexpected status ${res.statusCode} for ${url}`));
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out fetching ${url}`));
    });
    req.on('error', reject);
  });
}

async function waitForInspectorTarget(port, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`, timeoutMs);
      if (Array.isArray(targets) && targets.length) {
        const target = targets.find((item) => item.webSocketDebuggerUrl) || targets[0];
        if (target && target.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`Inspector endpoint was not available on port ${port}: ${lastError ? lastError.message : 'timed out'}`);
}

class InspectorClient extends EventEmitter {
  constructor(url, timeoutMs) {
    super();
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    if (typeof WebSocket !== 'function') {
      throw new Error('Global WebSocket is not available in this Node runtime.');
    }

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      socket.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        this.socket = socket;
        resolve();
      });
      socket.addEventListener('error', (event) => {
        fail(event.error || new Error('WebSocket connection failed'));
      });
      socket.addEventListener('close', () => {
        if (!settled) {
          fail(new Error('Inspector socket closed before connecting'));
        }
      });
      socket.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });
    });
  }

  handleMessage(payload) {
    let message;
    try {
      message = JSON.parse(typeof payload === 'string' ? payload : String(payload));
    } catch (error) {
      this.emit('error', error);
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'Inspector error'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.emit(message.method, message.params);
      this.emit('__event__', message);
    }
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Inspector socket is not open'));
    }

    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for inspector response: ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(eventName, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for inspector event: ${eventName}`));
      }, timeoutMs);

      const onEvent = (params) => {
        cleanup();
        resolve(params);
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off(eventName, onEvent);
      };

      this.on(eventName, onEvent);
    });
  }

  async close() {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Inspector connection closed'));
      this.pending.delete(id);
    }
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      socket.addEventListener('close', () => resolve(), { once: true });
      socket.close();
    });
  }
}

async function findSnapshotFrame(client, callFrames) {
  const probeExpression = `(() => ({
    hasPopulations: typeof populations !== 'undefined',
    hasBestRosterSeedCandidates: typeof bestRosterSeedCandidates !== 'undefined',
    hasMutableRosterSeeds: typeof mutableRosterSeeds !== 'undefined',
    hasArgs: typeof args !== 'undefined',
    hasReviewRatings: typeof reviewRatings !== 'undefined'
  }))()`;

  for (const frame of callFrames || []) {
    const response = await client.send('Debugger.evaluateOnCallFrame', {
      callFrameId: frame.callFrameId,
      expression: probeExpression,
      returnByValue: true
    });
    if (response.exceptionDetails) continue;
    const value = response.result && response.result.value;
    if (
      value &&
      value.hasPopulations &&
      value.hasBestRosterSeedCandidates &&
      value.hasMutableRosterSeeds &&
      value.hasArgs &&
      value.hasReviewRatings
    ) {
      return frame;
    }
  }

  const frameNames = (callFrames || []).map((frame) => frame.functionName || '<anonymous>');
  throw new Error(`Could not find a debugger frame with trainer state. Frames: ${frameNames.join(', ')}`);
}

function buildSnapshotExpression(exportFile, summaryFile) {
  return `(() => {
    const exportPath = ${JSON.stringify(exportFile)};
    const summaryPath = ${JSON.stringify(summaryFile)};
    ensureDir(path.dirname(exportPath));
    ensureDir(path.dirname(summaryPath));

    const promotionCandidates = Object.values(populations)
      .flat()
      .map((bot) => createPromotionCandidate(bot, reviewRatings.byBot.get(bot.id)))
      .sort((a, b) => b.promotionScore - a.promotionScore || b.elo - a.elo);
    const bestSeedPromotionCandidates = Array.from(bestRosterSeedCandidates.values())
      .sort((a, b) => b.promotionScore - a.promotionScore || b.elo - a.elo);
    const exportPool = promotionCandidates.filter((bot) => !bot.reviewBlocked);
    const selectedForExport = args.focusBotId
      ? buildFocusedBotExport(bestSeedPromotionCandidates.length ? bestSeedPromotionCandidates : (exportPool.length ? exportPool : promotionCandidates), focusSeedBot)
      : args.updateAllRoster
      ? buildUpdateAllRosterExport(bestSeedPromotionCandidates.length ? bestSeedPromotionCandidates : (exportPool.length ? exportPool : promotionCandidates), mutableRosterSeeds)
      : (exportPool.length ? exportPool : promotionCandidates).slice(0, 12);
    const exportBots = (args.updateAllRoster || args.focusBotId) ? selectedForExport : assignDifficultyBands(selectedForExport);

    const rankedBots = exportBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      schemaVersion: 1,
      archetype: bot.archetype,
      personality: bot.personality,
      generation: bot.generation,
      lineageId: bot.lineageId,
      sourceBotId: bot.sourceBotId || null,
      difficultyBand: bot.difficultyBand,
      elo: Math.round(bot.elo),
      promotionScore: Math.round(bot.promotionScore),
      selectedCandidateId: bot.selectedCandidateId || bot.id,
      selectedCandidateGeneration: bot.selectedCandidateGeneration != null ? bot.selectedCandidateGeneration : bot.generation,
      selectedCandidateTrainingHours: Number((Number(bot.selectedCandidateTrainingHours != null ? bot.selectedCandidateTrainingHours : bot.trainingHours) || 0).toFixed(3)),
      selectedCandidatePromotionScore: bot.selectedCandidatePromotionScore != null ? Math.round(bot.selectedCandidatePromotionScore) : Math.round(bot.promotionScore),
      metadata: bot.metadata ? clone(bot.metadata) : null,
      trainingHours: Number((Number(bot.trainingHours) || 0).toFixed(3)),
      controllerParams: bot.controllerParams,
      mutationProfile: bot.mutationProfile,
      network: bot.network,
      reviewBlocked: !!bot.reviewBlocked,
      reviewSummary: bot.reviewSummary
    }));

    const summary = {
      createdAt: new Date().toISOString(),
      source: 'live-training-inspector',
      runtimeVersion,
      generationCompleted: generationReports.length ? generationReports[generationReports.length - 1].generation + 1 : 0,
      generationsPlanned: args.generations,
      rosterMode: args.rosterMode,
      focusBotId: args.focusBotId,
      updateAllRoster: args.updateAllRoster,
      rosterSeedCount: mutableRosterSeeds.length,
      elapsedMs: Date.now() - overallStartedAt,
      exportedBots: rankedBots.map((bot) => ({
        id: bot.id,
        sourceBotId: bot.sourceBotId || null,
        selectedCandidateId: bot.selectedCandidateId || bot.id,
        selectedCandidateGeneration: bot.selectedCandidateGeneration != null ? bot.selectedCandidateGeneration : bot.generation,
        selectedCandidateTrainingHours: bot.selectedCandidateTrainingHours != null ? bot.selectedCandidateTrainingHours : bot.trainingHours,
        elo: bot.elo,
        promotionScore: bot.promotionScore,
        archetype: bot.archetype,
        difficultyBand: bot.difficultyBand
      })),
      bestRosterSeedCandidates: summarizeBestRosterSeedCandidates(bestRosterSeedCandidates, mutableRosterSeeds),
      topCandidates: summarizePromotionCandidates(populations, reviewRatings)
    };

    writeBotsScript(exportPath, rankedBots);
    writeJson(summaryPath, summary);
    if (typeof setTimeout === 'function' && typeof require === 'function') {
      setTimeout(() => {
        try {
          require('inspector').close();
        } catch (error) {
          // Ignore cleanup errors so the snapshot itself still succeeds.
        }
      }, 0);
    }

    return {
      generationCompleted: summary.generationCompleted,
      exportedCount: rankedBots.length,
      exportedBots: summary.exportedBots,
      bestRosterSeedCandidates: summary.bestRosterSeedCandidates
    };
  })()`;
}

async function snapshotLiveTraining(args) {
  ensureDir(path.dirname(args.exportFile));
  ensureDir(path.dirname(args.summaryFile));

  process._debugProcess(args.pid);
  const wsUrl = await waitForInspectorTarget(args.port, args.timeoutMs);
  const client = new InspectorClient(wsUrl, args.timeoutMs);
  await client.connect();

  let paused = false;
  try {
    await client.send('Runtime.enable');
    await client.send('Debugger.enable');
    const pausedPromise = client.waitForEvent('Debugger.paused', args.timeoutMs);
    await client.send('Debugger.pause');
    const pausedEvent = await pausedPromise;
    paused = true;

    const frame = await findSnapshotFrame(client, pausedEvent.callFrames);
    const response = await client.send('Debugger.evaluateOnCallFrame', {
      callFrameId: frame.callFrameId,
      expression: buildSnapshotExpression(args.exportFile, args.summaryFile),
      returnByValue: true
    });
    if (response.exceptionDetails) {
      const message = response.exceptionDetails.text || 'Snapshot export failed';
      throw new Error(message);
    }

    await client.send('Debugger.resume');
    paused = false;
    return response.result && response.result.value ? response.result.value : null;
  } finally {
    if (paused) {
      try {
        await client.send('Debugger.resume');
      } catch (error) {
        // Best-effort resume if snapshotting fails after pausing.
      }
    }
    await client.close();
  }
}

function publishSnapshot(args) {
  ensureDir(path.dirname(args.publishReport));
  childProcess.execFileSync(process.execPath, [
    path.join(repoRoot, 'tools', 'publish-bots.js'),
    '--source', args.exportFile,
    '--destination', args.destination,
    '--report', args.publishReport
  ], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  console.log(`Opening inspector on pid ${args.pid}...`);
  const snapshot = await snapshotLiveTraining(args);
  console.log(`Snapshot exported to ${args.exportFile}`);
  if (snapshot && Array.isArray(snapshot.exportedBots)) {
    snapshot.exportedBots.forEach((bot) => {
      console.log(
        `  ${bot.id} <= ${bot.selectedCandidateId} ` +
        `(gen ${bot.selectedCandidateGeneration}, elo ${bot.elo})`
      );
    });
  }

  if (args.publish) {
    publishSnapshot(args);
    const report = readJson(args.publishReport);
    console.log(`Published roster to ${args.destination}`);
    console.log(
      `  roster ${report.rosterCountBefore} -> ${report.rosterCountAfter}` +
      ` | added ${report.addedBots.length}` +
      ` | replaced ${report.replacedBots.length}` +
      ` | skipped ${report.skippedBots.length}`
    );
  } else {
    console.log('Publish skipped because --no-publish was set.');
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
