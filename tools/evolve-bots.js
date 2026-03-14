#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const config = require(path.join(repoRoot, 'runtime/js/config.js'));
const simCore = require(path.join(repoRoot, 'runtime/js/sim-core.js'));
const controllers = require(path.join(repoRoot, 'runtime/js/controllers.js'));
const runtimeVersion = require(path.join(repoRoot, 'runtime/js/version.js'));

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

function parseArgs(argv) {
  const args = {
    generations: 3,
    population: 6,
    seed: 1337,
    scoreLimit: 5,
    maxTicks: 120 * 90,
    reportsDir: path.join(repoRoot, 'tools', 'reports'),
    exportFile: path.join(repoRoot, 'runtime', 'js', 'bots.js'),
    ratingsFile: path.join(repoRoot, 'tools', 'reports', 'review-ratings.json')
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
    else throw new Error(`Unknown argument: ${arg}`);
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

function createPromotionCandidate(bot, reviewSummary) {
  const blockedByReview = !!(reviewSummary && reviewSummary.rejectCount > 0);
  const promotionScore = bot.elo + (reviewSummary ? reviewSummary.reviewScoreAverage : 0) - (blockedByReview ? 2000 : 0);
  return {
    ...bot,
    reviewSummary: reviewSummary || null,
    reviewBlocked: blockedByReview,
    promotionScore
  };
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
    name: `${archetype.label} ${baseId.slice(-4)}`,
    schemaVersion: 1,
    archetype: archetype.id,
    personality: archetype.personality,
    generation,
    lineageId: parent ? parent.lineageId : baseId,
    elo: 1000,
    fitnessScore: 0,
    matches: 0,
    mutationProfile: {
      source: parent ? parent.id : null,
      kind: parent ? 'clone-mutate' : 'seed'
    },
    controllerParams: {
      fireThreshold: archetype.id === 'aggressive' ? 0.54 : archetype.id === 'defensive' ? 0.66 : 0.6
    },
    network
  };
}

function createPopulation(inputSize, populationSize, random) {
  const populations = {};
  for (const archetype of ARCHETYPES) {
    populations[archetype.id] = [];
    for (let i = 0; i < populationSize; i += 1) {
      populations[archetype.id].push(createGenome(archetype, 0, inputSize, random));
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

function scoreMetrics(weights, metrics) {
  return (
    metrics.win * weights.win +
    metrics.goalDiff * weights.goalDiff +
    metrics.longestRally * weights.rally +
    metrics.shots * weights.shots +
    metrics.powerups * weights.powerups +
    metrics.againstGoals * weights.againstGoals
  );
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
  const result = {
    left: leftWon ? 1 : rightWon ? 0 : 0.5,
    right: rightWon ? 1 : leftWon ? 0 : 0.5
  };

  const leftMetrics = {
    win: result.left,
    goalDiff: runtime.state.leftScore - runtime.state.rightScore,
    longestRally: runtime.matchStats.longestRally || runtime.state.bestRally || 0,
    shots: runtime.matchStats.leftShots,
    powerups: runtime.matchStats.leftPowerups,
    againstGoals: runtime.state.rightScore
  };

  const rightMetrics = {
    win: result.right,
    goalDiff: runtime.state.rightScore - runtime.state.leftScore,
    longestRally: runtime.matchStats.longestRally || runtime.state.bestRally || 0,
    shots: runtime.matchStats.rightShots,
    powerups: runtime.matchStats.rightPowerups,
    againstGoals: runtime.state.leftScore
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
      maxBallSpeed: match.maxBallSpeed
    }
  };
}

function runGeneration(populations, generation, random, settings) {
  const allBots = Object.values(populations).flat();
  const replayBundles = [];

  for (const bot of allBots) {
    bot.fitnessScore = 0;
    bot.matches = 0;
  }

  for (let i = 0; i < allBots.length; i += 1) {
    for (let j = i + 1; j < allBots.length; j += 1) {
      const leftBot = allBots[i];
      const rightBot = allBots[j];
      const seed = Math.floor(random() * 1e9);
      const match = evaluateMatch(leftBot, rightBot, seed, settings);
      const leftArchetype = ARCHETYPES.find((entry) => entry.id === leftBot.archetype);
      const rightArchetype = ARCHETYPES.find((entry) => entry.id === rightBot.archetype);

      leftBot.fitnessScore += scoreMetrics(leftArchetype.fitness, match.leftMetrics);
      rightBot.fitnessScore += scoreMetrics(rightArchetype.fitness, match.rightMetrics);
      leftBot.matches += 1;
      rightBot.matches += 1;
      updateElo(leftBot, rightBot, match.result);

      if (replayBundles.length < 8 || match.maxBallSpeed > config.balance.ball.speedCap * 1.15) {
        replayBundles.push(makeReplayBundle(match, leftBot, rightBot, seed));
      }
    }
  }

  const nextPopulations = {};
  const summary = [];
  for (const archetype of ARCHETYPES) {
    const ranked = populations[archetype.id]
      .slice()
      .sort((a, b) => (b.fitnessScore / Math.max(1, b.matches)) - (a.fitnessScore / Math.max(1, a.matches)));
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

  return { nextPopulations, summary, replayBundles };
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

function writeBotsScript(filePath, bots) {
  const payload = JSON.stringify(bots, null, 2);
  const script = `(function (root) {\n  const bots = ${payload};\n  if (typeof module === 'object' && module.exports) {\n    module.exports = bots;\n  }\n  if (root) {\n    root.WavePong = root.WavePong || {};\n    root.WavePong.BOTS = bots;\n  }\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n`;
  fs.writeFileSync(filePath, script, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureDir(args.reportsDir);
  ensureDir(path.join(args.reportsDir, 'replays'));
  const humanRatings = loadHumanRatings(args.ratingsFile);
  const reviewRatings = aggregateHumanRatings(humanRatings);

  const inputSize = getObservationSize();
  const random = createSeededRandom(args.seed);
  let populations = createPopulation(inputSize, args.population, random);
  const generationReports = [];
  let finalReplayBundles = [];

  for (let generation = 0; generation < args.generations; generation += 1) {
    const { nextPopulations, summary, replayBundles } = runGeneration(populations, generation, random, {
      scoreLimit: args.scoreLimit,
      maxTicks: args.maxTicks,
      inputSize
    });
    generationReports.push({ generation, summary });
    populations = nextPopulations;
    finalReplayBundles = replayBundles;
  }

  const promotionCandidates = Object.values(populations)
    .flat()
    .map((bot) => createPromotionCandidate(bot, reviewRatings.byBot.get(bot.id)))
    .sort((a, b) => b.promotionScore - a.promotionScore || b.elo - a.elo);

  const exportPool = promotionCandidates.filter((bot) => !bot.reviewBlocked);
  const selectedForExport = (exportPool.length ? exportPool : promotionCandidates).slice(0, 12);
  const rankedBots = assignDifficultyBands(selectedForExport).map((bot) => ({
    id: bot.id,
    name: bot.name,
    schemaVersion: 1,
    archetype: bot.archetype,
    personality: bot.personality,
    generation: bot.generation,
    lineageId: bot.lineageId,
    difficultyBand: bot.difficultyBand,
    elo: Math.round(bot.elo),
    promotionScore: Math.round(bot.promotionScore),
    controllerParams: bot.controllerParams,
    mutationProfile: bot.mutationProfile,
    network: bot.network,
    reviewBlocked: !!bot.reviewBlocked,
    reviewSummary: bot.reviewSummary
  }));

  writeBotsScript(args.exportFile, rankedBots);

  const report = {
    createdAt: new Date().toISOString(),
    runtimeVersion,
    seed: args.seed,
    generations: args.generations,
    populationPerArchetype: args.population,
    inputSize,
    ratingsFileUsed: args.ratingsFile,
    humanReviewSummary: reviewRatings.summary,
    generationReports,
    blockedBots: promotionCandidates
      .filter((bot) => bot.reviewBlocked)
      .map((bot) => ({
        id: bot.id,
        name: bot.name,
        archetype: bot.archetype,
        elo: Math.round(bot.elo),
        promotionScore: Math.round(bot.promotionScore),
        reviewSummary: bot.reviewSummary
      })),
    exportedBots: rankedBots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      archetype: bot.archetype,
      difficultyBand: bot.difficultyBand,
      elo: bot.elo,
      promotionScore: bot.promotionScore,
      reviewBlocked: bot.reviewBlocked,
      reviewSummary: bot.reviewSummary
    }))
  };

  const reportPath = path.join(args.reportsDir, 'latest-evolution-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  finalReplayBundles.slice(0, 8).forEach((bundle) => {
    const outputPath = path.join(args.reportsDir, 'replays', `${bundle.replayId}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(bundle, null, 2), 'utf8');
  });

  console.log(`Evolved ${rankedBots.length} bots and exported them to ${args.exportFile}`);
  console.log(`Report written to ${reportPath}`);
}

main();
