const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const config = require(path.join(repoRoot, 'runtime/js/config.js'));
const simCore = require(path.join(repoRoot, 'runtime/js/sim-core.js'));
const controllers = require(path.join(repoRoot, 'runtime/js/controllers.js'));

const EXPORT_SCHEMA = 'human-training-export/v1';
const DATASET_SCHEMA = 'human-training-dataset/v1';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function shuffleInPlace(items, random = Math.random) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

function normalizeAction(action) {
  return {
    moveAxis: action && Number.isFinite(action.moveAxis) ? clamp(Math.round(action.moveAxis), -1, 1) : 0,
    fire: !!(action && action.fire)
  };
}

function normalizeMatchOptions(value) {
  const matchOptions = value && typeof value === 'object' ? value : {};
  const defaults = config.defaults || {};
  return {
    mode: matchOptions.mode === 'pvp' ? 'pvp' : 'cpu',
    demo: !!matchOptions.demo,
    scoreLimit: Math.max(1, Math.floor(Number(matchOptions.scoreLimit) || defaults.scoreLimit || 7)),
    powerupsEnabled: !!matchOptions.powerupsEnabled,
    trailsEnabled: !!matchOptions.trailsEnabled,
    theme: matchOptions.theme || defaults.theme || 'neon',
    difficulty: matchOptions.difficulty || defaults.difficulty || 'spicy'
  };
}

function normalizeReplay(value) {
  const replay = value && typeof value === 'object' ? value : {};
  return {
    version: Number(replay.version) || 1,
    seed: Number.isFinite(Number(replay.seed)) ? Number(replay.seed) : 1,
    configHash: replay.configHash || null,
    durationTicks: Math.max(0, Math.floor(Number(replay.durationTicks) || 0)),
    fixedTickRate: Math.max(1, Math.floor(Number(replay.fixedTickRate) || simCore.DEFAULT_TICK_RATE || 120)),
    decisionIntervalTicks: Math.max(1, Math.floor(Number(replay.decisionIntervalTicks) || simCore.DEFAULT_DECISION_INTERVAL_TICKS || 2)),
    actionEncoding: replay.actionEncoding || 'delta-v1',
    actions: Array.isArray(replay.actions)
      ? replay.actions.map((entry) => ({
          tick: Math.max(0, Math.floor(Number(entry && entry.tick) || 0)),
          side: entry && entry.side === 'right' ? 'right' : 'left',
          action: normalizeAction(entry && entry.action)
        }))
      : []
  };
}

function normalizeTrainingSession(session) {
  if (!session || !session.sessionId) return null;
  const bot = session.bot && typeof session.bot === 'object' ? session.bot : {};
  const finalScore = session.finalScore && typeof session.finalScore === 'object' ? session.finalScore : {};
  const result = session.result && typeof session.result === 'object' ? session.result : {};
  return {
    sessionId: String(session.sessionId),
    capturedAt: session.capturedAt || null,
    runtimeVersion: session.runtimeVersion || null,
    humanSide: session.humanSide === 'right' ? 'right' : 'left',
    bot: {
      id: bot.id ? String(bot.id) : '',
      name: bot.name ? String(bot.name) : 'CPU',
      difficultyBand: bot.difficultyBand || null,
      elo: Number.isFinite(Number(bot.elo)) ? Number(bot.elo) : null
    },
    matchOptions: normalizeMatchOptions(session.matchOptions),
    finalScore: {
      left: Math.max(0, Math.floor(Number(finalScore.left) || 0)),
      right: Math.max(0, Math.floor(Number(finalScore.right) || 0)),
      human: Math.max(0, Math.floor(Number(finalScore.human) || 0)),
      bot: Math.max(0, Math.floor(Number(finalScore.bot) || 0))
    },
    result: {
      humanWon: !!result.humanWon,
      botWon: !!result.botWon
    },
    matchStats: clone(session.matchStats || {}),
    replay: normalizeReplay(session.replay)
  };
}

function normalizeExportPayload(raw) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  if (payload.schema && payload.schema !== EXPORT_SCHEMA) {
    throw new Error(`Unsupported human training export schema: ${payload.schema}`);
  }
  return {
    schema: EXPORT_SCHEMA,
    exportedAt: payload.exportedAt || null,
    runtimeVersion: payload.runtimeVersion || null,
    sessions: (Array.isArray(payload.sessions) ? payload.sessions : []).map(normalizeTrainingSession).filter(Boolean)
  };
}

function loadDataset(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      schema: DATASET_SCHEMA,
      importedAt: null,
      sessions: [],
      summary: {
        sessionCount: 0,
        botCount: 0,
        totalSamples: 0,
        byBot: []
      }
    };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (raw && raw.schema === EXPORT_SCHEMA) {
    const normalized = normalizeExportPayload(raw);
    const summary = buildDatasetSummary(normalized.sessions);
    return {
      schema: DATASET_SCHEMA,
      importedAt: normalized.exportedAt,
      sessions: normalized.sessions,
      summary
    };
  }
  if (raw && raw.schema && raw.schema !== DATASET_SCHEMA) {
    throw new Error(`Unsupported human training dataset schema: ${raw.schema}`);
  }
  const sessions = (Array.isArray(raw && raw.sessions) ? raw.sessions : []).map(normalizeTrainingSession).filter(Boolean);
  return {
    schema: DATASET_SCHEMA,
    importedAt: raw && raw.importedAt ? raw.importedAt : null,
    sessions,
    summary: raw && raw.summary ? raw.summary : buildDatasetSummary(sessions)
  };
}

function mergeSessions(existingSessions, incomingSessions) {
  const byId = new Map();
  let duplicateCount = 0;
  for (const session of existingSessions.map(normalizeTrainingSession).filter(Boolean)) {
    byId.set(session.sessionId, session);
  }
  for (const session of incomingSessions.map(normalizeTrainingSession).filter(Boolean)) {
    if (byId.has(session.sessionId)) duplicateCount += 1;
    byId.set(session.sessionId, session);
  }
  const sessions = Array.from(byId.values()).sort((left, right) => {
    const leftStamp = Date.parse(left.capturedAt || 0) || 0;
    const rightStamp = Date.parse(right.capturedAt || 0) || 0;
    return rightStamp - leftStamp || left.sessionId.localeCompare(right.sessionId);
  });
  return {
    sessions,
    duplicateCount
  };
}

function expandReplayActions(replay) {
  const normalizedReplay = normalizeReplay(replay);
  const interval = normalizedReplay.decisionIntervalTicks;
  const grouped = {
    left: new Map(),
    right: new Map()
  };

  for (const entry of normalizedReplay.actions) {
    grouped[entry.side].set(entry.tick, normalizeAction(entry.action));
  }

  const currentMoveAxis = {
    left: 0,
    right: 0
  };
  const denseActions = {
    left: [],
    right: []
  };

  for (let tick = interval; tick <= normalizedReplay.durationTicks; tick += interval) {
    for (const side of ['left', 'right']) {
      const scheduled = grouped[side].get(tick);
      if (scheduled) currentMoveAxis[side] = scheduled.moveAxis;
      denseActions[side].push({
        tick,
        side,
        action: {
          moveAxis: currentMoveAxis[side],
          fire: !!(scheduled && scheduled.fire)
        }
      });
    }
  }

  return denseActions;
}

function buildSessionBotSummary(session, sampleCount = 0) {
  const botGoalDiff = session.finalScore.bot - session.finalScore.human;
  const sessionCount = 1;
  const botWins = session.result.botWon ? 1 : 0;
  const humanWins = session.result.humanWon ? 1 : 0;
  const draws = !session.result.botWon && !session.result.humanWon ? 1 : 0;
  const botWinRate = botWins / sessionCount;
  const averageGoalDiff = botGoalDiff / sessionCount;
  return {
    botId: session.bot.id,
    botName: session.bot.name,
    sessionCount,
    botWins,
    humanWins,
    draws,
    botWinRate,
    averageGoalDiff,
    challengeScore: clamp((botWinRate - 0.5) * 80 + averageGoalDiff * 6, -60, 60),
    sampleCount
  };
}

function summarizeSessionsByBot(sessions, sampleCounts = new Map()) {
  const byBot = new Map();
  for (const rawSession of sessions) {
    const session = normalizeTrainingSession(rawSession);
    if (!session || !session.bot.id) continue;
    const current = byBot.get(session.bot.id) || {
      botId: session.bot.id,
      botName: session.bot.name,
      sessionCount: 0,
      botWins: 0,
      humanWins: 0,
      draws: 0,
      goalDiffTotal: 0,
      sampleCount: 0
    };
    current.sessionCount += 1;
    current.botWins += session.result.botWon ? 1 : 0;
    current.humanWins += session.result.humanWon ? 1 : 0;
    current.draws += !session.result.botWon && !session.result.humanWon ? 1 : 0;
    current.goalDiffTotal += session.finalScore.bot - session.finalScore.human;
    current.sampleCount = sampleCounts.get(session.bot.id) || current.sampleCount;
    byBot.set(session.bot.id, current);
  }
  return new Map(Array.from(byBot.entries(), ([botId, summary]) => [botId, {
    botId,
    botName: summary.botName,
    sessionCount: summary.sessionCount,
    botWins: summary.botWins,
    humanWins: summary.humanWins,
    draws: summary.draws,
    botWinRate: summary.sessionCount ? summary.botWins / summary.sessionCount : 0,
    averageGoalDiff: summary.sessionCount ? summary.goalDiffTotal / summary.sessionCount : 0,
    challengeScore: clamp(
      ((summary.sessionCount ? summary.botWins / summary.sessionCount : 0) - 0.5) * 80 +
      (summary.sessionCount ? summary.goalDiffTotal / summary.sessionCount : 0) * 6,
      -60,
      60
    ),
    sampleCount: summary.sampleCount
  }]));
}

function buildDatasetSummary(sessions, sampleCounts = new Map()) {
  const byBot = Array.from(summarizeSessionsByBot(sessions, sampleCounts).values())
    .sort((left, right) => right.sessionCount - left.sessionCount || left.botId.localeCompare(right.botId));
  return {
    sessionCount: sessions.length,
    botCount: byBot.length,
    totalSamples: byBot.reduce((sum, entry) => sum + (entry.sampleCount || 0), 0),
    byBot
  };
}

function createReplayController(denseActions, onDecision) {
  let cursor = 0;
  return {
    kind: 'replay-schedule',
    controllerParams: {
      reactionDelayTicks: 0
    },
    decide(observation) {
      const next = denseActions[cursor] || {
        tick: observation.tick,
        action: { moveAxis: 0, fire: false }
      };
      cursor += 1;
      const action = normalizeAction(next.action);
      if (typeof onDecision === 'function') onDecision(observation, action);
      return action;
    }
  };
}

function collectSessionSamples(rawSession) {
  const session = normalizeTrainingSession(rawSession);
  if (!session) {
    return {
      session: null,
      samples: [],
      validation: null
    };
  }

  const denseActions = expandReplayActions(session.replay);
  const samples = [];
  const recordSide = session.humanSide;

  const runtime = simCore.createSimulation({
    config,
    seed: session.replay.seed
  });

  runtime.startMatch({
    mode: session.matchOptions.mode,
    demo: !!session.matchOptions.demo,
    skipCountdown: true,
    scoreLimit: session.matchOptions.scoreLimit,
    powerupsEnabled: session.matchOptions.powerupsEnabled,
    trailsEnabled: false,
    theme: session.matchOptions.theme,
    difficulty: session.matchOptions.difficulty,
    leftController: createReplayController(denseActions.left, recordSide === 'left'
      ? (observation, action) => {
          samples.push({
            botId: session.bot.id,
            botName: session.bot.name,
            sessionId: session.sessionId,
            tick: observation.tick,
            inputs: controllers.flattenObservation(observation),
            targets: {
              moveLeft: action.moveAxis < 0 ? 1 : 0,
              moveRight: action.moveAxis > 0 ? 1 : 0,
              fire: action.fire ? 1 : 0
            }
          });
        }
      : null),
    rightController: createReplayController(denseActions.right, recordSide === 'right'
      ? (observation, action) => {
          samples.push({
            botId: session.bot.id,
            botName: session.bot.name,
            sessionId: session.sessionId,
            tick: observation.tick,
            inputs: controllers.flattenObservation(observation),
            targets: {
              moveLeft: action.moveAxis < 0 ? 1 : 0,
              moveRight: action.moveAxis > 0 ? 1 : 0,
              fire: action.fire ? 1 : 0
            }
          });
        }
      : null)
  });

  while (runtime.state.tick < session.replay.durationTicks && !runtime.state.gameOver) {
    runtime.stepSimulation(1);
  }

  return {
    session,
    samples,
    validation: {
      tick: runtime.state.tick,
      gameOver: runtime.state.gameOver,
      finalScore: {
        left: runtime.state.leftScore,
        right: runtime.state.rightScore
      },
      recordedSampleCount: samples.length,
      scheduledDecisionCount: denseActions[recordSide].length
    }
  };
}

function sampleList(items, limit, random = Math.random) {
  if (!Array.isArray(items)) return [];
  if (!Number.isFinite(limit) || limit <= 0 || items.length <= limit) return items.slice();
  const copy = items.slice();
  shuffleInPlace(copy, random);
  return copy.slice(0, limit);
}

function buildImitationDatasetByBot(sessions, options = {}) {
  const random = options.random || Math.random;
  const maxSamplesPerBot = Number.isFinite(options.maxSamplesPerBot) ? Math.max(1, Math.floor(options.maxSamplesPerBot)) : 4000;
  const samplesByBot = new Map();
  const validations = [];

  for (const rawSession of sessions) {
    const { session, samples, validation } = collectSessionSamples(rawSession);
    if (!session || !session.bot.id) continue;
    const list = samplesByBot.get(session.bot.id) || [];
    list.push(...samples);
    samplesByBot.set(session.bot.id, list);
    validations.push({
      sessionId: session.sessionId,
      botId: session.bot.id,
      recordedSampleCount: samples.length,
      replayValidation: validation
    });
  }

  const sampleCounts = new Map();
  const limitedSamplesByBot = new Map();
  for (const [botId, samples] of samplesByBot.entries()) {
    const limited = sampleList(samples, maxSamplesPerBot, random);
    limitedSamplesByBot.set(botId, limited);
    sampleCounts.set(botId, limited.length);
  }

  return {
    byBot: limitedSamplesByBot,
    sampleCounts,
    validations
  };
}

function createGradientBuffer(network) {
  return network.layers.map((layer) => ({
    biases: new Array(layer.biases.length).fill(0),
    weights: layer.weights.map((row) => new Array(row.length).fill(0))
  }));
}

function forwardPass(network, inputs) {
  const activations = [inputs.slice()];
  const weightedSums = [];
  let current = inputs.slice();

  for (let layerIndex = 0; layerIndex < network.layers.length; layerIndex += 1) {
    const layer = network.layers[layerIndex];
    const sums = new Array(layer.biases.length).fill(0);
    const next = new Array(layer.biases.length).fill(0);
    const isLastLayer = layerIndex === network.layers.length - 1;

    for (let neuron = 0; neuron < layer.biases.length; neuron += 1) {
      let sum = layer.biases[neuron];
      const weights = layer.weights[neuron];
      for (let i = 0; i < weights.length; i += 1) {
        sum += weights[i] * (current[i] || 0);
      }
      sums[neuron] = sum;
      next[neuron] = isLastLayer ? sum : Math.tanh(sum);
    }

    weightedSums.push(sums);
    activations.push(next);
    current = next;
  }

  return { activations, weightedSums };
}

function trainNetworkWithBce(network, samples, options = {}) {
  if (!network || !Array.isArray(network.layers) || !network.layers.length || !samples.length) {
    return {
      sampleCount: 0,
      epochs: 0,
      averageLoss: 0
    };
  }

  const outputLayer = network.layers[network.layers.length - 1];
  const outputSize = outputLayer.biases.length;
  const batchSize = Math.max(1, Math.floor(Number(options.batchSize) || 64));
  const epochs = Math.max(1, Math.floor(Number(options.epochs) || 3));
  const learningRate = Number(options.learningRate) || 0.01;
  const random = options.random || Math.random;
  let totalLoss = 0;
  let lossSampleCount = 0;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const shuffled = shuffleInPlace(samples.slice(), random);
    for (let batchStart = 0; batchStart < shuffled.length; batchStart += batchSize) {
      const batch = shuffled.slice(batchStart, batchStart + batchSize);
      const gradients = createGradientBuffer(network);

      for (const sample of batch) {
        const targets = [
          sample.targets.moveLeft ? 1 : 0,
          sample.targets.moveRight ? 1 : 0,
          sample.targets.fire ? 1 : 0
        ];
        while (targets.length < outputSize) targets.push(0);

        const { activations } = forwardPass(network, sample.inputs);
        let deltas = new Array(outputSize).fill(0);
        const outputActivations = activations[activations.length - 1];

        for (let i = 0; i < outputSize; i += 1) {
          const probability = clamp(sigmoid(outputActivations[i] || 0), 1e-7, 1 - 1e-7);
          const target = targets[i] || 0;
          totalLoss += -(target * Math.log(probability) + (1 - target) * Math.log(1 - probability));
          lossSampleCount += 1;
          deltas[i] = probability - target;
        }

        for (let layerIndex = network.layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
          const layer = network.layers[layerIndex];
          const previousActivations = activations[layerIndex];
          const layerGradients = gradients[layerIndex];
          const nextDeltas = layerIndex > 0 ? new Array(previousActivations.length).fill(0) : null;

          for (let neuron = 0; neuron < layer.biases.length; neuron += 1) {
            const delta = deltas[neuron] || 0;
            layerGradients.biases[neuron] += delta;
            const weights = layer.weights[neuron];
            const weightGradients = layerGradients.weights[neuron];
            for (let inputIndex = 0; inputIndex < weights.length; inputIndex += 1) {
              weightGradients[inputIndex] += delta * (previousActivations[inputIndex] || 0);
              if (nextDeltas) {
                nextDeltas[inputIndex] += weights[inputIndex] * delta;
              }
            }
          }

          if (nextDeltas) {
            const hiddenActivations = activations[layerIndex];
            for (let i = 0; i < nextDeltas.length; i += 1) {
              nextDeltas[i] *= 1 - Math.pow(hiddenActivations[i] || 0, 2);
            }
            deltas = nextDeltas;
          }
        }
      }

      const scale = learningRate / batch.length;
      for (let layerIndex = 0; layerIndex < network.layers.length; layerIndex += 1) {
        const layer = network.layers[layerIndex];
        const layerGradients = gradients[layerIndex];
        for (let neuron = 0; neuron < layer.biases.length; neuron += 1) {
          layer.biases[neuron] = clamp(layer.biases[neuron] - layerGradients.biases[neuron] * scale, -3, 3);
          const weights = layer.weights[neuron];
          const weightGradients = layerGradients.weights[neuron];
          for (let inputIndex = 0; inputIndex < weights.length; inputIndex += 1) {
            weights[inputIndex] = clamp(weights[inputIndex] - weightGradients[inputIndex] * scale, -3, 3);
          }
        }
      }
    }
  }

  return {
    sampleCount: samples.length,
    epochs,
    batchSize,
    learningRate,
    averageLoss: lossSampleCount ? totalLoss / lossSampleCount : 0
  };
}

function fineTuneBotWithSamples(bot, samples, options = {}) {
  if (!bot || !bot.network || !Array.isArray(samples) || !samples.length) {
    return {
      sampleCount: 0,
      epochs: 0,
      averageLoss: 0
    };
  }
  return trainNetworkWithBce(bot.network, samples, options);
}

module.exports = {
  EXPORT_SCHEMA,
  DATASET_SCHEMA,
  normalizeTrainingSession,
  normalizeExportPayload,
  loadDataset,
  mergeSessions,
  expandReplayActions,
  summarizeSessionsByBot,
  buildDatasetSummary,
  buildSessionBotSummary,
  collectSessionSamples,
  buildImitationDatasetByBot,
  fineTuneBotWithSamples
};
