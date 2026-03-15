#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const config = require(path.join(repoRoot, 'runtime/js/config.js'));
const simCore = require(path.join(repoRoot, 'runtime/js/sim-core.js'));
const controllers = require(path.join(repoRoot, 'runtime/js/controllers.js'));
const runtimeVersion = require(path.join(repoRoot, 'runtime/js/version.js'));

function mergeWeights(...groups) {
  return Object.assign({}, ...groups);
}

// Training profiles can safely compose from these normalized metrics without clashing
// with future archetypes. Add new profile weights by reusing the documented keys here
// instead of inventing per-role one-off behavior checks.
const TRAINING_METRIC_GUIDE = Object.freeze({
  activeMatch: '1 when the bot moved or fired at least once during the match.',
  inactiveMatch: '1 when the bot stayed inert for the entire match.',
  movedTickRate: 'Fraction of match ticks where the paddle changed vertical position.',
  movementRate: 'Total vertical travel distance divided by match duration.',
  shotRate: 'Shots fired per 1000 ticks.',
  waveHitRate: 'Wave hits per shot.',
  ballHitRate: 'Ball contacts per shot.',
  paceScore: 'Combined match goals per 1000 ticks.',
  blueShotShare: 'Blue shots divided by all shots.',
  pinkShotShare: 'Pink shots divided by all shots.',
  goldShotShare: 'Gold shots divided by all shots.',
  nonBlueShotShare: 'Non-blue shots divided by all shots.',
  nonPinkShotShare: 'Non-pink shots divided by all shots.',
  nonGoldShotShare: 'Non-gold shots divided by all shots.'
});

const COMMON_PROFILE_WEIGHTS = Object.freeze({
  activeMatch: 10,
  inactiveMatch: -28,
  movedTickRate: 16,
  waveHitRate: 8,
  paceScore: 12
});

const ARCHETYPES = [
  {
    id: 'defensive',
    label: 'Anchor',
    personality: 'Covers the lane early and values survival over flair.',
    fitness: mergeWeights(COMMON_PROFILE_WEIGHTS, {
      win: 100,
      goalDiff: 18,
      shots: 0.25,
      shotRate: 0.2,
      powerups: 0.9,
      againstGoals: -20,
      longestRally: 0.2
    })
  },
  {
    id: 'aggressive',
    label: 'Volt',
    personality: 'Pushes pressure, spends charge, and looks for quick finishes.',
    fitness: mergeWeights(COMMON_PROFILE_WEIGHTS, {
      win: 100,
      goalDiff: 24,
      shots: 1.0,
      shotRate: 0.55,
      paceScore: 18,
      powerups: 0.4,
      againstGoals: -16
    })
  },
  {
    id: 'control',
    label: 'Weaver',
    personality: 'Leans into pickups, long exchanges, and court control.',
    fitness: mergeWeights(COMMON_PROFILE_WEIGHTS, {
      win: 100,
      goalDiff: 16,
      shots: 0.55,
      shotRate: 0.3,
      powerups: 1.4,
      againstGoals: -18,
      longestRally: 0.25
    })
  },
  {
    id: 'trickster',
    label: 'Glitch',
    personality: 'Varies tempo and angle pressure without giving up match discipline.',
    fitness: mergeWeights(COMMON_PROFILE_WEIGHTS, {
      win: 100,
      goalDiff: 19,
      shots: 0.9,
      shotRate: 0.4,
      paceScore: 14,
      powerups: 0.7,
      againstGoals: -18
    })
  }
];

const ROLE_TRAINING_PROFILES = {
  strategist: {
    id: 'strategist',
    label: 'Strategist',
    personality: 'Uses blue wave timing to shape rallies, control ball routes, and keep the court predictable.',
    fitness: mergeWeights(COMMON_PROFILE_WEIGHTS, {
      win: 100,
      goalDiff: 18,
      againstGoals: -18,
      longestRally: 0.2,
      shotRate: 0.35,
      blueShots: 0.3,
      blueShotShare: 24,
      blueBallHits: 1.4,
      blueTowardHits: 2.6,
      blueAwayHits: 1.0,
      blueResistGrants: 2.2,
      blueWavePowerups: 1.5,
      nonBlueShots: -0.12,
      nonBlueShotShare: -8,
      goldShots: -0.5
    }),
    promotion: {
      desiredWaveKey: 'blue',
      minShotsPerMatch: 8,
      minDesiredShotShare: 0.55,
      minMovedTickRate: 0.08
    }
  },
  defensive_specialist: {
    id: 'defensive_specialist',
    label: 'Defensive Specialist',
    personality: 'Prioritizes pink wave survival windows, stabilizes losing rallies, and buys time to recover position.',
    fitness: mergeWeights(COMMON_PROFILE_WEIGHTS, {
      win: 100,
      goalDiff: 16,
      againstGoals: -24,
      longestRally: 0.25,
      shotRate: 0.25,
      pinkShots: 0.45,
      pinkShotShare: 22,
      pinkBallHits: 1.6,
      pinkThreatHits: 3.2,
      pinkEmergencyHits: 4.2,
      pinkWavePowerups: 1.8,
      nonPinkShots: -0.12,
      nonPinkShotShare: -7,
      goldShots: -0.4
    }),
    promotion: {
      desiredWaveKey: 'pink',
      minShotsPerMatch: 4,
      minDesiredShotShare: 0.4,
      minMovedTickRate: 0.08,
      minWaveHitsPerMatch: 1
    }
  },
  sniper: {
    id: 'sniper',
    label: 'Sniper',
    personality: 'Uses gold waves to line up pickups, create punish windows, and convert brief openings into scoring pressure.',
    fitness: mergeWeights(COMMON_PROFILE_WEIGHTS, {
      win: 100,
      goalDiff: 24,
      againstGoals: -16,
      paceScore: 20,
      shotRate: 0.8,
      goldShots: 1.4,
      goldShotShare: 32,
      goldBallHits: 1.8,
      goldCenterHits: 3.0,
      goldPaddleHits: 4.6,
      goldWavePowerups: 4.0,
      nonGoldShots: -0.1,
      nonGoldShotShare: -10
    }),
    promotion: {
      desiredWaveKey: 'gold',
      minShotsPerMatch: 3,
      minDesiredShotShare: 0.35,
      minDesiredShotsPerMatch: 1.5,
      minMovedTickRate: 0.05
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
    logFile: null,
    rosterFile: path.join(repoRoot, 'runtime', 'js', 'bot-roster.js'),
    rosterMode: 'none',
    focusBotId: null,
    selfPlay: false,
    updateAllRoster: false,
    publishRuntime: false,
    autoPromoteEvery: 0,
    checkpointEvery: 1,
    progressEveryMatches: 0
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
    else if (arg === '--log-file' && argv[i + 1]) args.logFile = path.resolve(argv[++i]);
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
  if (!Number.isFinite(args.autoPromoteEvery) || args.autoPromoteEvery < 0) {
    throw new Error(`Invalid --auto-promote-every value: ${args.autoPromoteEvery}`);
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

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hours = padNumber(date.getHours());
  const minutes = padNumber(date.getMinutes());
  const seconds = padNumber(date.getSeconds());
  const timezoneOffsetMinutes = -date.getTimezoneOffset();
  const sign = timezoneOffsetMinutes >= 0 ? '+' : '-';
  const absoluteOffsetMinutes = Math.abs(timezoneOffsetMinutes);
  const offsetHours = padNumber(Math.floor(absoluteOffsetMinutes / 60));
  const offsetMinutes = padNumber(absoluteOffsetMinutes % 60);
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${sign}${offsetHours}:${offsetMinutes}`;
}

function createTimestampSlug(date = new Date()) {
  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join('') + '-' + [
    padNumber(date.getHours()),
    padNumber(date.getMinutes()),
    padNumber(date.getSeconds())
  ].join('');
}

function createRunLogger(filePath) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, '', 'utf8');

  function write(level, message, alsoConsole = true) {
    const lines = String(message == null ? '' : message).split(/\r?\n/);
    const stream = level === 'error' ? process.stderr : process.stdout;
    for (const line of lines) {
      if (!line) continue;
      const formatted = `[${formatTimestamp()}] ${level.toUpperCase()} ${line}`;
      fs.appendFileSync(filePath, `${formatted}\n`, 'utf8');
      if (alsoConsole) stream.write(`${formatted}\n`);
    }
  }

  return {
    filePath,
    info(message) {
      write('info', message, true);
    },
    warn(message) {
      write('warn', message, true);
    },
    error(message) {
      write('error', message, true);
    },
    fileOnly(message) {
      write('info', message, false);
    }
  };
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

function formatDecimal(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function resolveProgressEveryMatches(configuredValue, totalMatches) {
  const numeric = Math.floor(Number(configuredValue) || 0);
  if (numeric > 0) return numeric;
  return Math.max(1, Math.floor(totalMatches / 4));
}

function describeProgressEveryMatches(configuredValue, totalMatches) {
  const resolved = resolveProgressEveryMatches(configuredValue, totalMatches);
  return Number(configuredValue) > 0 ? String(resolved) : `auto/${resolved}`;
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

function assessPromotionReadiness(bot, profile) {
  const promotion = profile && profile.promotion ? profile.promotion : null;
  const averages = bot && bot.metricAverages ? bot.metricAverages : {};
  if (!promotion) {
    return {
      blocked: false,
      reasons: [],
      desiredWaveKey: null
    };
  }

  const reasons = [];
  if (promotion.minShotsPerMatch != null && (Number(averages.shots) || 0) < promotion.minShotsPerMatch) {
    reasons.push(`shots<${promotion.minShotsPerMatch}`);
  }
  if (promotion.minMovedTickRate != null && (Number(averages.movedTickRate) || 0) < promotion.minMovedTickRate) {
    reasons.push(`movedTickRate<${promotion.minMovedTickRate}`);
  }
  if (promotion.minWaveHitsPerMatch != null && (Number(averages.waveHits) || 0) < promotion.minWaveHitsPerMatch) {
    reasons.push(`waveHits<${promotion.minWaveHitsPerMatch}`);
  }
  if (promotion.desiredWaveKey) {
    const desiredKey = String(promotion.desiredWaveKey);
    const shareKey = `${desiredKey}ShotShare`;
    const shotsKey = `${desiredKey}Shots`;
    if (promotion.minDesiredShotShare != null && (Number(averages[shareKey]) || 0) < promotion.minDesiredShotShare) {
      reasons.push(`${shareKey}<${promotion.minDesiredShotShare}`);
    }
    if (promotion.minDesiredShotsPerMatch != null && (Number(averages[shotsKey]) || 0) < promotion.minDesiredShotsPerMatch) {
      reasons.push(`${shotsKey}<${promotion.minDesiredShotsPerMatch}`);
    }
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    desiredWaveKey: promotion.desiredWaveKey || null
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
  const profile = getTrainingProfile(bot);
  const readiness = assessPromotionReadiness(bot, profile);
  const blockedByReview = !!(reviewSummary && reviewSummary.rejectCount > 0);
  const roleFitScore = Number.isFinite(Number(bot.roleFitScore))
    ? Number(bot.roleFitScore)
    : (Number(bot.fitnessScore) || 0) / Math.max(1, Number(bot.matches) || 0);
  const roleFitBonus = clamp(roleFitScore / 12, -150, 150);
  const promotionScore =
    (Number(bot.elo) || 0) +
    roleFitBonus +
    (reviewSummary ? reviewSummary.reviewScoreAverage : 0) -
    (blockedByReview ? 2000 : 0) -
    (readiness.blocked ? 750 : 0);
  return {
    ...bot,
    reviewSummary: reviewSummary || null,
    reviewBlocked: blockedByReview,
    profileBlocked: readiness.blocked,
    promotionBlockReasons: readiness.reasons,
    desiredWaveKey: readiness.desiredWaveKey,
    roleFitScore,
    roleFitBonus: Number(roleFitBonus.toFixed(2)),
    promotionScore
  };
}

function comparePromotionCandidates(left, right) {
  if (!right) return 1;
  if (!left) return -1;
  const leftBlocked = !!(left.reviewBlocked || left.profileBlocked);
  const rightBlocked = !!(right.reviewBlocked || right.profileBlocked);
  if (leftBlocked !== rightBlocked) return leftBlocked ? -1 : 1;
  const promotionDelta = (Number(left.promotionScore) || -Infinity) - (Number(right.promotionScore) || -Infinity);
  if (promotionDelta !== 0) return promotionDelta;
  const eloDelta = (Number(left.elo) || -Infinity) - (Number(right.elo) || -Infinity);
  if (eloDelta !== 0) return eloDelta;
  const trainingHoursDelta = (Number(left.trainingHours) || 0) - (Number(right.trainingHours) || 0);
  if (trainingHoursDelta !== 0) return trainingHoursDelta;
  return (Number(left.generation) || 0) - (Number(right.generation) || 0);
}

function summarizeHumanReviewSignal(summary) {
  if (!summary || !summary.reviewCount) return 'humanReviews=none';
  return `humanReviews=${summary.reviewCount} (${summary.acceptCount} accept/${summary.watchCount} watch/${summary.rejectCount} reject)`;
}

function formatBotRoleName(bot) {
  return bot && bot.metadata && bot.metadata.roleName
    ? String(bot.metadata.roleName)
    : String((bot && bot.archetype) || 'unknown');
}

function formatBotTag(bot) {
  if (!bot || !bot.id) return 'unknown';
  const suffix = String(bot.id).split('-').slice(-1)[0];
  return `${bot.archetype || 'bot'}:${suffix}`;
}

function describePromotionGaps(bot) {
  const profile = getTrainingProfile(bot);
  const promotion = profile && profile.promotion ? profile.promotion : null;
  const averages = bot && bot.metricAverages ? bot.metricAverages : {};
  if (!promotion) return [];

  const gaps = [];
  if (promotion.minShotsPerMatch != null && (Number(averages.shots) || 0) < promotion.minShotsPerMatch) {
    gaps.push(`shots ${formatDecimal(averages.shots, 1)}/${promotion.minShotsPerMatch}`);
  }
  if (promotion.minMovedTickRate != null && (Number(averages.movedTickRate) || 0) < promotion.minMovedTickRate) {
    gaps.push(`move ${formatDecimal(averages.movedTickRate, 2)}/${promotion.minMovedTickRate}`);
  }
  if (promotion.minWaveHitsPerMatch != null && (Number(averages.waveHits) || 0) < promotion.minWaveHitsPerMatch) {
    gaps.push(`waveHits ${formatDecimal(averages.waveHits, 1)}/${promotion.minWaveHitsPerMatch}`);
  }
  if (promotion.desiredWaveKey) {
    const desiredWaveKey = String(promotion.desiredWaveKey);
    const shareKey = `${desiredWaveKey}ShotShare`;
    const shotsKey = `${desiredWaveKey}Shots`;
    if (promotion.minDesiredShotShare != null && (Number(averages[shareKey]) || 0) < promotion.minDesiredShotShare) {
      gaps.push(`${desiredWaveKey}Share ${formatDecimal(averages[shareKey], 2)}/${promotion.minDesiredShotShare}`);
    }
    if (promotion.minDesiredShotsPerMatch != null && (Number(averages[shotsKey]) || 0) < promotion.minDesiredShotsPerMatch) {
      gaps.push(`${desiredWaveKey}Shots ${formatDecimal(averages[shotsKey], 1)}/${promotion.minDesiredShotsPerMatch}`);
    }
  }
  return gaps;
}

function summarizeSeedTuningLine(seedBot, candidate) {
  const bot = candidate || seedBot;
  const metrics = bot && bot.metricAverages ? bot.metricAverages : {};
  const desiredWaveKey = candidate && candidate.desiredWaveKey ? candidate.desiredWaveKey : null;
  const summary = [
    `${seedBot.id}`,
    `role=${formatBotRoleName(bot)}`,
    `elo=${Math.round(Number(bot && bot.elo) || 0)}`,
    `fit=${formatDecimal(bot && bot.roleFitScore, 1)}`,
    `shots=${formatDecimal(metrics.shots, 1)}`,
    `move=${formatDecimal(metrics.movedTickRate, 2)}`
  ];
  if (desiredWaveKey) summary.push(`${desiredWaveKey}=${formatDecimal(metrics[`${desiredWaveKey}ShotShare`], 2)}`);
  if (candidate && (candidate.reviewBlocked || candidate.profileBlocked)) {
    summary.push(`missing ${describePromotionGaps(candidate).join(', ') || (candidate.promotionBlockReasons || []).join(', ') || 'review gate'}`);
  } else {
    summary.push('ready');
  }
  return summary.join(' ');
}

function summarizeTrackedSeedDiagnostics(bestBySeedId, rosterSeedBots, limit = 4) {
  const bots = Array.isArray(rosterSeedBots) ? rosterSeedBots : [];
  const lines = bots
    .slice(0, limit)
    .map((seedBot) => summarizeSeedTuningLine(seedBot, bestBySeedId.get(seedBot.id) || null));
  if (bots.length > limit) lines.push(`+${bots.length - limit} more tracked seed(s) in checkpoint/report`);
  return lines;
}

function summarizeGenerationLeaders(summary) {
  return summary
    .map((entry) => `${entry.archetype}=${Math.round(entry.topElo)} fit=${formatDecimal(entry.topFitness, 1)} ${formatBotTag({ id: entry.topBotId, archetype: entry.archetype })}`)
    .join(' | ');
}

function summarizePromotionCandidates(populations, reviewRatings, limit = 12) {
  return Object.values(populations)
    .flat()
    .map((bot) => createPromotionCandidate(bot, reviewRatings.byBot.get(bot.id)))
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
      profileBlocked: !!bot.profileBlocked,
      roleFitScore: Number((Number(bot.roleFitScore) || 0).toFixed(2)),
      promotionBlockReasons: bot.promotionBlockReasons || [],
      reviewSummary: bot.reviewSummary
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
    trainingHours: Number(parent && parent.trainingHours) || 0,
    elo: 1000,
    fitnessScore: 0,
    matches: 0,
    metricTotals: createMetricTotals(),
    metricSamples: 0,
    metricAverages: null,
    roleFitScore: 0,
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
    trainingHours: Number(bot.trainingHours) || Number(bot.metadata && bot.metadata.trainingHours) || 0,
    difficultyBand: bot.difficultyBand || null,
    elo: Number(bot.elo) || 1000,
    fitnessScore: 0,
    matches: 0,
    metricTotals: createMetricTotals(),
    metricSamples: 0,
    metricAverages: clone(bot.metricAverages || null),
    roleFitScore: Number(bot.roleFitScore) || 0,
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
    let seededParentCursor = 0;
    populations[archetype.id] = seeded.map((bot) => ({
      ...clone(bot),
      fitnessScore: 0,
      matches: 0,
      metricTotals: createMetricTotals(),
      metricSamples: 0,
      metricAverages: clone(bot.metricAverages || null),
      roleFitScore: Number(bot.roleFitScore) || 0
    }));
    const targetSize = Math.max(populationSize, populations[archetype.id].length);
    while (populations[archetype.id].length < targetSize) {
      if (focusedSeed && archetype.id === focusedSeed.archetype) {
        populations[archetype.id].push(createGenome(archetype, 0, inputSize, random, focusedSeed));
        continue;
      }
      if (seeded.length) {
        const parent = seeded[seededParentCursor % seeded.length];
        seededParentCursor += 1;
        populations[archetype.id].push(createGenome(archetype, 0, inputSize, random, parent));
        continue;
      }
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

function createMetricTotals() {
  return Object.create(null);
}

function accumulateMetricTotals(totals, metrics) {
  for (const [key, value] of Object.entries(metrics || {})) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) continue;
    totals[key] = (Number(totals[key]) || 0) + numeric;
  }
  return totals;
}

function averageMetricTotals(totals, count) {
  const averages = {};
  for (const [key, value] of Object.entries(totals || {})) {
    averages[key] = count > 0 ? value / count : 0;
  }
  return averages;
}

function accumulateBotMetrics(bot, metrics) {
  bot.metricTotals = accumulateMetricTotals(bot.metricTotals || createMetricTotals(), metrics);
  bot.metricSamples = (Number(bot.metricSamples) || 0) + 1;
}

function finalizeBotMetrics(bot) {
  bot.roleFitScore = bot.fitnessScore / Math.max(1, bot.matches);
  bot.metricAverages = averageMetricTotals(bot.metricTotals || createMetricTotals(), Number(bot.metricSamples) || 0);
}

function buildSideMetrics({
  result,
  ownScore,
  opponentScore,
  matchStats,
  roleMetrics,
  shots,
  powerups,
  ballHits,
  waveHits,
  movement,
  durationTicks
}) {
  const safeDuration = Math.max(1, durationTicks);
  const safeShots = Math.max(1, shots);
  const totalGoals = ownScore + opponentScore;
  const blueShots = roleMetrics.blueShots || 0;
  const pinkShots = roleMetrics.pinkShots || 0;
  const goldShots = roleMetrics.goldShots || 0;
  const inactiveMatch = shots <= 0 && (movement.movedTicks || 0) <= 0 ? 1 : 0;

  return {
    win: result,
    goals: ownScore,
    goalDiff: ownScore - opponentScore,
    againstGoals: opponentScore,
    rally: matchStats.longestRally || 0,
    longestRally: matchStats.longestRally || 0,
    durationTicks: safeDuration,
    paceScore: (totalGoals / safeDuration) * 1000,
    shots,
    shotRate: (shots / safeDuration) * 1000,
    powerups,
    powerupRate: (powerups / safeDuration) * 1000,
    ballHits,
    waveHits,
    waveHitRate: shots > 0 ? waveHits / safeShots : 0,
    ballHitRate: shots > 0 ? ballHits / safeShots : 0,
    activeMatch: inactiveMatch ? 0 : 1,
    inactiveMatch,
    movedTicks: movement.movedTicks || 0,
    movedTickRate: (movement.movedTicks || 0) / safeDuration,
    paddleTravel: movement.travelDistance || 0,
    movementRate: (movement.travelDistance || 0) / safeDuration,
    blueShots,
    pinkShots,
    goldShots,
    blueShotShare: shots > 0 ? blueShots / safeShots : 0,
    pinkShotShare: shots > 0 ? pinkShots / safeShots : 0,
    goldShotShare: shots > 0 ? goldShots / safeShots : 0,
    nonBlueShots: pinkShots + goldShots,
    nonPinkShots: blueShots + goldShots,
    nonGoldShots: blueShots + pinkShots,
    nonBlueShotShare: shots > 0 ? (pinkShots + goldShots) / safeShots : 0,
    nonPinkShotShare: shots > 0 ? (blueShots + goldShots) / safeShots : 0,
    nonGoldShotShare: shots > 0 ? (blueShots + pinkShots) / safeShots : 0,
    blueBallHits: roleMetrics.blueBallHits || 0,
    pinkBallHits: roleMetrics.pinkBallHits || 0,
    goldBallHits: roleMetrics.goldBallHits || 0,
    blueTowardHits: roleMetrics.blueTowardHits || 0,
    blueAwayHits: roleMetrics.blueAwayHits || 0,
    blueResistGrants: roleMetrics.blueResistGrants || 0,
    pinkThreatHits: roleMetrics.pinkThreatHits || 0,
    pinkEmergencyHits: roleMetrics.pinkEmergencyHits || 0,
    blueWavePowerups: roleMetrics.blueWavePowerups || 0,
    pinkWavePowerups: roleMetrics.pinkWavePowerups || 0,
    goldWavePowerups: roleMetrics.goldWavePowerups || 0,
    goldPaddleHits: roleMetrics.goldPaddleHits || 0,
    goldCenterHits: roleMetrics.goldCenterHits || 0
  };
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
  let leftLastY = runtime.world.paddles.left.y;
  let rightLastY = runtime.world.paddles.right.y;
  const leftMovement = { movedTicks: 0, travelDistance: 0 };
  const rightMovement = { movedTicks: 0, travelDistance: 0 };
  while (!runtime.state.gameOver && runtime.state.tick < settings.maxTicks) {
    runtime.stepSimulation(1);
    for (const ball of runtime.world.balls) {
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed > maxBallSpeed) maxBallSpeed = speed;
    }
    const leftY = runtime.world.paddles.left.y;
    const rightY = runtime.world.paddles.right.y;
    const leftDelta = Math.abs(leftY - leftLastY);
    const rightDelta = Math.abs(rightY - rightLastY);
    if (leftDelta > 1e-6) leftMovement.movedTicks += 1;
    if (rightDelta > 1e-6) rightMovement.movedTicks += 1;
    leftMovement.travelDistance += leftDelta;
    rightMovement.travelDistance += rightDelta;
    leftLastY = leftY;
    rightLastY = rightY;
  }

  const leftWon = runtime.state.leftScore > runtime.state.rightScore;
  const rightWon = runtime.state.rightScore > runtime.state.leftScore;
  const leftRoleMetrics = runtime.matchStats.leftRoleMetrics || {};
  const rightRoleMetrics = runtime.matchStats.rightRoleMetrics || {};
  const durationTicks = Math.max(1, runtime.state.tick);
  const leftShots = runtime.matchStats.leftShots || 0;
  const rightShots = runtime.matchStats.rightShots || 0;
  const leftPowerups = runtime.matchStats.leftPowerups || 0;
  const rightPowerups = runtime.matchStats.rightPowerups || 0;
  const leftBallHits = runtime.matchStats.leftBallHits || 0;
  const rightBallHits = runtime.matchStats.rightBallHits || 0;
  const leftWaveHits = runtime.matchStats.leftWaveHits || 0;
  const rightWaveHits = runtime.matchStats.rightWaveHits || 0;
  const result = {
    left: leftWon ? 1 : rightWon ? 0 : 0.5,
    right: rightWon ? 1 : leftWon ? 0 : 0.5
  };

  const leftMetrics = buildSideMetrics({
    result: result.left,
    ownScore: runtime.state.leftScore,
    opponentScore: runtime.state.rightScore,
    matchStats: runtime.matchStats,
    roleMetrics: leftRoleMetrics,
    shots: leftShots,
    powerups: leftPowerups,
    ballHits: leftBallHits,
    waveHits: leftWaveHits,
    movement: leftMovement,
    durationTicks
  });

  const rightMetrics = buildSideMetrics({
    result: result.right,
    ownScore: runtime.state.rightScore,
    opponentScore: runtime.state.leftScore,
    matchStats: runtime.matchStats,
    roleMetrics: rightRoleMetrics,
    shots: rightShots,
    powerups: rightPowerups,
    ballHits: rightBallHits,
    waveHits: rightWaveHits,
    movement: rightMovement,
    durationTicks
  });

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
  const progressEveryMatches = resolveProgressEveryMatches(settings.progressEveryMatches, totalMatches);
  let processedMatches = 0;

  for (const bot of mutableBots) {
    bot.fitnessScore = 0;
    bot.matches = 0;
    bot.metricTotals = createMetricTotals();
    bot.metricSamples = 0;
    bot.metricAverages = null;
    bot.roleFitScore = 0;
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
        accumulateBotMetrics(leftBot, match.leftMetrics);
      }
      if (!rightIsStatic) {
        rightBot.fitnessScore += scoreMetrics(rightProfile.fitness, match.rightMetrics);
        rightBot.matches += 1;
        accumulateBotMetrics(rightBot, match.rightMetrics);
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
  for (const bot of mutableBots) {
    finalizeBotMetrics(bot);
  }
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
    selectedCandidateId: bestCandidate.id,
    selectedCandidateGeneration: bestCandidate.generation,
    selectedCandidateTrainingHours: bestCandidate.trainingHours,
    selectedCandidatePromotionScore: bestCandidate.promotionScore,
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
      selectedCandidateId: bestCandidate.id,
      selectedCandidateGeneration: bestCandidate.generation,
      selectedCandidateTrainingHours: bestCandidate.trainingHours,
      selectedCandidatePromotionScore: bestCandidate.promotionScore,
      id: seedBot.id,
      name: seedBot.name,
      personality: seedBot.personality,
      sourceBotId: seedBot.id,
      difficultyBand: seedBot.difficultyBand || bestCandidate.difficultyBand || null,
      metadata: seedBot.metadata ? clone(seedBot.metadata) : null
    };
  }).sort((a, b) => (Number(b.elo) || 0) - (Number(a.elo) || 0));
}

function updateBestRosterSeedCandidates(bestBySeedId, populations, reviewRatings, rosterSeedBots) {
  const trackedSeedIds = new Set((rosterSeedBots || []).map((bot) => bot.id));
  if (!trackedSeedIds.size) return;
  Object.values(populations)
    .flat()
    .forEach((bot) => {
      const trackedSeedId = bot.sourceBotId || (trackedSeedIds.has(bot.id) ? bot.id : null);
      if (!trackedSeedId || !trackedSeedIds.has(trackedSeedId)) return;
      const candidate = createPromotionCandidate(bot, reviewRatings.byBot.get(bot.id));
      const current = bestBySeedId.get(trackedSeedId) || null;
      if (comparePromotionCandidates(candidate, current) > 0) {
        bestBySeedId.set(trackedSeedId, clone(candidate));
      }
    });
}

function summarizeBestRosterSeedCandidates(bestBySeedId, rosterSeedBots) {
  return (rosterSeedBots || []).map((seedBot) => {
    const candidate = bestBySeedId.get(seedBot.id) || null;
    return {
      seedBotId: seedBot.id,
      seedBotName: seedBot.name,
      selectedCandidateId: candidate ? candidate.id : seedBot.id,
      selectedCandidateGeneration: candidate ? candidate.generation : seedBot.generation,
      selectedCandidateElo: Math.round(candidate ? candidate.elo : seedBot.elo),
      selectedCandidatePromotionScore: Math.round(candidate ? candidate.promotionScore : seedBot.elo),
      selectedCandidateTrainingHours: Number((Number(candidate ? candidate.trainingHours : seedBot.trainingHours) || 0).toFixed(3)),
      selectedCandidateRoleFitScore: Number((Number(candidate ? candidate.roleFitScore : seedBot.roleFitScore) || 0).toFixed(2)),
      profileBlocked: !!(candidate && candidate.profileBlocked),
      promotionBlockReasons: candidate && candidate.promotionBlockReasons ? candidate.promotionBlockReasons : []
    };
  });
}

function summarizeExportedBots(rankedBots) {
  return rankedBots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    roleName: bot.metadata && bot.metadata.roleName ? bot.metadata.roleName : null,
    archetype: bot.archetype,
    difficultyBand: bot.difficultyBand,
    elo: bot.elo,
    promotionScore: bot.promotionScore,
    selectedCandidateId: bot.selectedCandidateId || bot.id,
    selectedCandidateGeneration: bot.selectedCandidateGeneration != null ? bot.selectedCandidateGeneration : bot.generation,
    selectedCandidateTrainingHours: bot.selectedCandidateTrainingHours != null ? bot.selectedCandidateTrainingHours : bot.trainingHours,
    trainingHours: bot.trainingHours,
    reviewBlocked: bot.reviewBlocked,
    profileBlocked: !!bot.profileBlocked,
    roleFitScore: Number((Number(bot.roleFitScore) || 0).toFixed(2)),
    promotionBlockReasons: bot.promotionBlockReasons || [],
    reviewSummary: bot.reviewSummary,
    metricAverages: bot.metricAverages || null
  }));
}

function buildRankedExportBots(populations, reviewRatings, bestRosterSeedCandidates, args, focusSeedBot, mutableRosterSeeds) {
  const promotionCandidates = Object.values(populations)
    .flat()
    .map((bot) => createPromotionCandidate(bot, reviewRatings.byBot.get(bot.id)))
    .sort((a, b) => b.promotionScore - a.promotionScore || b.elo - a.elo);
  const bestSeedPromotionCandidates = Array.from(bestRosterSeedCandidates.values())
    .sort((a, b) => b.promotionScore - a.promotionScore || b.elo - a.elo);
  const exportPool = promotionCandidates.filter((bot) => !bot.reviewBlocked && !bot.profileBlocked);
  const exportSeedPool = bestSeedPromotionCandidates.filter((bot) => !bot.reviewBlocked && !bot.profileBlocked);
  const selectedForExport = args.focusBotId
    ? buildFocusedBotExport(exportSeedPool.length ? exportSeedPool : (exportPool.length ? exportPool : promotionCandidates), focusSeedBot)
    : args.updateAllRoster
    ? buildUpdateAllRosterExport(exportSeedPool.length ? exportSeedPool : (exportPool.length ? exportPool : promotionCandidates), mutableRosterSeeds)
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
    promotionScore: Number.isFinite(Number(bot.promotionScore)) ? Math.round(Number(bot.promotionScore)) : Math.round(Number(bot.elo) || 0),
    selectedCandidateId: bot.selectedCandidateId || bot.id,
    selectedCandidateGeneration: bot.selectedCandidateGeneration != null ? bot.selectedCandidateGeneration : bot.generation,
    selectedCandidateTrainingHours: Number((Number(bot.selectedCandidateTrainingHours != null ? bot.selectedCandidateTrainingHours : bot.trainingHours) || 0).toFixed(3)),
    selectedCandidatePromotionScore: bot.selectedCandidatePromotionScore != null
      ? Math.round(bot.selectedCandidatePromotionScore)
      : (Number.isFinite(Number(bot.promotionScore)) ? Math.round(Number(bot.promotionScore)) : Math.round(Number(bot.elo) || 0)),
    metadata: bot.metadata ? clone(bot.metadata) : null,
    trainingHours: Number((Number(bot.trainingHours) || 0).toFixed(3)),
    controllerParams: bot.controllerParams,
    mutationProfile: bot.mutationProfile,
    network: bot.network,
    reviewBlocked: !!bot.reviewBlocked,
    profileBlocked: !!bot.profileBlocked,
    roleFitScore: Number((Number(bot.roleFitScore) || 0).toFixed(2)),
    promotionBlockReasons: bot.promotionBlockReasons || [],
    metricAverages: bot.metricAverages ? clone(bot.metricAverages) : null,
    reviewSummary: bot.reviewSummary
  }));

  return {
    promotionCandidates,
    rankedBots
  };
}

function buildEvolutionReport({
  args,
  inputSize,
  matchesPerGeneration,
  totalPlannedMatches,
  totalElapsedMs,
  reviewRatings,
  generationReports,
  bestRosterSeedCandidates,
  promotionCandidates,
  rankedBots,
  mutableRosterSeeds,
  staticRosterBots
}) {
  return {
    createdAt: new Date().toISOString(),
    runtimeVersion,
    seed: args.seed,
    generations: args.generations,
    populationPerArchetype: args.population,
    rosterMode: args.rosterMode,
    focusBotId: args.focusBotId,
    selfPlay: args.selfPlay,
    updateAllRoster: args.updateAllRoster,
    publishRuntime: args.publishRuntime,
    autoPromoteEvery: args.autoPromoteEvery,
    runLogFile: args.logFile,
    rosterFileUsed: args.rosterFile,
    rosterSeedCount: mutableRosterSeeds.length,
    staticRosterCount: staticRosterBots.length,
    inputSize,
    matchesPerGeneration,
    totalPlannedMatches,
    elapsedMs: totalElapsedMs,
    elapsedTrainingHours: Number((totalElapsedMs / 3600000).toFixed(3)),
    ratingsFileUsed: args.ratingsFile,
    humanReviewSummary: reviewRatings.summary,
    generationReports,
    bestRosterSeedCandidates: summarizeBestRosterSeedCandidates(bestRosterSeedCandidates, mutableRosterSeeds),
    blockedBots: promotionCandidates
      .filter((bot) => bot.reviewBlocked || bot.profileBlocked)
      .map((bot) => ({
        id: bot.id,
        name: bot.name,
        archetype: bot.archetype,
        elo: Math.round(bot.elo),
        promotionScore: Math.round(bot.promotionScore),
        trainingHours: Number((Number(bot.trainingHours) || 0).toFixed(3)),
        reviewBlocked: !!bot.reviewBlocked,
        profileBlocked: !!bot.profileBlocked,
        roleFitScore: Number((Number(bot.roleFitScore) || 0).toFixed(2)),
        promotionBlockReasons: bot.promotionBlockReasons || [],
        metricAverages: bot.metricAverages || null,
        reviewSummary: bot.reviewSummary
      })),
    exportedBots: summarizeExportedBots(rankedBots)
  };
}

function publishBotsToRoster(exportFile, reportsDir, destinationFile, logger) {
  const publishScript = path.join(repoRoot, 'tools', 'publish-bots.js');
  const publishReport = path.join(reportsDir, 'published-bots-report.json');
  childProcess.execFileSync(
    process.execPath,
    [publishScript, '--source', exportFile, '--destination', destinationFile, '--report', publishReport],
    { cwd: repoRoot, stdio: 'ignore' }
  );
  const report = JSON.parse(fs.readFileSync(publishReport, 'utf8'));
  logger.info(
    `[publish] destination=${report.destination}` +
    ` roster=${report.rosterCountAfter}` +
    ` added=${Array.isArray(report.addedBots) ? report.addedBots.length : 0}` +
    ` replaced=${Array.isArray(report.replacedBots) ? report.replacedBots.length : 0}` +
    ` skipped=${Array.isArray(report.skippedBots) ? report.skippedBots.length : 0}`
  );
  logger.fileOnly(`[publish] report=${publishReport}`);
  return report;
}

function autoPromoteRuntimeBots(exportFile, reportsDir, destinationFile, logger) {
  return publishBotsToRoster(exportFile, reportsDir, destinationFile, logger);
}

function writeAutoPromotionSnapshot(reportsDir, generationCompleted, rankedBots, bestRosterSeedCandidates, mutableRosterSeeds, destinationFile, logger) {
  const autoPromoteDir = path.join(reportsDir, 'auto-promote');
  ensureDir(autoPromoteDir);
  const exportFile = path.join(autoPromoteDir, 'exported-bots.js');
  const summaryFile = path.join(autoPromoteDir, 'snapshot-summary.json');
  writeBotsScript(exportFile, rankedBots);
  writeJson(summaryFile, {
    createdAt: new Date().toISOString(),
    runtimeVersion,
    generationCompleted: generationCompleted + 1,
    runLogFile: logger.filePath,
    exportedBots: summarizeExportedBots(rankedBots),
    bestRosterSeedCandidates: summarizeBestRosterSeedCandidates(bestRosterSeedCandidates, mutableRosterSeeds)
  });
  return autoPromoteRuntimeBots(exportFile, autoPromoteDir, destinationFile, logger);
}

function autoPublishRuntimeBots(exportFile, reportsDir, destinationFile, logger) {
  return publishBotsToRoster(exportFile, reportsDir, destinationFile, logger);
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
  let logger = null;
  try {
    const args = parseArgs(process.argv.slice(2));
    ensureDir(args.reportsDir);
    ensureDir(path.join(args.reportsDir, 'replays'));
    const checkpointsDir = path.join(args.reportsDir, 'checkpoints');
    ensureDir(checkpointsDir);
    args.logFile = args.logFile || path.join(args.reportsDir, `training-${createTimestampSlug()}.log`);
    logger = createRunLogger(args.logFile);

    const humanRatings = loadHumanRatings(args.ratingsFile);
    const reviewRatings = aggregateHumanRatings(humanRatings);
    const invokedCommand = ['node', 'tools/evolve-bots.js', ...process.argv.slice(2)].map(formatCommandArg).join(' ');
    const rosterBots = loadRosterBots(args.rosterFile);
    if (args.updateAllRoster && !rosterBots.length) {
      throw new Error(`--update-all-roster requires a non-empty roster file: ${args.rosterFile}`);
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

    const inputSize = getObservationSize();
    const random = createSeededRandom(args.seed);
    let populations = createPopulation(inputSize, args.population, random, mutableRosterSeeds, {
      focusBotId: focusSeedBot ? focusSeedBot.id : null
    });
    const bestRosterSeedCandidates = new Map();
    updateBestRosterSeedCandidates(bestRosterSeedCandidates, populations, reviewRatings, mutableRosterSeeds);
    const generationReports = [];
    let finalReplayBundles = [];
    let lastAutoPromotedGeneration = null;
    const totalBots = Object.values(populations).flat().length;
    const matchesPerGeneration = countTrainingMatches(totalBots, staticRosterBots.length);
    const totalPlannedMatches = matchesPerGeneration * args.generations;
    const overallStartedAt = Date.now();

    logger.info(
      `Run start | generations=${args.generations} population=${args.population} seed=${args.seed}` +
      ` matchesPerGeneration=${matchesPerGeneration} plannedMatches=${totalPlannedMatches}`
    );
    logger.info(
      `Config | roster=${summarizeRosterConfig(args, mutableRosterSeeds, staticRosterBots)}` +
      ` scoreLimit=${args.scoreLimit} maxTicks=${args.maxTicks}` +
      ` checkpointEvery=${args.checkpointEvery} progressEvery=${describeProgressEveryMatches(args.progressEveryMatches, matchesPerGeneration)}` +
      ` autoPromoteEvery=${args.autoPromoteEvery} publishRuntime=${args.publishRuntime}`
    );
    logger.info(
      `Artifacts | reportsDir=${args.reportsDir} exportFile=${args.exportFile}` +
      ` rosterFile=${args.rosterFile} logFile=${logger.filePath}`
    );
    logger.info(`Signal | ${summarizeHumanReviewSignal(reviewRatings.summary)} | trackedSeeds=${mutableRosterSeeds.length}`);
    if (!humanRatings.length) {
      logger.warn('No human review ratings loaded; promotion and fine tuning are using simulation signals only.');
    }
    if (!mutableRosterSeeds.length) {
      logger.warn('No mutable roster seeds are being tracked; role-specific fine-tuning diagnostics will only appear in the JSON report.');
    }
    logger.fileOnly(`Rerun | ${invokedCommand}`);

    for (let generation = 0; generation < args.generations; generation += 1) {
      const generationLabel = `[Gen ${generation + 1}/${args.generations}]`;
      const generationStartedAt = Date.now();

      const { nextPopulations, summary, replayBundles, totalMatches } = runGeneration(populations, generation, random, {
        scoreLimit: args.scoreLimit,
        maxTicks: args.maxTicks,
        inputSize,
        staticBots: staticRosterBots,
        progressEveryMatches: args.progressEveryMatches,
        onProgress(progress) {
          if (progress.processedMatches >= progress.totalMatches) return;
          const elapsedMs = Date.now() - overallStartedAt;
          const overallProcessedMatches = generation * matchesPerGeneration + progress.processedMatches;
          const overallRatio = totalPlannedMatches > 0 ? overallProcessedMatches / totalPlannedMatches : 1;
          const etaMs = overallProcessedMatches > 0
            ? (elapsedMs / overallProcessedMatches) * (totalPlannedMatches - overallProcessedMatches)
            : 0;
          const matchRate = overallProcessedMatches > 0 ? overallProcessedMatches / Math.max(1, elapsedMs / 1000) : 0;
          logger.info(
            `${generationLabel} progress ${formatPercent(progress.processedMatches / progress.totalMatches)}` +
            ` overall=${formatPercent(overallRatio)} rate=${formatDecimal(matchRate, 1)} matches/s eta=${formatDuration(etaMs)}`
          );
        }
      });
      const generationElapsedMs = Date.now() - generationStartedAt;
      const generationTrainingHours = generationElapsedMs / 3600000;
      Object.values(nextPopulations).forEach((bots) => {
        bots.forEach((bot) => {
          bot.trainingHours = (Number(bot.trainingHours) || 0) + generationTrainingHours;
        });
      });
      updateBestRosterSeedCandidates(bestRosterSeedCandidates, nextPopulations, reviewRatings, mutableRosterSeeds);
      const tuningDiagnostics = summarizeTrackedSeedDiagnostics(bestRosterSeedCandidates, mutableRosterSeeds);
      generationReports.push({
        generation,
        totalMatches,
        elapsedMs: generationElapsedMs,
        summary,
        tuningDiagnostics
      });
      populations = nextPopulations;
      finalReplayBundles = replayBundles;

      const elapsedMs = Date.now() - overallStartedAt;
      const completedMatches = (generation + 1) * matchesPerGeneration;
      const overallEtaMs = completedMatches > 0
        ? (elapsedMs / completedMatches) * (totalPlannedMatches - completedMatches)
        : 0;
      const overallMatchRate = completedMatches > 0 ? completedMatches / Math.max(1, elapsedMs / 1000) : 0;
      logger.info(
        `${generationLabel} complete ${formatDuration(generationElapsedMs)}` +
        ` overall=${formatPercent((generation + 1) / Math.max(1, args.generations))}` +
        ` rate=${formatDecimal(overallMatchRate, 1)} matches/s eta=${formatDuration(overallEtaMs)}` +
        ` | ${summarizeGenerationLeaders(summary)}`
      );
      if (tuningDiagnostics.length) {
        logger.info(`${generationLabel} tune | ${tuningDiagnostics.join(' | ')}`);
      }

      if (args.checkpointEvery > 0 && ((generation + 1) % args.checkpointEvery === 0 || generation === args.generations - 1)) {
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
          progressEveryMatchesResolved: resolveProgressEveryMatches(args.progressEveryMatches, matchesPerGeneration),
          runLogFile: logger.filePath,
          matchesPerGeneration,
          totalPlannedMatches,
          completedMatches,
          elapsedMs,
          trainingHoursAddedThisGeneration: generationTrainingHours,
          generationReports,
          topCandidates: summarizePromotionCandidates(populations, reviewRatings),
          bestRosterSeedCandidates: summarizeBestRosterSeedCandidates(bestRosterSeedCandidates, mutableRosterSeeds)
        };
        writeGenerationCheckpoint(checkpointsDir, checkpoint);
        logger.info(`${generationLabel} checkpoint ${path.join(checkpointsDir, 'latest-evolution-checkpoint.json')}`);
      }

      if (args.autoPromoteEvery > 0 && (((generation + 1) % args.autoPromoteEvery === 0) || generation === args.generations - 1)) {
        const { rankedBots } = buildRankedExportBots(populations, reviewRatings, bestRosterSeedCandidates, args, focusSeedBot, mutableRosterSeeds);
        const publishReport = writeAutoPromotionSnapshot(args.reportsDir, generation, rankedBots, bestRosterSeedCandidates, mutableRosterSeeds, args.rosterFile, logger);
        lastAutoPromotedGeneration = generation;
        const appliedCount = (publishReport.addedBots ? publishReport.addedBots.length : 0)
          + (publishReport.replacedBots ? publishReport.replacedBots.length : 0);
        const skippedCount = publishReport.skippedBots ? publishReport.skippedBots.length : 0;
        const targetRosterName = path.basename(args.rosterFile);
        if (appliedCount > 0) {
          logger.info(`${generationLabel} auto-promote applied=${appliedCount} skipped=${skippedCount} target=${targetRosterName}`);
        } else {
          logger.info(`${generationLabel} auto-promote no-op skipped=${skippedCount} target=${targetRosterName}`);
        }
      }
    }

    const { promotionCandidates, rankedBots } = buildRankedExportBots(
      populations,
      reviewRatings,
      bestRosterSeedCandidates,
      args,
      focusSeedBot,
      mutableRosterSeeds
    );

    writeBotsScript(args.exportFile, rankedBots);
    const totalElapsedMs = Date.now() - overallStartedAt;

    const report = buildEvolutionReport({
      args,
      inputSize,
      matchesPerGeneration,
      totalPlannedMatches,
      totalElapsedMs,
      reviewRatings,
      generationReports,
      bestRosterSeedCandidates,
      promotionCandidates,
      rankedBots,
      mutableRosterSeeds,
      staticRosterBots
    });

    const reportPath = path.join(args.reportsDir, 'latest-evolution-report.json');
    writeJson(reportPath, report);

    finalReplayBundles.slice(0, 8).forEach((bundle) => {
      const outputPath = path.join(args.reportsDir, 'replays', `${bundle.replayId}.json`);
      writeJson(outputPath, bundle);
    });

    logger.info(`Training complete | elapsed=${formatDuration(totalElapsedMs)} exported=${rankedBots.length} report=${reportPath}`);
    logger.info(`Artifacts ready | export=${args.exportFile} checkpoint=${path.join(checkpointsDir, 'latest-evolution-checkpoint.json')} log=${logger.filePath}`);
    if (args.publishRuntime && lastAutoPromotedGeneration !== args.generations - 1) {
      autoPublishRuntimeBots(args.exportFile, args.reportsDir, args.rosterFile, logger);
    }
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error);
    if (logger) logger.error(message);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

main();
