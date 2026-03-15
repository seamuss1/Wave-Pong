#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const config = require(path.join(repoRoot, 'runtime/js/config.js'));
const simCore = require(path.join(repoRoot, 'runtime/js/sim-core.js'));
const controllers = require(path.join(repoRoot, 'runtime/js/controllers.js'));
const runtimeVersion = require(path.join(repoRoot, 'runtime/js/version.js'));
const humanTraining = require(path.join(repoRoot, 'tools', 'human-training.js'));

const ARCHETYPES = [
  {
    id: 'defensive',
    label: 'Anchor',
    personality: 'Covers the lane early and values survival over flair.',
    fitness: { win: 100, goalDiff: 18, rally: 1.5, shots: 0.4, powerups: 0.9, againstGoals: -20 }
  },
  {
    id: 'aggressive',
    label: 'Volt',
    personality: 'Pushes pressure, spends charge, and looks for quick finishes.',
    fitness: { win: 100, goalDiff: 24, rally: 0.7, shots: 1.3, powerups: 0.4, againstGoals: -16 }
  },
  {
    id: 'control',
    label: 'Weaver',
    personality: 'Leans into pickups, long exchanges, and court control.',
    fitness: { win: 100, goalDiff: 16, rally: 1.8, shots: 0.8, powerups: 1.4, againstGoals: -18 }
  },
  {
    id: 'trickster',
    label: 'Glitch',
    personality: 'Varies tempo and angle pressure without giving up match discipline.',
    fitness: { win: 100, goalDiff: 19, rally: 1.2, shots: 1.1, powerups: 0.7, againstGoals: -18 }
  }
];

const ROLE_TRAINING_PROFILES = {
  strategist: {
    id: 'strategist',
    label: 'Strategist',
    personality: 'Uses blue wave timing to shape rallies, control ball routes, and keep the court predictable.',
    fitness: {
      win: 100,
      goalDiff: 20,
      longestRally: 1.8,
      againstGoals: -20,
      blueShots: 0.9,
      blueBallHits: 1.8,
      blueTowardHits: 2.6,
      blueAwayHits: 1.9,
      blueResistGrants: 2.2,
      nonBlueShots: -0.7,
      goldShots: -0.25
    }
  },
  defensive_specialist: {
    id: 'defensive_specialist',
    label: 'Defensive Specialist',
    personality: 'Prioritizes pink wave survival windows, stabilizes losing rallies, and buys time to recover position.',
    fitness: {
      win: 100,
      goalDiff: 16,
      longestRally: 2.1,
      againstGoals: -26,
      pinkShots: 1.2,
      pinkBallHits: 1.4,
      pinkThreatHits: 2.8,
      pinkEmergencyHits: 3.4,
      nonPinkShots: -0.65,
      goldShots: -0.4
    }
  },
  sniper: {
    id: 'sniper',
    label: 'Sniper',
    personality: 'Uses gold waves to line up pickups, create punish windows, and convert brief openings into scoring pressure.',
    fitness: {
      win: 100,
      goalDiff: 22,
      againstGoals: -16,
      shots: 0.5,
      goldShots: 1.1,
      goldBallHits: 1.2,
      goldCenterHits: 2.2,
      goldPaddleHits: 3.8,
      goldWavePowerups: 3.4,
      nonGoldShots: -0.55
    }
  }
};

function parseArgs(argv) {
  const args = {
    generations: 3,
    population: 6,
    seed: 1337,
    scoreLimit: 5,
    maxTicks: 120 * 90,
    reportsDir: path.join(repoRoot, 'tools', 'reports'),
    exportFile: path.join(repoRoot, 'tools', 'reports', 'exported-bots.js'),
    ratingsFile: path.join(repoRoot, 'tools', 'reports', 'review-ratings.json'),
    humanTrainingFile: path.join(repoRoot, 'tools', 'reports', 'human-training-data.json'),
    rosterFile: path.join(repoRoot, 'runtime', 'js', 'bot-roster.js'),
    rosterMode: 'none',
    focusBotId: null,
    selfPlay: false,
    updateAllRoster: false,
    publishRuntime: false,
    autoPromoteEvery: 0,
    checkpointEvery: 1,
    progressEveryMatches: 100
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--generations' && argv[i + 1]) args.generations = Number(argv[++i]);
    else if (arg === '--population' && argv[i + 1]) args.population = Number(argv[++i]);
    else if (arg === '--seed' && argv[i + 1]) args.seed = Number(argv[++i]);
    else if (arg === '--score-limit' && argv[i + 1]) args.scoreLimit = Number(argv[++i]);
    else if (arg === '--max-ticks' && argv[i + 1]) args.maxTicks = Number(argv[++i]);
    else if (arg === '--reports-dir' && argv[i + 1]) args.reportsDir = path.resolve(argv[++i]);
    else if (arg === '--export-file' && argv[i + 1]) args.exportFile = path.resolve(argv[++i]);
    else if (arg === '--ratings-file' && argv[i + 1]) args.ratingsFile = path.resolve(argv[++i]);
    else if (arg === '--human-training-file' && argv[i + 1]) args.humanTrainingFile = path.resolve(argv[++i]);
    else if (arg === '--roster-file' && argv[i + 1]) args.rosterFile = path.resolve(argv[++i]);
    else if (arg === '--roster-mode' && argv[i + 1]) args.rosterMode = String(argv[++i]).toLowerCase();
    else if (arg === '--focus-bot-id' && argv[i + 1]) args.focusBotId = String(argv[++i]);
    else if (arg === '--self-play') args.selfPlay = true;
    else if (arg === '--update-all-roster') args.updateAllRoster = true;
    else if (arg === '--publish-runtime') args.publishRuntime = true;
    else if (arg === '--auto-promote-every' && argv[i + 1]) args.autoPromoteEvery = Number(argv[++i]);
    else if (arg === '--checkpoint-every' && argv[i + 1]) args.checkpointEvery = Number(argv[++i]);
    else if (arg === '--progress-every' && argv[i + 1]) args.progressEveryMatches = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['none', 'static', 'mutable'].includes(args.rosterMode)) {
    throw new Error(`Unsupported --roster-mode value: ${args.rosterMode}`);
  }
  if (args.updateAllRoster) args.rosterMode = 'mutable';
  if (args.focusBotId && args.rosterMode === 'none') args.rosterMode = 'mutable';
  if (args.selfPlay && args.focusBotId && args.population < 2) {
    throw new Error('--self-play with --focus-bot-id requires --population 2 or higher so the bot has descendants to spar against.');
  }
  if (args.autoPromoteEvery < 0) {
    throw new Error('--auto-promote-every must be 0 or higher.');
  }
  if (args.autoPromoteEvery > 0 && !args.publishRuntime) {
    throw new Error('--auto-promote-every requires --publish-runtime because auto-promotion only affects the live runtime roster.');
  }

  return args;
}

function createSeededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadModule(filePath) {
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatCommandArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:\\=-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function countRoundRobinMatches(botCount) {
  return (botCount * (botCount - 1)) / 2;
}

function countTrainingMatches(mutableCount, staticCount) {
  return countRoundRobinMatches(mutableCount) + (mutableCount * staticCount);
}

function normalizeDecision(value) {
  if (value === 'accept' || value === 'watch' || value === 'reject') return value;
  return 'watch';
}

function normalizeOptionalScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, 0, 5) : null;
}

function normalizeHumanRating(item) {
  if (!item || !item.replayId) return null;
  const scores = item.scores || {};
  return {
    replayId: item.replayId,
    botIds: Array.isArray(item.botIds) ? item.botIds.filter(Boolean) : [],
    decision: normalizeDecision(item.decision),
    scores: {
      fun: normalizeOptionalScore(item.fun ?? scores.fun),
      fairness: normalizeOptionalScore(item.fairness ?? scores.fairness),
      skillExpression: normalizeOptionalScore(item.skillExpression ?? scores.skillExpression),
      pace: normalizeOptionalScore(item.pace ?? scores.pace),
      exploitRisk: normalizeOptionalScore(item.exploitRisk ?? scores.exploitRisk)
    },
    notes: typeof item.notes === 'string' ? item.notes : '',
    updatedAt: item.updatedAt || null
  };
}

function loadHumanRatings(ratingsFile) {
  if (!ratingsFile || !fs.existsSync(ratingsFile)) {
    return [];
  }
  const raw = JSON.parse(fs.readFileSync(ratingsFile, 'utf8'));
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.items) ? raw.items : [];
  return items.map(normalizeHumanRating).filter(Boolean);
}

function scoreHumanRating(rating) {
  const scores = rating.scores || {};
  let score = 0;
  if (scores.fun !== null) score += (scores.fun - 3) * 20;
  if (scores.fairness !== null) score += (scores.fairness - 3) * 24;
  if (scores.skillExpression !== null) score += (scores.skillExpression - 3) * 18;
  if (scores.pace !== null) score += (scores.pace - 3) * 14;
  if (scores.exploitRisk !== null) score -= scores.exploitRisk * 30;
  if (rating.decision === 'accept') score += 30;
  else if (rating.decision === 'watch') score -= 30;
  else if (rating.decision === 'reject') score -= 220;
  return score;
}

function createReviewAccumulator(botId) {
  return {
    botId,
    reviewCount: 0,
    reviewScoreTotal: 0,
    rejectCount: 0,
    watchCount: 0,
    acceptCount: 0,
    scoreTotals: {
      fun: 0,
      fairness: 0,
      skillExpression: 0,
      pace: 0,
      exploitRisk: 0
    },
    scoreCounts: {
      fun: 0,
      fairness: 0,
      skillExpression: 0,
      pace: 0,
      exploitRisk: 0
    }
  };
}

function normalizeRoleKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getTrainingProfile(bot) {
  const roleName = normalizeRoleKey(bot && bot.metadata && bot.metadata.roleName);
  if (roleName && ROLE_TRAINING_PROFILES[roleName]) return ROLE_TRAINING_PROFILES[roleName];
  const nameKey = normalizeRoleKey(bot && bot.name);
  if (nameKey && ROLE_TRAINING_PROFILES[nameKey]) return ROLE_TRAINING_PROFILES[nameKey];
  return ARCHETYPES.find((entry) => entry.id === (bot && bot.archetype)) || ARCHETYPES[0];
}

function averageOrNull(total, count) {
  return count > 0 ? total / count : null;
}

function finalizeReviewSummary(accumulator) {
  return {
    reviewCount: accumulator.reviewCount,
    reviewScoreAverage: accumulator.reviewCount ? accumulator.reviewScoreTotal / accumulator.reviewCount : 0,
    rejectCount: accumulator.rejectCount,
    watchCount: accumulator.watchCount,
    acceptCount: accumulator.acceptCount,
    funAverage: averageOrNull(accumulator.scoreTotals.fun, accumulator.scoreCounts.fun),
    fairnessAverage: averageOrNull(accumulator.scoreTotals.fairness, accumulator.scoreCounts.fairness),
    skillExpressionAverage: averageOrNull(accumulator.scoreTotals.skillExpression, accumulator.scoreCounts.skillExpression),
    paceAverage: averageOrNull(accumulator.scoreTotals.pace, accumulator.scoreCounts.pace),
    exploitRiskAverage: averageOrNull(accumulator.scoreTotals.exploitRisk, accumulator.scoreCounts.exploitRisk)
  };
}

function aggregateHumanRatings(ratings) {
  const byBot = new Map();
  const summary = {
    reviewCount: ratings.length,
    acceptCount: 0,
    watchCount: 0,
    rejectCount: 0
  };

  for (const rating of ratings) {
    summary[`${rating.decision}Count`] += 1;
    const reviewScore = scoreHumanRating(rating);
    for (const botId of rating.botIds) {
      if (!botId) continue;
      const accumulator = byBot.get(botId) || createReviewAccumulator(botId);
      accumulator.reviewCount += 1;
      accumulator.reviewScoreTotal += reviewScore;
      accumulator[`${rating.decision}Count`] += 1;
      for (const key of Object.keys(accumulator.scoreTotals)) {
        const value = rating.scores[key];
        if (value !== null) {
          accumulator.scoreTotals[key] += value;
          accumulator.scoreCounts[key] += 1;
        }
      }
      byBot.set(botId, accumulator);
    }
  }

  return {
    summary,
    byBot: new Map(Array.from(byBot.entries(), ([botId, accumulator]) => [botId, finalizeReviewSummary(accumulator)]))
  };
}

function getHumanTrainingLookupId(bot) {
  return bot && (bot.sourceBotId || bot.id) ? (bot.sourceBotId || bot.id) : null;
}

function createPromotionCandidate(bot, reviewSummary, humanTrainingSummary) {
  const blockedByReview = !!(reviewSummary && reviewSummary.rejectCount > 0);
  const humanChallengeScore = humanTrainingSummary ? Number(humanTrainingSummary.challengeScore) || 0 : 0;
  const promotionScore = bot.elo +
    (reviewSummary ? reviewSummary.reviewScoreAverage : 0) +
    humanChallengeScore -
    (blockedByReview ? 2000 : 0);
  return {
    ...bot,
    reviewSummary: reviewSummary || null,
    reviewBlocked: blockedByReview,
    humanTrainingSummary: humanTrainingSummary || bot.humanTrainingSummary || null,
    humanChallengeScore,
    promotionScore
  };
}

function summarizePromotionCandidates(populations, reviewRatings, humanTrainingSummaries, limit = 12) {
  return Object.values(populations)
    .flat()
    .map((bot) => createPromotionCandidate(
      bot,
      reviewRatings.byBot.get(bot.id),
      humanTrainingSummaries.get(getHumanTrainingLookupId(bot))
    ))
    .sort((a, b) => b.promotionScore - a.promotionScore || b.elo - a.elo)
    .slice(0, limit)
    .map((bot) => ({
      id: bot.id,
      name: bot.name,
      archetype: bot.archetype,
      generation: bot.generation,
      elo: Math.round(bot.elo),
      promotionScore: Math.round(bot.promotionScore),
      reviewBlocked: !!bot.reviewBlocked,
      reviewSummary: bot.reviewSummary,
      humanTrainingSummary: bot.humanTrainingSummary,
      humanChallengeScore: Number((bot.humanChallengeScore || 0).toFixed(2))
    }));
}

function sampleNormal(random) {
  const u = Math.max(1e-9, random());
  const v = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function getObservationSize() {
  const runtime = simCore.createSimulation({ config, seed: 1 });
  runtime.startMatch({ demo: true, skipCountdown: true, scoreLimit: 1, powerupsEnabled: false, trailsEnabled: false });
  return controllers.flattenObservation(runtime.getObservation('left')).length;
}

function createLayer(outSize, inSize, random, scale = 0.65) {
  const weights = [];
  const biases = [];
  for (let out = 0; out < outSize; out += 1) {
    const row = [];
    for (let input = 0; input < inSize; input += 1) {
      row.push((random() * 2 - 1) * scale);
    }
    weights.push(row);
    biases.push((random() * 2 - 1) * scale);
  }
  return { weights, biases };
}

function createRandomNetwork(inputSize, random) {
  return {
    type: 'mlp',
    inputSize,
    layers: [
      createLayer(12, inputSize, random, 0.45),
      createLayer(8, 12, random, 0.35),
      createLayer(3, 8, random, 0.25)
    ]
  };
}

function cloneNetwork(network) {
  return JSON.parse(JSON.stringify(network));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutateNetwork(network, random) {
  const next = cloneNetwork(network);
  for (const layer of next.layers) {
    for (let i = 0; i < layer.biases.length; i += 1) {
      if (random() < 0.55) layer.biases[i] += sampleNormal(random) * 0.12;
      layer.biases[i] = clamp(layer.biases[i], -3, 3);
    }
    for (const row of layer.weights) {
      for (let i = 0; i < row.length; i += 1) {
        if (random() < 0.22) row[i] += sampleNormal(random) * 0.14;
        row[i] = clamp(row[i], -3, 3);
      }
    }
  }
  return next;
}

function createGenome(archetype, generation, inputSize, random, parent = null) {
  const baseId = `${archetype.id}-${generation}-${Math.floor(random() * 1e9).toString(36)}`;
  const network = parent ? mutateNetwork(parent.network, random) : createRandomNetwork(inputSize, random);
  return {
    id: baseId,
    name: parent && parent.name ? parent.name : `${archetype.label} ${baseId.slice(-4)}`,
    schemaVersion: 1,
    archetype: archetype.id,
    personality: parent && parent.personality ? parent.personality : archetype.personality,
    generation,
    lineageId: parent ? parent.lineageId : baseId,
    sourceBotId: parent ? (parent.sourceBotId || null) : null,
    metadata: parent && parent.metadata ? clone(parent.metadata) : null,
    humanTrainingSummary: parent && parent.humanTrainingSummary ? clone(parent.humanTrainingSummary) : null,
    humanFineTuneSummary: parent && parent.humanFineTuneSummary ? clone(parent.humanFineTuneSummary) : null,
    trainingHours: Number(parent && parent.trainingHours) || 0,
    elo: 1000,
    fitnessScore: 0,
    matches: 0,
    mutationProfile: {
      source: parent ? parent.id : null,
      kind: parent ? 'clone-mutate' : 'seed'
    },
    controllerParams: parent && parent.controllerParams ? clone(parent.controllerParams) : {
      fireThreshold: archetype.id === 'aggressive' ? 0.54 : archetype.id === 'defensive' ? 0.66 : 0.6
    },
    network
  };
}

function normalizeRosterSeed(bot) {
  const archetype = ARCHETYPES.find((entry) => entry.id === bot.archetype) || ARCHETYPES[0];
  return {
    id: bot.id,
    name: bot.name || `${archetype.label} ${String(bot.id || '').slice(-4)}`,
    schemaVersion: 1,
    archetype: archetype.id,
    personality: bot.personality || archetype.personality,
    generation: Number(bot.generation) || 0,
    lineageId: bot.lineageId || bot.id,
    sourceBotId: bot.sourceBotId || bot.id,
    metadata: clone(bot.metadata || null),
    humanTrainingSummary: clone(bot.humanTrainingSummary || (bot.metadata && bot.metadata.humanTrainingSummary) || null),
    humanFineTuneSummary: clone(bot.humanFineTuneSummary || (bot.metadata && bot.metadata.humanFineTuneSummary) || null),
    trainingHours: Number(bot.trainingHours) || Number(bot.metadata && bot.metadata.trainingHours) || 0,
    difficultyBand: bot.difficultyBand || null,
    elo: Number(bot.elo) || 1000,
    fitnessScore: 0,
    matches: 0,
    mutationProfile: bot.mutationProfile || {
      source: bot.id,
      kind: 'roster-seed'
    },
    controllerParams: clone(bot.controllerParams || {
      fireThreshold: archetype.id === 'aggressive' ? 0.54 : archetype.id === 'defensive' ? 0.66 : 0.6
    }),
    network: cloneNetwork(bot.network)
  };
}

function loadRosterBots(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const rosterValue = loadModule(filePath);
  const rawBots = Array.isArray(rosterValue) ? rosterValue : [];
  return rawBots.filter((bot) => bot && bot.network && bot.archetype).map(normalizeRosterSeed);
}

function attachHumanTrainingMetadata(bot, humanTrainingSummary, humanFineTuneSummary) {
  if (!bot) return;
  if (!bot.metadata || typeof bot.metadata !== 'object') bot.metadata = {};
  if (humanTrainingSummary) {
    bot.humanTrainingSummary = clone(humanTrainingSummary);
    bot.metadata.humanTrainingSummary = clone(humanTrainingSummary);
  }
  if (humanFineTuneSummary) {
    bot.humanFineTuneSummary = clone(humanFineTuneSummary);
    bot.metadata.humanFineTuneSummary = clone(humanFineTuneSummary);
  }
}

function applyHumanTrainingToRosterBots(rosterBots, humanTrainingDataset, random, options = {}) {
  const dataset = humanTrainingDataset && Array.isArray(humanTrainingDataset.sessions)
    ? humanTrainingDataset
    : { sessions: [] };
  const enableFineTune = options.enableFineTune !== false;
  const imitationDataset = humanTraining.buildImitationDatasetByBot(dataset.sessions, {
    maxSamplesPerBot: 4000,
    random
  });
  const summary = humanTraining.buildDatasetSummary(dataset.sessions, imitationDataset.sampleCounts);
  const summariesByBot = new Map(summary.byBot.map((entry) => [entry.botId, entry]));
  const fineTuneResults = [];

  for (const bot of rosterBots) {
    const lookupId = getHumanTrainingLookupId(bot);
    const humanSummary = summariesByBot.get(lookupId) || null;
    const samples = imitationDataset.byBot.get(bot.id) || imitationDataset.byBot.get(lookupId) || [];
    let fineTuneSummary = null;
    if (enableFineTune && samples.length) {
      fineTuneSummary = humanTraining.fineTuneBotWithSamples(bot, samples, {
        batchSize: 64,
        epochs: 3,
        learningRate: 0.01,
        random
      });
      fineTuneResults.push({
        botId: bot.id,
        botName: bot.name,
        sourceBotId: bot.sourceBotId || null,
        sampleCount: fineTuneSummary.sampleCount,
        epochs: fineTuneSummary.epochs,
        averageLoss: fineTuneSummary.averageLoss
      });
    }
    if (humanSummary || fineTuneSummary) {
      attachHumanTrainingMetadata(bot, humanSummary, fineTuneSummary);
    }
  }

  const rosterBotIds = new Set(rosterBots.map((bot) => bot.id));
  const unmatchedBotIds = summary.byBot
    .filter((entry) => !rosterBotIds.has(entry.botId))
    .map((entry) => entry.botId);

  return {
    summary,
    summariesByBot,
    fineTuneResults,
    validations: imitationDataset.validations,
    unmatchedBotIds
  };
}

function createPopulation(inputSize, populationSize, random, rosterSeeds = [], options = {}) {
  const populations = {};
  const seedsByArchetype = new Map();
  const focusBotId = options.focusBotId || null;
  const focusedSeed = focusBotId
    ? rosterSeeds.find((bot) => bot.id === focusBotId || bot.sourceBotId === focusBotId) || null
    : null;
  for (const archetype of ARCHETYPES) {
    seedsByArchetype.set(archetype.id, []);
  }
  for (const seedBot of rosterSeeds) {
    if (!seedsByArchetype.has(seedBot.archetype)) seedsByArchetype.set(seedBot.archetype, []);
    seedsByArchetype.get(seedBot.archetype).push(clone(seedBot));
  }
  for (const archetype of ARCHETYPES) {
    if (focusedSeed && archetype.id !== focusedSeed.archetype) {
      populations[archetype.id] = [];
      continue;
    }
    const seeded = seedsByArchetype.get(archetype.id) || [];
    populations[archetype.id] = seeded.map((bot) => ({
      ...clone(bot),
      fitnessScore: 0,
      matches: 0
    }));
    const targetSize = Math.max(populationSize, populations[archetype.id].length);
    while (populations[archetype.id].length < targetSize) {
      populations[archetype.id].push(focusedSeed && archetype.id === focusedSeed.archetype
        ? createGenome(archetype, 0, inputSize, random, focusedSeed)
        : createGenome(archetype, 0, inputSize, random));
    }
  }
  return populations;
}

function buildController(bot) {
  return controllers.createNeuralController(bot);
}

function updateElo(left, right, result) {
  const k = 24;
  const expectedLeft = 1 / (1 + Math.pow(10, (right.elo - left.elo) / 400));
  const expectedRight = 1 - expectedLeft;
  left.elo += k * (result.left - expectedLeft);
  right.elo += k * (result.right - expectedRight);
}

function updateEloAgainstFixed(bot, opponentElo, score) {
  const k = 24;
  const expected = 1 / (1 + Math.pow(10, (opponentElo - bot.elo) / 400));
  bot.elo += k * (score - expected);
}

function scoreMetrics(weights, metrics) {
  let total = 0;
  for (const [key, weight] of Object.entries(weights || {})) {
    const value = Number(metrics[key]);
    total += (Number.isFinite(value) ? value : 0) * weight;
  }
  return total;
}

function evaluateMatch(leftBot, rightBot, seed, settings) {
  const runtime = simCore.createSimulation({ config, seed });
  runtime.setControllers({
    left: buildController(leftBot),
    right: buildController(rightBot)
  });
  runtime.startMatch({
    demo: true,
    skipCountdown: true,
    difficulty: 'spicy',
    scoreLimit: settings.scoreLimit,
    powerupsEnabled: true,
    trailsEnabled: false,
    theme: 'neon'
  });

  let maxBallSpeed = 0;
  while (!runtime.state.gameOver && runtime.state.tick < settings.maxTicks) {
    runtime.stepSimulation(1);
    for (const ball of runtime.world.balls) {
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > maxBallSpeed) maxBallSpeed = speed;
    }
  }

  const leftWon = runtime.state.leftScore > runtime.state.rightScore;
  const rightWon = runtime.state.rightScore > runtime.state.leftScore;
  const leftRoleMetrics = runtime.matchStats.leftRoleMetrics || {};
  const rightRoleMetrics = runtime.matchStats.rightRoleMetrics || {};
  const result = {
    left: leftWon ? 1 : rightWon ? 0 : 0.5,
    right: rightWon ? 1 : leftWon ? 0 : 0.5
  };

  const leftMetrics = {
    win: result.left,
    goalDiff: runtime.state.leftScore - runtime.state.rightScore,
    rally: runtime.matchStats.longestRally || runtime.state.bestRally || 0,
    longestRally: runtime.matchStats.longestRally || runtime.state.bestRally || 0,
    shots: runtime.matchStats.leftShots,
    powerups: runtime.matchStats.leftPowerups,
    againstGoals: runtime.state.rightScore,
    blueShots: leftRoleMetrics.blueShots || 0,
    pinkShots: leftRoleMetrics.pinkShots || 0,
    goldShots: leftRoleMetrics.goldShots || 0,
    nonBlueShots: (leftRoleMetrics.pinkShots || 0) + (leftRoleMetrics.goldShots || 0),
    nonPinkShots: (leftRoleMetrics.blueShots || 0) + (leftRoleMetrics.goldShots || 0),
    nonGoldShots: (leftRoleMetrics.blueShots || 0) + (leftRoleMetrics.pinkShots || 0),
    blueBallHits: leftRoleMetrics.blueBallHits || 0,
    pinkBallHits: leftRoleMetrics.pinkBallHits || 0,
    goldBallHits: leftRoleMetrics.goldBallHits || 0,
    blueTowardHits: leftRoleMetrics.blueTowardHits || 0,
    blueAwayHits: leftRoleMetrics.blueAwayHits || 0,
    blueResistGrants: leftRoleMetrics.blueResistGrants || 0,
    pinkThreatHits: leftRoleMetrics.pinkThreatHits || 0,
    pinkEmergencyHits: leftRoleMetrics.pinkEmergencyHits || 0,
    blueWavePowerups: leftRoleMetrics.blueWavePowerups || 0,
    pinkWavePowerups: leftRoleMetrics.pinkWavePowerups || 0,
    goldWavePowerups: leftRoleMetrics.goldWavePowerups || 0,
    goldPaddleHits: leftRoleMetrics.goldPaddleHits || 0,
    goldCenterHits: leftRoleMetrics.goldCenterHits || 0
  };

  const rightMetrics = {
    win: result.right,
    goalDiff: runtime.state.rightScore - runtime.state.leftScore,
    rally: runtime.matchStats.longestRally || runtime.state.bestRally || 0,
    longestRally: runtime.matchStats.longestRally || runtime.state.bestRally || 0,
    shots: runtime.matchStats.rightShots,
    powerups: runtime.matchStats.rightPowerups,
    againstGoals: runtime.state.leftScore,
    blueShots: rightRoleMetrics.blueShots || 0,
    pinkShots: rightRoleMetrics.pinkShots || 0,
    goldShots: rightRoleMetrics.goldShots || 0,
    nonBlueShots: (rightRoleMetrics.pinkShots || 0) + (rightRoleMetrics.goldShots || 0),
    nonPinkShots: (rightRoleMetrics.blueShots || 0) + (rightRoleMetrics.goldShots || 0),
    nonGoldShots: (rightRoleMetrics.blueShots || 0) + (rightRoleMetrics.pinkShots || 0),
    blueBallHits: rightRoleMetrics.blueBallHits || 0,
    pinkBallHits: rightRoleMetrics.pinkBallHits || 0,
    goldBallHits: rightRoleMetrics.goldBallHits || 0,
    blueTowardHits: rightRoleMetrics.blueTowardHits || 0,
    blueAwayHits: rightRoleMetrics.blueAwayHits || 0,
    blueResistGrants: rightRoleMetrics.blueResistGrants || 0,
    pinkThreatHits: rightRoleMetrics.pinkThreatHits || 0,
    pinkEmergencyHits: rightRoleMetrics.pinkEmergencyHits || 0,
    blueWavePowerups: rightRoleMetrics.blueWavePowerups || 0,
    pinkWavePowerups: rightRoleMetrics.pinkWavePowerups || 0,
    goldWavePowerups: rightRoleMetrics.goldWavePowerups || 0,
    goldPaddleHits: rightRoleMetrics.goldPaddleHits || 0,
    goldCenterHits: rightRoleMetrics.goldCenterHits || 0
  };

  return {
    runtime,
    result,
    leftMetrics,
    rightMetrics,
    maxBallSpeed
  };
}

function makeReplayBundle(match, leftBot, rightBot, seed) {
  return {
    replayId: `${leftBot.id}-vs-${rightBot.id}-${seed}`,
    createdAt: new Date().toISOString(),
    runtimeVersion,
    configHash: match.runtime.serializeReplay().configHash,
    seed,
    durationTicks: match.runtime.state.tick,
    matchOptions: {
      demo: true,
      skipCountdown: true,
      difficulty: 'spicy',
      scoreLimit: match.runtime.state.scoreLimit,
      powerupsEnabled: true,
      trailsEnabled: false,
      theme: 'neon'
    },
    botIds: [leftBot.id, rightBot.id],
    leftBot,
    rightBot,
    replay: match.runtime.serializeReplay(),
    final: {
      leftScore: match.runtime.state.leftScore,
      rightScore: match.runtime.state.rightScore,
      hash: match.runtime.hashSimulationState()
    },
    metrics: {
      leftShots: match.runtime.matchStats.leftShots,
      rightShots: match.runtime.matchStats.rightShots,
      leftPowerups: match.runtime.matchStats.leftPowerups,
      rightPowerups: match.runtime.matchStats.rightPowerups,
      longestRally: match.runtime.matchStats.longestRally || 0,
      maxBallSpeed: match.maxBallSpeed,
      leftRoleMetrics: match.runtime.matchStats.leftRoleMetrics || null,
      rightRoleMetrics: match.runtime.matchStats.rightRoleMetrics || null
    }
  };
}

function runGeneration(populations, generation, random, settings) {
  const mutableBots = Object.values(populations).flat();
  const staticBots = Array.isArray(settings.staticBots) ? settings.staticBots : [];
  const allBots = mutableBots.concat(staticBots);
  const replayBundles = [];
  const totalMatches = allBots.reduce((sum, _, i) => {
    let rowCount = 0;
    for (let j = i + 1; j < allBots.length; j += 1) {
      if (!(allBots[i].isStaticRosterBot && allBots[j].isStaticRosterBot)) rowCount += 1;
    }
    return sum + rowCount;
  }, 0);
  const progressEveryMatches = Math.max(1, Math.floor(settings.progressEveryMatches || Math.max(25, totalMatches / 20)));
  let processedMatches = 0;

  for (const bot of mutableBots) {
    bot.fitnessScore = 0;
    bot.matches = 0;
  }

  for (let i = 0; i < allBots.length; i += 1) {
    for (let j = i + 1; j < allBots.length; j += 1) {
      const leftBot = allBots[i];
      const rightBot = allBots[j];
      const leftIsStatic = !!leftBot.isStaticRosterBot;
      const rightIsStatic = !!rightBot.isStaticRosterBot;
      if (leftIsStatic && rightIsStatic) continue;
      const seed = Math.floor(random() * 1e9);
      const match = evaluateMatch(leftBot, rightBot, seed, settings);
      const leftProfile = getTrainingProfile(leftBot);
      const rightProfile = getTrainingProfile(rightBot);

      if (!leftIsStatic) {
        leftBot.fitnessScore += scoreMetrics(leftProfile.fitness, match.leftMetrics);
        leftBot.matches += 1;
      }
      if (!rightIsStatic) {
        rightBot.fitnessScore += scoreMetrics(rightProfile.fitness, match.rightMetrics);
        rightBot.matches += 1;
      }

      if (!leftIsStatic && !rightIsStatic) {
        updateElo(leftBot, rightBot, match.result);
      } else if (!leftIsStatic) {
        updateEloAgainstFixed(leftBot, Number(rightBot.elo) || 1000, match.result.left);
      } else if (!rightIsStatic) {
        updateEloAgainstFixed(rightBot, Number(leftBot.elo) || 1000, match.result.right);
      }

      if (replayBundles.length < 8 || match.maxBallSpeed > config.balance.ball.speedCap * 1.15) {
        replayBundles.push(makeReplayBundle(match, leftBot, rightBot, seed));
      }

      processedMatches += 1;
      if (
        typeof settings.onProgress === 'function' &&
        (processedMatches === totalMatches || processedMatches % progressEveryMatches === 0)
      ) {
        settings.onProgress({
          generation,
          processedMatches,
          totalMatches
        });
      }
    }
  }

  const nextPopulations = {};
  const summary = [];
  for (const archetype of ARCHETYPES) {
    const ranked = populations[archetype.id]
      .slice()
      .sort((a, b) => (b.fitnessScore / Math.max(1, b.matches)) - (a.fitnessScore / Math.max(1, a.matches)));
    if (!ranked.length) {
      nextPopulations[archetype.id] = [];
      continue;
    }
    summary.push({
      archetype: archetype.id,
      topBotId: ranked[0].id,
      topFitness: ranked[0].fitnessScore / Math.max(1, ranked[0].matches),
      topElo: ranked[0].elo
    });
    const elites = ranked.slice(0, Math.max(2, Math.floor(ranked.length / 3)));
    nextPopulations[archetype.id] = elites.map((bot) => ({
      ...JSON.parse(JSON.stringify(bot)),
      generation: generation + 1
    }));

    while (nextPopulations[archetype.id].length < ranked.length) {
      const parent = elites[Math.floor(random() * elites.length)];
      nextPopulations[archetype.id].push(createGenome(archetype, generation + 1, settings.inputSize, random, parent));
    }
  }

  return { nextPopulations, summary, replayBundles, totalMatches };
}

function assignDifficultyBands(rankedBots) {
  return rankedBots.map((bot, index) => {
    const ratio = rankedBots.length <= 1 ? 1 : index / (rankedBots.length - 1);
    const difficultyBand = ratio < 0.34 ? 'absurd' : ratio < 0.67 ? 'spicy' : 'chill';
    return {
      ...bot,
      difficultyBand
    };
  });
}

function summarizeRosterConfig(args, rosterSeedBots, staticRosterBots) {
  if (args.focusBotId) {
    return `focused bot=${args.focusBotId}, selfPlay=${args.selfPlay}, mutable seeds=${rosterSeedBots.length}, static opponents=${staticRosterBots.length}`;
  }
  if (args.rosterMode === 'mutable') {
    return `mutable roster seeds=${rosterSeedBots.length}${args.updateAllRoster ? ' (update-all enabled)' : ''}`;
  }
  if (args.rosterMode === 'static') {
    return `static roster opponents=${staticRosterBots.length}`;
  }
  return 'no roster participation';
}

function buildFocusedBotExport(promotionCandidates, focusSeedBot) {
  if (!focusSeedBot) return [];
  const bestCandidate = promotionCandidates
    .filter((bot) => (bot.sourceBotId || bot.id) === focusSeedBot.id)
    .sort((a, b) => b.promotionScore - a.promotionScore || b.elo - a.elo)[0] || focusSeedBot;
  return [{
    ...bestCandidate,
    id: focusSeedBot.id,
    name: focusSeedBot.name,
    personality: focusSeedBot.personality,
    sourceBotId: focusSeedBot.id,
    difficultyBand: focusSeedBot.difficultyBand || bestCandidate.difficultyBand || null,
    metadata: focusSeedBot.metadata ? clone(focusSeedBot.metadata) : null
  }];
}

function buildUpdateAllRosterExport(promotionCandidates, rosterSeedBots) {
  return rosterSeedBots.map((seedBot) => {
    const bestCandidate = promotionCandidates
      .filter((bot) => (bot.sourceBotId || bot.id) === seedBot.id)
      .sort((a, b) => b.promotionScore - a.promotionScore || b.elo - a.elo)[0] || seedBot;
    return {
      ...bestCandidate,
      id: seedBot.id,
      name: seedBot.name,
      personality: seedBot.personality,
      sourceBotId: seedBot.id,
      difficultyBand: seedBot.difficultyBand || bestCandidate.difficultyBand || null,
      metadata: seedBot.metadata ? clone(seedBot.metadata) : null
    };
  }).sort((a, b) => (Number(b.elo) || 0) - (Number(a.elo) || 0));
}

function buildRankedBotsForExport(populations, reviewRatings, humanTrainingSummaries, args, focusSeedBot, mutableRosterSeeds) {
  const promotionCandidates = Object.values(populations)
    .flat()
    .map((bot) => createPromotionCandidate(
      bot,
      reviewRatings.byBot.get(bot.id),
      humanTrainingSummaries.get(getHumanTrainingLookupId(bot))
    ))
    .sort((a, b) => b.promotionScore - a.promotionScore || b.elo - a.elo);

  const exportPool = promotionCandidates.filter((bot) => !bot.reviewBlocked);
  const selectedForExport = args.focusBotId
    ? buildFocusedBotExport(exportPool.length ? exportPool : promotionCandidates, focusSeedBot)
    : args.updateAllRoster
    ? buildUpdateAllRosterExport(exportPool.length ? exportPool : promotionCandidates, mutableRosterSeeds)
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
    metadata: bot.metadata ? clone(bot.metadata) : null,
    trainingHours: Number((Number(bot.trainingHours) || 0).toFixed(3)),
    controllerParams: bot.controllerParams,
    mutationProfile: bot.mutationProfile,
    network: bot.network,
    reviewBlocked: !!bot.reviewBlocked,
    reviewSummary: bot.reviewSummary,
    humanTrainingSummary: bot.humanTrainingSummary ? clone(bot.humanTrainingSummary) : null,
    humanFineTuneSummary: bot.humanFineTuneSummary ? clone(bot.humanFineTuneSummary) : null,
    humanChallengeScore: Number((bot.humanChallengeScore || 0).toFixed(2))
  }));

  return {
    promotionCandidates,
    rankedBots
  };
}

function formatRoleLabel(bot) {
  const roleName = bot && bot.metadata && bot.metadata.roleName;
  return roleName ? `${bot.name} [${roleName}]` : bot.name;
}

function summarizeArchetypeLeaders(promotionCandidates) {
  const parts = [];
  for (const archetype of ARCHETYPES) {
    const leader = promotionCandidates.find((bot) => bot.archetype === archetype.id);
    if (!leader) continue;
    parts.push(
      `${archetype.id}:${leader.id} elo=${Math.round(leader.elo)} score=${Math.round(leader.promotionScore)}`
    );
  }
  return parts;
}

function summarizeExportedBots(rankedBots) {
  return rankedBots.map((bot, index) => {
    const bits = [
      `#${index + 1}`,
      `${formatRoleLabel(bot)} (${bot.id})`,
      `elo=${bot.elo}`,
      `score=${bot.promotionScore}`
    ];
    if (bot.trainingHours !== undefined) bits.push(`hours=${bot.trainingHours}`);
    if (bot.reviewBlocked) bits.push('reviewBlocked');
    if (bot.humanTrainingSummary) bits.push(`humanChallenge=${Number(bot.humanChallengeScore || 0).toFixed(1)}`);
    return bits.join(' | ');
  });
}

function autoPublishRuntimeBots(exportFile, reportsDir) {
  const publishScript = path.join(repoRoot, 'tools', 'publish-bots.js');
  const publishReport = path.join(reportsDir, 'published-bots-report.json');
  childProcess.execFileSync(process.execPath, [publishScript, '--source', exportFile, '--report', publishReport], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
}

function writeBotsScript(filePath, bots) {
  const payload = JSON.stringify(bots, null, 2);
  const script = `(function (root) {\n  const bots = ${payload};\n  if (typeof module === 'object' && module.exports) {\n    module.exports = bots;\n  }\n  if (root) {\n    root.WavePong = root.WavePong || {};\n    root.WavePong.BOTS = bots;\n  }\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n`;
  fs.writeFileSync(filePath, script, 'utf8');
}

function writeGenerationCheckpoint(checkpointsDir, payload) {
  ensureDir(checkpointsDir);
  const completedGeneration = payload.generationCompleted + 1;
  const generationFile = path.join(checkpointsDir, `generation-${String(completedGeneration).padStart(3, '0')}.json`);
  const latestFile = path.join(checkpointsDir, 'latest-evolution-checkpoint.json');
  writeJson(generationFile, payload);
  writeJson(latestFile, payload);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(args.reportsDir);
  ensureDir(path.join(args.reportsDir, 'replays'));
  const checkpointsDir = path.join(args.reportsDir, 'checkpoints');
  ensureDir(checkpointsDir);
  const humanRatings = loadHumanRatings(args.ratingsFile);
  const reviewRatings = aggregateHumanRatings(humanRatings);
  const invokedCommand = ['node', 'tools/evolve-bots.js', ...process.argv.slice(2)].map(formatCommandArg).join(' ');
  const rosterBots = loadRosterBots(args.rosterFile);
  const humanTrainingDataset = humanTraining.loadDataset(args.humanTrainingFile);
  const inputSize = getObservationSize();
  const random = createSeededRandom(args.seed);
  const humanTrainingRandom = createSeededRandom(args.seed + 17);
  const humanFineTuneEnabled = !!(args.focusBotId || args.updateAllRoster || args.rosterMode !== 'none');
  const humanTrainingReport = applyHumanTrainingToRosterBots(
    rosterBots,
    humanTrainingDataset,
    humanTrainingRandom,
    { enableFineTune: humanFineTuneEnabled }
  );
  if (args.updateAllRoster && !rosterBots.length) {
    throw new Error(`--update-all-roster requires a non-empty roster file: ${args.rosterFile}`);
  }
  if (humanTrainingReport.summary.sessionCount && !rosterBots.length) {
    console.warn(`Human training dataset has ${humanTrainingReport.summary.sessionCount} session(s), but no roster bots were loaded for fine-tuning.`);
  }
  if (humanTrainingReport.summary.sessionCount && !humanFineTuneEnabled) {
    console.warn('Human training fine-tuning was skipped because this run is not using roster seeds.');
  }
  if (humanTrainingReport.unmatchedBotIds.length) {
    console.warn(`Human training sessions had no matching roster seed for: ${humanTrainingReport.unmatchedBotIds.join(', ')}`);
  }
  const focusSeedBot = args.focusBotId
    ? rosterBots.find((bot) => bot.id === args.focusBotId || bot.sourceBotId === args.focusBotId) || null
    : null;
  if (args.focusBotId && !focusSeedBot) {
    throw new Error(`Focused bot not found in roster: ${args.focusBotId}`);
  }
  const mutableRosterSeeds = args.focusBotId
    ? (focusSeedBot ? [focusSeedBot] : [])
    : (args.rosterMode === 'mutable' ? rosterBots : []);
  const staticRosterBots = args.focusBotId
    ? (args.selfPlay
      ? []
      : rosterBots
        .filter((bot) => bot.id !== focusSeedBot.id)
        .map((bot) => ({ ...clone(bot), isStaticRosterBot: true })))
    : (args.rosterMode === 'static'
      ? rosterBots.map((bot) => ({ ...clone(bot), isStaticRosterBot: true }))
      : []);

  let populations = createPopulation(inputSize, args.population, random, mutableRosterSeeds, {
    focusBotId: focusSeedBot ? focusSeedBot.id : null
  });
  const generationReports = [];
  let finalReplayBundles = [];
  const totalBots = Object.values(populations).flat().length;
  const matchesPerGeneration = countTrainingMatches(totalBots, staticRosterBots.length);
  const totalPlannedMatches = matchesPerGeneration * args.generations;
  const overallStartedAt = Date.now();

  console.log(`Training ${totalBots} bots across ${ARCHETYPES.length} archetypes for ${args.generations} generations.`);
  console.log(`Each generation evaluates ${matchesPerGeneration} matches; total planned matches: ${totalPlannedMatches}.`);
  console.log(
    `scoreLimit=${args.scoreLimit}, maxTicks=${args.maxTicks}, checkpointEvery=${args.checkpointEvery}, progressEvery=${args.progressEveryMatches}` +
    `, roster=${summarizeRosterConfig(args, mutableRosterSeeds, staticRosterBots)}, publishRuntime=${args.publishRuntime}, autoPromoteEvery=${args.autoPromoteEvery}`
  );
  console.log(
    `humanTrainingSessions=${humanTrainingReport.summary.sessionCount}, humanTrainingBots=${humanTrainingReport.summary.botCount}, ` +
    `fineTunedBots=${humanTrainingReport.fineTuneResults.length}, humanTrainingFile=${args.humanTrainingFile}`
  );

  for (let generation = 0; generation < args.generations; generation += 1) {
    const generationLabel = `[Gen ${generation + 1}/${args.generations}]`;
    const generationStartedAt = Date.now();
    console.log(`${generationLabel} starting`);

    const { nextPopulations, summary, replayBundles, totalMatches } = runGeneration(populations, generation, random, {
      scoreLimit: args.scoreLimit,
      maxTicks: args.maxTicks,
      inputSize,
      staticBots: staticRosterBots,
      progressEveryMatches: args.progressEveryMatches,
      onProgress(progress) {
        const elapsedMs = Date.now() - overallStartedAt;
        const overallProcessedMatches = generation * matchesPerGeneration + progress.processedMatches;
        const overallRatio = totalPlannedMatches > 0 ? overallProcessedMatches / totalPlannedMatches : 1;
        const etaMs = overallProcessedMatches > 0
          ? (elapsedMs / overallProcessedMatches) * (totalPlannedMatches - overallProcessedMatches)
          : 0;
        console.log(
          `${generationLabel} ${progress.processedMatches}/${progress.totalMatches} matches (${formatPercent(progress.processedMatches / progress.totalMatches)})` +
          ` | overall ${overallProcessedMatches}/${totalPlannedMatches} (${formatPercent(overallRatio)})` +
          ` | elapsed ${formatDuration(elapsedMs)}` +
          ` | eta ${formatDuration(etaMs)}`
        );
      }
    });
    const generationElapsedMs = Date.now() - generationStartedAt;
    generationReports.push({
      generation,
      totalMatches,
      elapsedMs: generationElapsedMs,
      summary
    });
    const generationTrainingHours = generationElapsedMs / 3600000;
    Object.values(nextPopulations).forEach((bots) => {
      bots.forEach((bot) => {
        bot.trainingHours = (Number(bot.trainingHours) || 0) + generationTrainingHours;
      });
    });
    populations = nextPopulations;
    finalReplayBundles = replayBundles;

    const topSummaryText = summary
      .map((entry) => `${entry.archetype}:${entry.topBotId} elo=${Math.round(entry.topElo)}`)
      .join(' | ');
    console.log(`${generationLabel} completed in ${formatDuration(generationElapsedMs)} | ${topSummaryText}`);

    if (args.checkpointEvery > 0 && ((generation + 1) % args.checkpointEvery === 0 || generation === args.generations - 1)) {
      const elapsedMs = Date.now() - overallStartedAt;
      const completedMatches = (generation + 1) * matchesPerGeneration;
      const checkpoint = {
        createdAt: new Date().toISOString(),
        runtimeVersion,
        seed: args.seed,
        generationCompleted: generation,
        generationsPlanned: args.generations,
        populationPerArchetype: args.population,
        scoreLimit: args.scoreLimit,
        maxTicks: args.maxTicks,
        progressEveryMatches: args.progressEveryMatches,
        matchesPerGeneration,
        totalPlannedMatches,
        completedMatches,
        elapsedMs,
        trainingHoursAddedThisGeneration: generationTrainingHours,
        generationReports,
        topCandidates: summarizePromotionCandidates(populations, reviewRatings, humanTrainingReport.summariesByBot)
      };
      writeGenerationCheckpoint(checkpointsDir, checkpoint);
      console.log(`${generationLabel} checkpoint written to ${checkpointsDir}`);
    }

    if (
      args.publishRuntime &&
      args.autoPromoteEvery > 0 &&
      (generation + 1) < args.generations &&
      ((generation + 1) % args.autoPromoteEvery === 0)
    ) {
      const autoPromotion = buildRankedBotsForExport(
        populations,
        reviewRatings,
        humanTrainingReport.summariesByBot,
        args,
        focusSeedBot,
        mutableRosterSeeds
      );
      writeBotsScript(args.exportFile, autoPromotion.rankedBots);
      autoPublishRuntimeBots(args.exportFile, args.reportsDir);
    }
  }

  const { promotionCandidates, rankedBots } = buildRankedBotsForExport(
    populations,
    reviewRatings,
    humanTrainingReport.summariesByBot,
    args,
    focusSeedBot,
    mutableRosterSeeds
  );

  writeBotsScript(args.exportFile, rankedBots);
  const totalElapsedMs = Date.now() - overallStartedAt;

  const report = {
    createdAt: new Date().toISOString(),
    runtimeVersion,
    seed: args.seed,
    generations: args.generations,
    populationPerArchetype: args.population,
    rosterMode: args.rosterMode,
    focusBotId: args.focusBotId,
    selfPlay: args.selfPlay,
    updateAllRoster: args.updateAllRoster,
    rosterFileUsed: args.rosterFile,
    rosterSeedCount: mutableRosterSeeds.length,
    staticRosterCount: staticRosterBots.length,
    publishRuntime: args.publishRuntime,
    inputSize,
    matchesPerGeneration,
    totalPlannedMatches,
    elapsedMs: totalElapsedMs,
    elapsedTrainingHours: Number((totalElapsedMs / 3600000).toFixed(3)),
    ratingsFileUsed: args.ratingsFile,
    humanTrainingFileUsed: args.humanTrainingFile,
    humanReviewSummary: reviewRatings.summary,
    humanTrainingSummary: humanTrainingReport.summary,
    humanTrainingFineTuneResults: humanTrainingReport.fineTuneResults,
    humanTrainingReplayValidations: humanTrainingReport.validations,
    unmatchedHumanTrainingBotIds: humanTrainingReport.unmatchedBotIds,
    generationReports,
    blockedBots: promotionCandidates
      .filter((bot) => bot.reviewBlocked)
      .map((bot) => ({
        id: bot.id,
        name: bot.name,
        archetype: bot.archetype,
        elo: Math.round(bot.elo),
        promotionScore: Math.round(bot.promotionScore),
        trainingHours: Number((Number(bot.trainingHours) || 0).toFixed(3)),
        reviewSummary: bot.reviewSummary,
        humanTrainingSummary: bot.humanTrainingSummary,
        humanChallengeScore: Number((bot.humanChallengeScore || 0).toFixed(2))
      })),
    exportedBots: rankedBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      roleName: bot.metadata && bot.metadata.roleName ? bot.metadata.roleName : null,
      archetype: bot.archetype,
      difficultyBand: bot.difficultyBand,
      elo: bot.elo,
      promotionScore: bot.promotionScore,
      trainingHours: bot.trainingHours,
      reviewBlocked: bot.reviewBlocked,
      reviewSummary: bot.reviewSummary,
      humanTrainingSummary: bot.humanTrainingSummary,
      humanFineTuneSummary: bot.humanFineTuneSummary,
      humanChallengeScore: bot.humanChallengeScore
    }))
  };

  const reportPath = path.join(args.reportsDir, 'latest-evolution-report.json');
  writeJson(reportPath, report);

  finalReplayBundles.slice(0, 8).forEach((bundle) => {
    const outputPath = path.join(args.reportsDir, 'replays', `${bundle.replayId}.json`);
    writeJson(outputPath, bundle);
  });

  console.log(`Training completed in ${formatDuration(totalElapsedMs)}.`);
  console.log(`Elapsed: ${totalElapsedMs} ms | ${(totalElapsedMs / 1000).toFixed(3)} s | ${(totalElapsedMs / 3600000).toFixed(4)} h`);
  console.log(`Evolved ${rankedBots.length} bots and exported them to ${args.exportFile}`);
  console.log(`Report written to ${reportPath}`);
  console.log(`Run summary: matches/generation=${matchesPerGeneration}, totalMatches=${totalPlannedMatches}, rosterSeeds=${mutableRosterSeeds.length}, staticRoster=${staticRosterBots.length}`);
  const archetypeLeaderSummary = summarizeArchetypeLeaders(promotionCandidates);
  if (archetypeLeaderSummary.length) {
    console.log(`Archetype leaders: ${archetypeLeaderSummary.join(' | ')}`);
  }
  const exportedSummary = summarizeExportedBots(rankedBots);
  if (exportedSummary.length) {
    console.log('Exported bot summary:');
    exportedSummary.forEach((line) => console.log(`  ${line}`));
  }
  if (report.blockedBots.length) {
    console.log('Blocked bot summary:');
    report.blockedBots.forEach((bot) => {
      console.log(`  ${bot.id} | elo=${bot.elo} | score=${bot.promotionScore} | hours=${bot.trainingHours}`);
    });
  }
  console.log('Copy/paste to rerun:');
  console.log(invokedCommand);
  if (args.publishRuntime) {
    autoPublishRuntimeBots(args.exportFile, args.reportsDir);
  }
}

main();
