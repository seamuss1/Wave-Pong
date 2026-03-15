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
    forceAdd: false,
    promotionSeeds: 4,
    promotionScoreLimit: 5,
    promotionMaxTicks: 120 * 30,
    promotionMinPointMargin: 1,
    promotionMinWinRate: 0.6,
    promotionMinGoalDiff: 2
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source' && argv[i + 1]) args.source = path.resolve(argv[++i]);
    else if (arg === '--destination' && argv[i + 1]) args.destination = path.resolve(argv[++i]);
    else if (arg === '--report' && argv[i + 1]) args.report = path.resolve(argv[++i]);
    else if (arg === '--replace-id' && argv[i + 1]) args.replaceId = String(argv[++i]);
    else if (arg === '--force-add') args.forceAdd = true;
    else if (arg === '--promotion-seeds' && argv[i + 1]) args.promotionSeeds = Number(argv[++i]);
    else if (arg === '--promotion-score-limit' && argv[i + 1]) args.promotionScoreLimit = Number(argv[++i]);
    else if (arg === '--promotion-max-ticks' && argv[i + 1]) args.promotionMaxTicks = Number(argv[++i]);
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
  if (bot.humanTrainingSummary && bot.humanTrainingSummary.sessionCount > 0) tags.push('human-tested');
  if (bot.humanTrainingSummary && Number(bot.humanTrainingSummary.challengeScore) >= 12) tags.push('human-hardened');
  return tags;
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter((value) => typeof value === 'string' && value.trim()))); 
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
  const trainingHours = Number(bot.trainingHours) || 0;
  const existingMetadata = bot.metadata && typeof bot.metadata === 'object' ? clone(bot.metadata) : {};
  const samples = bot.runtimeValidation && Array.isArray(bot.runtimeValidation.samples)
    ? bot.runtimeValidation.samples
    : [123, 987654321].map((seed) => evaluateRuntimeActivity(bot, seed));
  const totalMovedTicks = samples.reduce((sum, sample) => sum + (sample.movedTicks || 0), 0);
  const totalGoals = samples.reduce((sum, sample) => sum + (sample.leftScore || 0) + (sample.rightScore || 0), 0);
  const runtimeDisabled = totalMovedTicks === 0 && totalGoals === 0;
  const humanTrainingSummary = bot.humanTrainingSummary || existingMetadata.humanTrainingSummary || null;
  const humanFineTuneSummary = bot.humanFineTuneSummary || existingMetadata.humanFineTuneSummary || null;
  const inferredStyleTags = inferStyleTags({
    ...bot,
    humanTrainingSummary,
    runtimeValidation: {
      totalMovedTicks,
      totalGoals,
      samples
    }
  });
  const metadata = {
    ...existingMetadata,
    rosterStatus: 'published',
    rosterVersion: 1,
    source: sourceLabel,
    publishedAt: new Date().toISOString(),
    lineageRoot: bot.lineageId || bot.id,
    sourceBotId: bot.sourceBotId || null,
    trainingHours: Number(trainingHours.toFixed(3)),
    styleTags: uniqueStrings([...(existingMetadata.styleTags || []), ...inferredStyleTags]),
    eloTier: eloTier(bot.elo),
    reviewState: existingMetadata.reviewState || (bot.reviewBlocked ? 'blocked' : 'active'),
    humanTrainingSummary: humanTrainingSummary ? clone(humanTrainingSummary) : null,
    humanFineTuneSummary: humanFineTuneSummary ? clone(humanFineTuneSummary) : null
  };

  return {
    ...clone(bot),
    trainingHours: Number(trainingHours.toFixed(3)),
    runtimeDisabled,
    humanTrainingSummary: humanTrainingSummary ? clone(humanTrainingSummary) : null,
    humanFineTuneSummary: humanFineTuneSummary ? clone(humanFineTuneSummary) : null,
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

function createPromotionProfiles(options) {
  const baseScoreLimit = Math.max(3, Math.floor(options.promotionScoreLimit || 5));
  const baseMaxTicks = Math.max(1200, Math.floor(options.promotionMaxTicks || (120 * 30)));
  return [
    {
      id: 'standard',
      scoreLimit: baseScoreLimit,
      maxTicks: baseMaxTicks
    },
    {
      id: 'sprint',
      scoreLimit: Math.max(3, baseScoreLimit - 2),
      maxTicks: Math.max(1200, Math.floor(baseMaxTicks * 0.75))
    },
    {
      id: 'endurance',
      scoreLimit: baseScoreLimit + 2,
      maxTicks: Math.max(baseMaxTicks + 1200, Math.floor(baseMaxTicks * 1.5))
    }
  ];
}

function evaluateHeadToHeadMatch(leftBot, rightBot, seed, options) {
  const runtime = simCore.createSimulation({ config, seed });
  runtime.setControllers({
    left: controllers.createNeuralController(leftBot),
    right: controllers.createNeuralController(rightBot)
  });
  runtime.startMatch({
    demo: true,
    skipCountdown: true,
    difficulty: 'spicy',
    scoreLimit: options.scoreLimit,
    powerupsEnabled: true,
    trailsEnabled: false,
    theme: 'neon'
  });

  let leftMovedTicks = 0;
  let rightMovedTicks = 0;
  let lastLeftY = runtime.world.paddles.left.y;
  let lastRightY = runtime.world.paddles.right.y;
  while (!runtime.state.gameOver && runtime.state.tick < options.maxTicks) {
    runtime.stepSimulation(1);
    const nextLeftY = runtime.world.paddles.left.y;
    const nextRightY = runtime.world.paddles.right.y;
    if (Math.abs(nextLeftY - lastLeftY) > 1e-6) leftMovedTicks += 1;
    if (Math.abs(nextRightY - lastRightY) > 1e-6) rightMovedTicks += 1;
    lastLeftY = nextLeftY;
    lastRightY = nextRightY;
  }

  return {
    leftScore: runtime.state.leftScore,
    rightScore: runtime.state.rightScore,
    leftWon: runtime.state.leftScore > runtime.state.rightScore,
    rightWon: runtime.state.rightScore > runtime.state.leftScore,
    leftMovedTicks,
    rightMovedTicks
  };
}

function createPromotionSeeds(seedCount) {
  const seeds = [];
  for (let i = 0; i < seedCount; i += 1) {
    seeds.push(1337 + (i * 7919));
  }
  return seeds;
}

function summarizePromotionSeries(candidate, existing, options) {
  const seedCount = Math.max(1, Math.floor(options.promotionSeeds || 1));
  const seeds = createPromotionSeeds(seedCount);
  const profiles = createPromotionProfiles(options);
  const summary = {
    candidateId: candidate.id,
    existingId: existing.id,
    seeds,
    profiles,
    matchesPlayed: 0,
    candidateMatchPoints: 0,
    existingMatchPoints: 0,
    candidateWins: 0,
    existingWins: 0,
    draws: 0,
    candidateGoals: 0,
    existingGoals: 0,
    candidateMovedTicks: 0,
    existingMovedTicks: 0,
    profileSummaries: [],
    gameResults: []
  };

  for (const profile of profiles) {
    const profileSummary = {
      id: profile.id,
      scoreLimit: profile.scoreLimit,
      maxTicks: profile.maxTicks,
      matchesPlayed: 0,
      candidateMatchPoints: 0,
      existingMatchPoints: 0,
      candidateWins: 0,
      existingWins: 0,
      draws: 0,
      goalDiff: 0
    };

    for (const seed of seeds) {
      const leftGame = evaluateHeadToHeadMatch(candidate, existing, seed, profile);
      summary.matchesPlayed += 1;
      profileSummary.matchesPlayed += 1;
      summary.candidateGoals += leftGame.leftScore;
      summary.existingGoals += leftGame.rightScore;
      summary.candidateMovedTicks += leftGame.leftMovedTicks || 0;
      summary.existingMovedTicks += leftGame.rightMovedTicks || 0;
      profileSummary.goalDiff += leftGame.leftScore - leftGame.rightScore;
      if (leftGame.leftWon) {
        summary.candidateWins += 1;
        summary.candidateMatchPoints += 1;
        profileSummary.candidateWins += 1;
        profileSummary.candidateMatchPoints += 1;
      } else if (leftGame.rightWon) {
        summary.existingWins += 1;
        summary.existingMatchPoints += 1;
        profileSummary.existingWins += 1;
        profileSummary.existingMatchPoints += 1;
      } else {
        summary.draws += 1;
        summary.candidateMatchPoints += 0.5;
        summary.existingMatchPoints += 0.5;
        profileSummary.draws += 1;
        profileSummary.candidateMatchPoints += 0.5;
        profileSummary.existingMatchPoints += 0.5;
      }
      summary.gameResults.push({
        profile: profile.id,
        seed,
        candidateSide: 'left',
        candidateScore: leftGame.leftScore,
        existingScore: leftGame.rightScore
      });

      const rightGame = evaluateHeadToHeadMatch(existing, candidate, seed, profile);
      summary.matchesPlayed += 1;
      profileSummary.matchesPlayed += 1;
      summary.candidateGoals += rightGame.rightScore;
      summary.existingGoals += rightGame.leftScore;
      summary.candidateMovedTicks += rightGame.rightMovedTicks || 0;
      summary.existingMovedTicks += rightGame.leftMovedTicks || 0;
      profileSummary.goalDiff += rightGame.rightScore - rightGame.leftScore;
      if (rightGame.rightWon) {
        summary.candidateWins += 1;
        summary.candidateMatchPoints += 1;
        profileSummary.candidateWins += 1;
        profileSummary.candidateMatchPoints += 1;
      } else if (rightGame.leftWon) {
        summary.existingWins += 1;
        summary.existingMatchPoints += 1;
        profileSummary.existingWins += 1;
        profileSummary.existingMatchPoints += 1;
      } else {
        summary.draws += 1;
        summary.candidateMatchPoints += 0.5;
        summary.existingMatchPoints += 0.5;
        profileSummary.draws += 1;
        profileSummary.candidateMatchPoints += 0.5;
        profileSummary.existingMatchPoints += 0.5;
      }
      summary.gameResults.push({
        profile: profile.id,
        seed,
        candidateSide: 'right',
        candidateScore: rightGame.rightScore,
        existingScore: rightGame.leftScore
      });
    }

    summary.profileSummaries.push(profileSummary);
  }

  summary.goalDiff = summary.candidateGoals - summary.existingGoals;
  summary.pointMargin = summary.candidateMatchPoints - summary.existingMatchPoints;
  summary.candidateWinRate = summary.matchesPlayed > 0 ? summary.candidateWins / summary.matchesPlayed : 0;
  summary.existingWinRate = summary.matchesPlayed > 0 ? summary.existingWins / summary.matchesPlayed : 0;
  summary.candidateActive = summary.candidateMovedTicks > 0;
  summary.existingActive = summary.existingMovedTicks > 0;
  summary.failedChecks = [];

  if (summary.pointMargin < Number(options.promotionMinPointMargin || 1)) {
    summary.failedChecks.push('point_margin');
  }
  if (summary.candidateWinRate < Number(options.promotionMinWinRate || 0.6)) {
    summary.failedChecks.push('win_rate');
  }
  if (summary.goalDiff < Number(options.promotionMinGoalDiff || 2)) {
    summary.failedChecks.push('goal_diff');
  }
  for (const profileSummary of summary.profileSummaries) {
    if (profileSummary.candidateMatchPoints < profileSummary.existingMatchPoints) {
      summary.failedChecks.push(`profile_${profileSummary.id}`);
    }
  }
  if (!summary.candidateActive && summary.existingActive) {
    summary.failedChecks.push('candidate_inactive');
  }

  summary.candidateBeatsRoster = summary.failedChecks.length === 0;
  return summary;
}

function formatPromotionProfileSummary(profileSummary) {
  return `${profileSummary.id}:${profileSummary.candidateMatchPoints}-${profileSummary.existingMatchPoints} goalDiff=${profileSummary.goalDiff}`;
}

function formatPromotionChecks(summary) {
  return summary.failedChecks.length ? summary.failedChecks.join(', ') : 'passed';
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
      const promotionSeries = summarizePromotionSeries(candidate, existing, args);
      console.log(
        `Promotion match ${candidate.id} (challenger Elo ${candidate.elo}) vs ${existing.id} (incumbent Elo ${existing.elo})` +
        ` | points ${promotionSeries.candidateMatchPoints}-${promotionSeries.existingMatchPoints}` +
        ` | goals ${promotionSeries.candidateGoals}-${promotionSeries.existingGoals}` +
        ` | wins ${promotionSeries.candidateWins}-${promotionSeries.existingWins}` +
        ` | profiles ${promotionSeries.profileSummaries.map(formatPromotionProfileSummary).join(' | ')}` +
        ` | checks ${formatPromotionChecks(promotionSeries)}`
      );
      candidate.metadata.replacesBotId = existing.id;
      candidate.metadata.promotionSeries = {
        seeds: promotionSeries.seeds,
        profiles: promotionSeries.profiles,
        matchesPlayed: promotionSeries.matchesPlayed,
        candidateMatchPoints: promotionSeries.candidateMatchPoints,
        existingMatchPoints: promotionSeries.existingMatchPoints,
        candidateWins: promotionSeries.candidateWins,
        existingWins: promotionSeries.existingWins,
        draws: promotionSeries.draws,
        goalDiff: promotionSeries.goalDiff,
        pointMargin: promotionSeries.pointMargin,
        candidateWinRate: promotionSeries.candidateWinRate,
        existingWinRate: promotionSeries.existingWinRate,
        failedChecks: promotionSeries.failedChecks,
        profileSummaries: promotionSeries.profileSummaries
      };
      if (!promotionSeries.candidateBeatsRoster) {
        skippedBots.push({
          candidateId: candidate.id,
          reason: 'failed_promotion_gate',
          existingBotId: existing.id,
          promotionSeries
        });
        continue;
      }
      nextRoster[replaceIndex] = candidate;
      replacedBots.push({
        candidateId: candidate.id,
        replacedBotId: existing.id,
        candidateElo: candidate.elo,
        promotionSeries
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
      trainingHours: bot.trainingHours,
      lineageId: bot.lineageId,
      metadata: bot.metadata
    }))
  }, null, 2), 'utf8');

  console.log(`Roster write complete: ${nextRoster.length} published bot(s) in ${args.destination}`);
  if (addedBots.length) console.log(`Added ${addedBots.length} bot(s).`);
  if (replacedBots.length) {
    const promotedSummary = replacedBots
      .map((entry) => `${entry.candidateId} (Elo ${entry.candidateElo})`)
      .join(', ');
    console.log(`Promoted ${replacedBots.length} bot(s)!!! ${promotedSummary}`);
  }
  if (skippedBots.length) console.log(`Skipped ${skippedBots.length} redundant bot(s). See ${args.report}.`);
}

main();
