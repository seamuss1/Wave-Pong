#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const config = require(path.join(repoRoot, 'runtime/js/config.js'));
const simCore = require(path.join(repoRoot, 'runtime/js/sim-core.js'));
const controllers = require(path.join(repoRoot, 'runtime/js/controllers.js'));

function parseArgs(argv) {
  const args = {
    source: path.join(repoRoot, 'tools', 'reports', 'candidates', 'latest-candidate-bot.js'),
    destination: path.join(repoRoot, 'runtime', 'js', 'bot-roster.js'),
    report: path.join(repoRoot, 'tools', 'reports', 'published-bots-report.json'),
    replaceId: null,
    forceAdd: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source' && argv[i + 1]) args.source = path.resolve(argv[++i]);
    else if (arg === '--destination' && argv[i + 1]) args.destination = path.resolve(argv[++i]);
    else if (arg === '--report' && argv[i + 1]) args.report = path.resolve(argv[++i]);
    else if (arg === '--replace-id' && argv[i + 1]) args.replaceId = String(argv[++i]);
    else if (arg === '--force-add') args.forceAdd = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function loadModule(filePath) {
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function flattenNetwork(network) {
  if (!network || !Array.isArray(network.layers)) return [];
  const values = [];
  for (const layer of network.layers) {
    values.push(...(Array.isArray(layer.biases) ? layer.biases : []));
    for (const row of (Array.isArray(layer.weights) ? layer.weights : [])) {
      values.push(...row);
    }
  }
  return values;
}

function cosineSimilarity(left, right) {
  const a = flattenNetwork(left.network);
  const b = flattenNetwork(right.network);
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function inferStyleTags(bot) {
  const tags = [];
  if (bot.archetype) tags.push(bot.archetype);
  if (bot.difficultyBand) tags.push(bot.difficultyBand);
  if ((bot.runtimeValidation && bot.runtimeValidation.totalMovedTicks >= 120)) tags.push('active-mover');
  else if ((bot.runtimeValidation && bot.runtimeValidation.totalMovedTicks > 0)) tags.push('measured-mover');
  else tags.push('static-lane');
  if ((bot.runtimeValidation && bot.runtimeValidation.totalGoals >= 9)) tags.push('high-scoring');
  else if ((bot.runtimeValidation && bot.runtimeValidation.totalGoals >= 5)) tags.push('goal-capable');
  return tags;
}

function eloTier(elo) {
  const value = Number(elo) || 0;
  if (value >= 1040) return 'elite';
  if (value >= 1000) return 'mid';
  return 'entry';
}

function evaluateRuntimeActivity(bot, seed) {
  const runtime = simCore.createSimulation({ config, seed });
  runtime.setControllers({
    left: null,
    right: controllers.createNeuralController(bot)
  });
  runtime.startMatch({
    mode: 'pvc',
    difficulty: bot.difficultyBand || 'spicy',
    skipCountdown: true,
    scoreLimit: 3,
    powerupsEnabled: true,
    trailsEnabled: false
  });

  let movedTicks = 0;
  let lastY = runtime.world.paddles.right.y;
  for (let i = 0; i < 1200; i += 1) {
    runtime.stepSimulation(1);
    const y = runtime.world.paddles.right.y;
    if (Math.abs(y - lastY) > 1e-6) movedTicks += 1;
    lastY = y;
  }

  return {
    movedTicks,
    leftScore: runtime.state.leftScore,
    rightScore: runtime.state.rightScore
  };
}

function normalizePublishedBot(bot, sourceLabel) {
  const samples = bot.runtimeValidation && Array.isArray(bot.runtimeValidation.samples)
    ? bot.runtimeValidation.samples
    : [123, 987654321].map((seed) => evaluateRuntimeActivity(bot, seed));
  const totalMovedTicks = samples.reduce((sum, sample) => sum + (sample.movedTicks || 0), 0);
  const totalGoals = samples.reduce((sum, sample) => sum + (sample.leftScore || 0) + (sample.rightScore || 0), 0);
  const runtimeDisabled = totalMovedTicks === 0 && totalGoals === 0;
  const metadata = {
    rosterStatus: 'published',
    rosterVersion: 1,
    source: sourceLabel,
    publishedAt: new Date().toISOString(),
    lineageRoot: bot.lineageId || bot.id,
    sourceBotId: bot.sourceBotId || null,
    styleTags: inferStyleTags({
      ...bot,
      runtimeValidation: {
        totalMovedTicks,
        totalGoals,
        samples
      }
    }),
    eloTier: eloTier(bot.elo),
    reviewState: bot.reviewBlocked ? 'blocked' : 'active'
  };

  return {
    ...clone(bot),
    runtimeDisabled,
    runtimeValidation: {
      totalMovedTicks,
      totalGoals,
      samples
    },
    metadata
  };
}

function writeBotsScript(filePath, globalName, bots) {
  const payload = JSON.stringify(bots, null, 2);
  const script = `(function (root) {\n  const bots = ${payload};\n  if (typeof module === 'object' && module.exports) {\n    module.exports = bots;\n  }\n  if (root) {\n    root.WavePong = root.WavePong || {};\n    root.WavePong.${globalName} = bots;\n  }\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n`;
  fs.writeFileSync(filePath, script, 'utf8');
}

function findRedundantRosterMatch(candidate, roster) {
  let best = null;
  for (const rosterBot of roster) {
    const similarity = cosineSimilarity(candidate, rosterBot);
    const sameLineage = candidate.lineageId && rosterBot.lineageId && candidate.lineageId === rosterBot.lineageId;
    const sameRole = candidate.archetype === rosterBot.archetype && candidate.difficultyBand === rosterBot.difficultyBand;
    const eloDelta = Math.abs((Number(candidate.elo) || 0) - (Number(rosterBot.elo) || 0));
    const redundant = (sameLineage && similarity > 0.97) || (sameRole && similarity > 0.992 && eloDelta <= 30);
    if (!best || similarity > best.similarity) {
      best = {
        rosterBotId: rosterBot.id,
        similarity,
        sameLineage,
        sameRole,
        eloDelta,
        redundant
      };
    }
  }
  return best;
}

function normalizeSourceBots(source, sourceLabel) {
  const rawBots = Array.isArray(source) ? source : [source];
  return rawBots.filter(Boolean).map((bot) => normalizePublishedBot(bot, sourceLabel));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.source)) {
    throw new Error(`Bot source not found: ${args.source}`);
  }

  const sourceValue = loadModule(args.source);
  const incomingBots = normalizeSourceBots(sourceValue, path.basename(args.source));
  const existingRoster = fs.existsSync(args.destination)
    ? normalizeSourceBots(loadModule(args.destination), path.basename(args.destination))
    : [];

  const nextRoster = existingRoster.slice();
  const addedBots = [];
  const replacedBots = [];
  const skippedBots = [];

  for (const candidate of incomingBots) {
    const redundancy = findRedundantRosterMatch(candidate, nextRoster);
    const replaceIndex = args.replaceId
      ? nextRoster.findIndex((bot) => bot.id === args.replaceId)
      : nextRoster.findIndex((bot) => bot.id === candidate.id);

    if (replaceIndex >= 0) {
      const existing = nextRoster[replaceIndex];
      candidate.metadata.replacesBotId = existing.id;
      nextRoster[replaceIndex] = candidate;
      replacedBots.push({
        candidateId: candidate.id,
        replacedBotId: existing.id
      });
      continue;
    }

    if (redundancy && redundancy.redundant && !args.forceAdd) {
      skippedBots.push({
        candidateId: candidate.id,
        reason: 'redundant_with_roster',
        redundancy
      });
      continue;
    }

    candidate.metadata.closestRosterBotId = redundancy ? redundancy.rosterBotId : null;
    candidate.metadata.closestRosterSimilarity = redundancy ? Number(redundancy.similarity.toFixed(6)) : null;
    nextRoster.push(candidate);
    addedBots.push({
      candidateId: candidate.id,
      redundancy
    });
  }

  ensureDir(path.dirname(args.destination));
  ensureDir(path.dirname(args.report));
  writeBotsScript(args.destination, 'BOT_ROSTER', nextRoster);
  fs.writeFileSync(args.report, JSON.stringify({
    createdAt: new Date().toISOString(),
    source: args.source,
    destination: args.destination,
    rosterCountBefore: existingRoster.length,
    rosterCountAfter: nextRoster.length,
    addedBots,
    replacedBots,
    skippedBots,
    rosterSummary: nextRoster.map((bot) => ({
      id: bot.id,
      archetype: bot.archetype,
      difficultyBand: bot.difficultyBand,
      elo: bot.elo,
      lineageId: bot.lineageId,
      metadata: bot.metadata
    }))
  }, null, 2), 'utf8');

  console.log(`Roster write complete: ${nextRoster.length} published bot(s) in ${args.destination}`);
  if (addedBots.length) console.log(`Added ${addedBots.length} bot(s).`);
  if (replacedBots.length) console.log(`Replaced ${replacedBots.length} bot(s).`);
  if (skippedBots.length) console.log(`Skipped ${skippedBots.length} redundant bot(s). See ${args.report}.`);
}

main();
