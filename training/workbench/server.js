#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const trainingRoot = path.join(repoRoot, 'training');
const reportsRoot = path.join(trainingRoot, 'reports');
const reviewRatingsPath = path.join(reportsRoot, 'review-ratings.json');
const workbenchLogDir = path.join(reportsRoot, '_workbench');
const workbenchLogPath = path.join(workbenchLogDir, 'server.log');
const activeRuns = new Map();
const activeClipRenders = new Map();

function createTimestampSlug(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function serializeForLog(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function logWorkbench(level, message, details = null) {
  ensureDir(workbenchLogDir);
  const line = `[${formatTimestamp()}] ${String(level || 'info').toUpperCase()} ${message}` +
    (details == null ? '' : ` | ${serializeForLog(details)}`);
  fs.appendFileSync(workbenchLogPath, `${line}\n`, 'utf8');
  process.stdout.write(`${line}\n`);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function tailText(filePath, maxLines = 80) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeRunId(rawValue) {
  return String(rawValue || '').replace(/[^a-zA-Z0-9._-]/g, '');
}

function getRunDir(runId) {
  return path.join(reportsRoot, runId);
}

function getCheckpointPath(runId) {
  return path.join(getRunDir(runId), 'checkpoints', 'latest-evolution-checkpoint.json');
}

function getReportPath(runId) {
  return path.join(getRunDir(runId), 'latest-evolution-report.json');
}

function getReplayDir(runId) {
  return path.join(getRunDir(runId), 'replays');
}

function getClipDir(runId) {
  return path.join(getRunDir(runId), 'clips');
}

function getRunFiles(runId) {
  return {
    runDir: getRunDir(runId),
    checkpointPath: getCheckpointPath(runId),
    reportPath: getReportPath(runId),
    replayDir: getReplayDir(runId),
    clipDir: getClipDir(runId)
  };
}

function summarizeTopCandidate(item) {
  if (!item) return null;
  return {
    id: item.id || item.seedBotId || null,
    name: item.name || item.seedBotName || null,
    elo: Number(item.elo || item.selectedCandidateElo || 0),
    promotionScore: Number(item.promotionScore || item.selectedCandidatePromotionScore || 0),
    roleFitScore: Number(item.roleFitScore || item.selectedCandidateRoleFitScore || 0),
    archetype: Object.prototype.hasOwnProperty.call(item, 'archetype') ? item.archetype : null
  };
}

function buildRunSummary(runId) {
  const files = getRunFiles(runId);
  const checkpoint = readJson(files.checkpointPath, null);
  const report = readJson(files.reportPath, null);
  const active = activeRuns.get(runId) || null;
  const runLogFile = (report && report.runLogFile) || (checkpoint && checkpoint.runLogFile) || (active && active.logFile) || null;
  const generationCompleted = checkpoint
    ? Number(checkpoint.generationCompleted) + 1
    : (report ? Number(report.generations) : 0);
  const generationsPlanned = checkpoint
    ? Number(checkpoint.generationsPlanned || checkpoint.generations || 0)
    : (report ? Number(report.generations || 0) : 0);
  const progress = generationsPlanned > 0
    ? clamp(generationCompleted / generationsPlanned, 0, 1)
    : (active ? 0 : 1);
  const topCandidates = checkpoint && Array.isArray(checkpoint.topCandidates)
    ? checkpoint.topCandidates.slice(0, 6).map(summarizeTopCandidate).filter(Boolean)
    : report && Array.isArray(report.exportedBots)
      ? report.exportedBots.slice(0, 6).map(summarizeTopCandidate).filter(Boolean)
      : [];
  const stats = fs.existsSync(files.runDir) ? fs.statSync(files.runDir) : null;

  return {
    runId,
    title: runId,
    reportsDir: files.runDir,
    active: !!(active && active.child && active.child.exitCode == null),
    pid: active && active.child ? active.child.pid : null,
    startedAt: active ? active.startedAt : (report && report.createdAt) || (checkpoint && checkpoint.createdAt) || (stats ? stats.birthtime.toISOString() : null),
    exitCode: active ? active.exitCode : null,
    generationsPlanned,
    generationCompleted,
    progress,
    rosterMode: (report && report.rosterMode) || null,
    population: Number((report && report.population) || (checkpoint && checkpoint.population) || (active && active.args.population) || 0),
    seed: Number((report && report.seed) || (checkpoint && checkpoint.seed) || (active && active.args.seed) || 0),
    elapsedMs: Number((report && report.elapsedMs) || (checkpoint && checkpoint.elapsedMs) || 0),
    matchesPerGeneration: Number((report && report.matchesPerGeneration) || (checkpoint && checkpoint.matchesPerGeneration) || 0),
    totalPlannedMatches: Number((report && report.totalPlannedMatches) || (checkpoint && checkpoint.totalPlannedMatches) || 0),
    topCandidates,
    tuningDiagnostics: checkpoint && Array.isArray(checkpoint.generationReports) && checkpoint.generationReports.length
      ? checkpoint.generationReports[checkpoint.generationReports.length - 1].tuningDiagnostics || []
      : report && Array.isArray(report.generationReports) && report.generationReports.length
        ? report.generationReports[report.generationReports.length - 1].tuningDiagnostics || []
        : [],
    generationReports: checkpoint && Array.isArray(checkpoint.generationReports)
      ? checkpoint.generationReports
      : report && Array.isArray(report.generationReports)
        ? report.generationReports
        : [],
    recentLogs: active && active.logs.length ? active.logs.slice(-120) : (runLogFile ? tailText(runLogFile, 120) : []),
    checkpointPath: fs.existsSync(files.checkpointPath) ? files.checkpointPath : null,
    reportPath: fs.existsSync(files.reportPath) ? files.reportPath : null,
    replayCount: fs.existsSync(files.replayDir)
      ? fs.readdirSync(files.replayDir).filter((file) => file.endsWith('.json')).length
      : 0,
    runLogFile
  };
}

function listKnownRunIds() {
  const ids = new Set(activeRuns.keys());
  if (fs.existsSync(reportsRoot)) {
    for (const entry of fs.readdirSync(reportsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const reportPath = path.join(reportsRoot, entry.name, 'latest-evolution-report.json');
      const checkpointPath = path.join(reportsRoot, entry.name, 'checkpoints', 'latest-evolution-checkpoint.json');
      if (fs.existsSync(reportPath) || fs.existsSync(checkpointPath)) ids.add(entry.name);
    }
  }
  return Array.from(ids).sort((left, right) => right.localeCompare(left));
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Request body too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Wave-Pong-Workbench-Log': workbenchLogPath
  });
  response.end(body);
}

function sendText(response, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function serveFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webm': 'video/webm',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendText(response, 404, 'Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(data);
  });
}

function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store'
  });
  response.end();
}

function resolveStaticPath(urlPath) {
  const trimmed = urlPath === '/' ? '/training/workbench/index.html' : urlPath;
  const normalized = path.normalize(trimmed.replace(/^\/+/, ''));
  const absolute = path.join(repoRoot, normalized);
  const allowed = [
    trainingRoot,
    path.join(repoRoot, 'runtime')
  ];
  if (!allowed.some((root) => absolute.startsWith(root))) return null;
  return absolute;
}

function buildDefaultTrainingConfig() {
  return {
    generations: 400,
    population: 16,
    seed: 1337,
    scoreLimit: 5,
    maxTicks: 120 * 90,
    checkpointEvery: 25,
    autoPromoteEvery: 0,
    progressEvery: 0,
    updateAllRoster: true,
    publishRuntime: false
  };
}

function buildTrainingArgs(runId, config) {
  const defaults = buildDefaultTrainingConfig();
  const merged = {
    ...defaults,
    ...(config || {})
  };
  const runDir = getRunDir(runId);
  ensureDir(runDir);
  const args = [
    path.join(trainingRoot, 'evolve-bots.js'),
    '--generations', String(Math.max(1, Number(merged.generations) || defaults.generations)),
    '--population', String(Math.max(2, Number(merged.population) || defaults.population)),
    '--seed', String(Number(merged.seed) || defaults.seed),
    '--score-limit', String(Math.max(1, Number(merged.scoreLimit) || defaults.scoreLimit)),
    '--max-ticks', String(Math.max(120, Number(merged.maxTicks) || defaults.maxTicks)),
    '--reports-dir', runDir,
    '--export-file', path.join(runDir, 'exported-bots.js'),
    '--checkpoint-every', String(Math.max(1, Number(merged.checkpointEvery) || defaults.checkpointEvery)),
    '--progress-every', String(Math.max(0, Number(merged.progressEvery) || defaults.progressEvery))
  ];
  if (Number(merged.autoPromoteEvery) > 0) args.push('--auto-promote-every', String(Math.floor(Number(merged.autoPromoteEvery))));
  if (merged.updateAllRoster !== false) args.push('--update-all-roster');
  if (merged.publishRuntime) args.push('--publish-runtime');
  return { args, merged, runDir };
}

function renderReplayClip(runId, replayId) {
  const renderKey = `${runId}:${replayId}`;
  if (activeClipRenders.has(renderKey)) return activeClipRenders.get(renderKey);

  const replayPath = path.join(getReplayDir(runId), `${replayId}.json`);
  const clipDir = getClipDir(runId);
  const outputPath = path.join(clipDir, `${replayId}.webm`);
  if (!fs.existsSync(replayPath)) {
    return Promise.reject(new Error(`Replay bundle not found: ${replayPath}`));
  }

  ensureDir(clipDir);
  const renderScript = path.join(trainingRoot, 'render-replay.js');
  const task = new Promise((resolve, reject) => {
    logWorkbench('info', 'Starting replay clip render', { runId, replayId, replayPath, outputPath });
    const child = spawn(process.execPath, [renderScript, '--replay', replayPath, '--output', outputPath], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
      if (stdout.length > 4000) stdout = stdout.slice(-4000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', (error) => {
      logWorkbench('error', 'Replay clip render process error', {
        runId,
        replayId,
        message: String(error && error.stack ? error.stack : error)
      });
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        logWorkbench('info', 'Replay clip render complete', { runId, replayId, outputPath });
        resolve({ outputPath, stdout: stdout.trim() });
        return;
      }
      const message = stderr.trim() || stdout.trim() || `Replay clip render failed with exit code ${code}`;
      logWorkbench('error', 'Replay clip render failed', { runId, replayId, outputPath, exitCode: code, message });
      reject(new Error(message));
    });
  }).finally(() => {
    activeClipRenders.delete(renderKey);
  });

  activeClipRenders.set(renderKey, task);
  return task;
}

function startTrainingRun(config) {
  const runId = `workbench-${createTimestampSlug()}`;
  const { args, merged, runDir } = buildTrainingArgs(runId, config);
  logWorkbench('info', 'Starting training run', { runId, config: merged, args });
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const record = {
    runId,
    child,
    args: merged,
    runDir,
    logFile: path.join(runDir, `training-${createTimestampSlug()}.log`),
    logs: [],
    startedAt: new Date().toISOString(),
    exitCode: null
  };
  activeRuns.set(runId, record);

  function appendLog(prefix, chunk) {
    const text = String(chunk || '').split(/\r?\n/).filter(Boolean);
    for (const line of text) {
      record.logs.push(prefix ? `${prefix} ${line}` : line);
    }
    if (record.logs.length > 500) record.logs.splice(0, record.logs.length - 500);
  }

  child.stdout.on('data', (chunk) => appendLog('', chunk));
  child.stderr.on('data', (chunk) => {
    appendLog('[stderr]', chunk);
    logWorkbench('warn', 'Training child stderr', {
      runId,
      chunk: String(chunk || '').trim()
    });
  });
  child.on('error', (error) => {
    record.exitCode = 1;
    logWorkbench('error', 'Training child process error', {
      runId,
      message: String(error && error.stack ? error.stack : error)
    });
  });
  child.on('exit', (code) => {
    record.exitCode = code;
    logWorkbench(code === 0 ? 'info' : 'warn', 'Training child exited', {
      runId,
      exitCode: code,
      logFile: record.logFile
    });
  });
  return buildRunSummary(runId);
}

function stopTrainingRun(runId) {
  const record = activeRuns.get(runId);
  if (!record || !record.child || record.child.exitCode != null) return false;
  logWorkbench('info', 'Stopping training run', { runId, pid: record.child.pid });
  record.child.kill('SIGTERM');
  return true;
}

function listReplaySummaries(runId) {
  const replayDir = getReplayDir(runId);
  if (!fs.existsSync(replayDir)) return [];
  const ratings = readJson(reviewRatingsPath, { items: [] });
  const ratingsByReplayId = new Map(((ratings && ratings.items) || []).map((item) => [item.replayId, item]));
  return fs.readdirSync(replayDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const bundle = readJson(path.join(replayDir, file), null);
      if (!bundle) return null;
      const rating = ratingsByReplayId.get(bundle.replayId) || null;
      return {
        replayId: bundle.replayId,
        seed: bundle.seed,
        botIds: Array.isArray(bundle.botIds) ? bundle.botIds : [],
        durationTicks: bundle.durationTicks || 0,
        score: bundle.final ? `${bundle.final.leftScore}-${bundle.final.rightScore}` : '?',
        maxBallSpeed: bundle.metrics ? Number(bundle.metrics.maxBallSpeed || 0) : 0,
        heuristicFlags: [],
        clipExists: fs.existsSync(path.join(getRunDir(runId), 'clips', `${bundle.replayId}.webm`)),
        humanRating: rating
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.maxBallSpeed - left.maxBallSpeed || left.replayId.localeCompare(right.replayId));
}

function routeApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/state') {
    const runs = listKnownRunIds().map(buildRunSummary);
    sendJson(response, 200, {
      ok: true,
      serverTime: new Date().toISOString(),
      defaults: buildDefaultTrainingConfig(),
      activeRuns: runs.filter((run) => run.active),
      recentRuns: runs.slice(0, 12),
      ratings: readJson(reviewRatingsPath, { schemaVersion: 1, items: [] })
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/training/start') {
    parseJsonBody(request)
      .then((body) => {
        const run = startTrainingRun(body);
        sendJson(response, 200, { ok: true, run, logFile: workbenchLogPath });
      })
      .catch((error) => {
        logWorkbench('error', 'Start training request failed', {
          path: url.pathname,
          message: String(error && error.stack ? error.stack : error)
        });
        sendJson(response, 400, { ok: false, error: String(error.message || error), logFile: workbenchLogPath });
      });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/training/stop') {
    parseJsonBody(request)
      .then((body) => {
        const runId = safeRunId(body.runId);
        if (!runId) throw new Error('Missing runId.');
        const stopped = stopTrainingRun(runId);
        sendJson(response, 200, { ok: stopped, runId, logFile: workbenchLogPath });
      })
      .catch((error) => {
        logWorkbench('error', 'Stop training request failed', {
          path: url.pathname,
          message: String(error && error.stack ? error.stack : error)
        });
        sendJson(response, 400, { ok: false, error: String(error.message || error), logFile: workbenchLogPath });
      });
    return true;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (request.method === 'GET' && runMatch) {
    const runId = safeRunId(runMatch[1]);
    sendJson(response, 200, { ok: true, run: buildRunSummary(runId) });
    return true;
  }

  const replayListMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/replays$/);
  if (request.method === 'GET' && replayListMatch) {
    const runId = safeRunId(replayListMatch[1]);
    sendJson(response, 200, { ok: true, items: listReplaySummaries(runId) });
    return true;
  }

  const replayMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/replays\/([^/]+)$/);
  if (request.method === 'GET' && replayMatch) {
    const runId = safeRunId(replayMatch[1]);
    const replayId = decodeURIComponent(replayMatch[2]);
    const bundlePath = path.join(getReplayDir(runId), `${replayId}.json`);
    if (!fs.existsSync(bundlePath)) {
      sendJson(response, 404, { ok: false, error: 'Replay not found.' });
      return true;
    }
    sendJson(response, 200, { ok: true, bundle: readJson(bundlePath, null) });
    return true;
  }

  const renderClipMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/replays\/([^/]+)\/render-clip$/);
  if (request.method === 'POST' && renderClipMatch) {
    const runId = safeRunId(renderClipMatch[1]);
    const replayId = decodeURIComponent(renderClipMatch[2]);
    renderReplayClip(runId, replayId)
      .then(({ outputPath }) => {
        sendJson(response, 200, {
          ok: true,
          runId,
          replayId,
          outputPath,
          clipUrl: `/training/reports/${encodeURIComponent(runId)}/clips/${encodeURIComponent(replayId)}.webm`
        });
      })
      .catch((error) => {
        sendJson(response, 500, { ok: false, error: String(error.message || error), logFile: workbenchLogPath });
      });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/review/ratings') {
    sendJson(response, 200, { ok: true, payload: readJson(reviewRatingsPath, { schemaVersion: 1, items: [] }) });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/review/ratings') {
    parseJsonBody(request)
      .then((body) => {
        writeJson(reviewRatingsPath, body);
        logWorkbench('info', 'Saved review ratings', { savedTo: reviewRatingsPath });
        sendJson(response, 200, { ok: true, savedTo: reviewRatingsPath, logFile: workbenchLogPath });
      })
      .catch((error) => {
        logWorkbench('error', 'Save ratings request failed', {
          path: url.pathname,
          message: String(error && error.stack ? error.stack : error)
        });
        sendJson(response, 400, { ok: false, error: String(error.message || error), logFile: workbenchLogPath });
      });
    return true;
  }

  return false;
}

function main() {
  ensureDir(reportsRoot);
  ensureDir(workbenchLogDir);
  const port = Number(process.env.WAVE_PONG_WORKBENCH_PORT) || 8936;
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
      const quietPollRequest = request.method === 'GET' && (
        url.pathname === '/api/state' ||
        /^\/api\/runs\/[^/]+\/replays$/.test(url.pathname) ||
        /^\/api\/runs\/[^/]+\/replays\/[^/]+$/.test(url.pathname)
      );
      if (request.method === 'GET' && url.pathname === '/') {
        logWorkbench('info', 'Redirecting root request', { location: '/training/workbench/index.html' });
        redirect(response, '/training/workbench/index.html');
        return;
      }
      if ((request.method !== 'GET' || url.pathname.startsWith('/api/')) && !quietPollRequest) {
        logWorkbench('info', 'HTTP request', { method: request.method, path: url.pathname });
      }
      if (routeApi(request, response, url)) return;
      const filePath = resolveStaticPath(url.pathname);
      if (!filePath || !fs.existsSync(filePath)) {
        logWorkbench('warn', 'Static file not found', { method: request.method, path: url.pathname });
        sendText(response, 404, 'Not found');
        return;
      }
      serveFile(response, filePath);
    } catch (error) {
      logWorkbench('error', 'Unhandled request error', {
        method: request && request.method,
        url: request && request.url,
        message: String(error && error.stack ? error.stack : error)
      });
      sendJson(response, 500, {
        ok: false,
        error: 'Workbench server error.',
        logFile: workbenchLogPath
      });
    }
  });

  server.on('clientError', (error, socket) => {
    logWorkbench('warn', 'HTTP client error', {
      message: String(error && error.stack ? error.stack : error)
    });
    if (socket && !socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  server.listen(port, '127.0.0.1', () => {
    logWorkbench('info', 'Wave Pong workbench listening', {
      port,
      url: `http://127.0.0.1:${port}/`,
      logFile: workbenchLogPath
    });
  });

  process.on('uncaughtException', (error) => {
    logWorkbench('error', 'Uncaught exception', {
      message: String(error && error.stack ? error.stack : error)
    });
  });
  process.on('unhandledRejection', (error) => {
    logWorkbench('error', 'Unhandled rejection', {
      message: String(error && error.stack ? error.stack : error)
    });
  });
}

main();
