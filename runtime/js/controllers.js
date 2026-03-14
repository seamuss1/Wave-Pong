(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WavePong = root.WavePong || {};
    root.WavePong.Controllers = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_SCRIPTED_BY_DIFFICULTY = {
    chill: { leadScale: 0.22, deadband: 0.09, fireChance: 0.22, awayFireChance: 0.08, maxAimError: 0.2 },
    spicy: { leadScale: 0.34, deadband: 0.055, fireChance: 0.35, awayFireChance: 0.12, maxAimError: 0.13 },
    absurd: { leadScale: 0.42, deadband: 0.03, fireChance: 0.48, awayFireChance: 0.18, maxAimError: 0.08 }
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function tanh(value) {
    if (typeof Math.tanh === 'function') return Math.tanh(value);
    const exp2x = Math.exp(value * 2);
    return (exp2x - 1) / (exp2x + 1);
  }

  function sigmoid(value) {
    return 1 / (1 + Math.exp(-value));
  }

  function flattenObservation(observation) {
    const values = [
      observation.self.y,
      observation.self.vy,
      observation.self.h,
      observation.self.aimAngle,
      observation.self.charge,
      observation.self.level,
      observation.self.cooldown,
      observation.opponent.y,
      observation.opponent.vy,
      observation.opponent.h,
      observation.opponent.aimAngle,
      observation.opponent.charge,
      observation.opponent.level,
      observation.score.self / Math.max(1, observation.score.limit),
      observation.score.opponent / Math.max(1, observation.score.limit),
      clamp(observation.meta.rally / 20, 0, 2),
      clamp(observation.meta.ballsInPlay / 4, 0, 1),
      clamp(observation.meta.powerupsInPlay / 4, 0, 1),
      observation.meta.countdownActive ? 1 : 0
    ];

    for (let i = 0; i < 4; i += 1) {
      const ball = observation.balls[i] || { x: 0, y: 0, vx: 0, vy: 0, towardSelf: false, radius: 0 };
      values.push(ball.x, ball.y, ball.vx, ball.vy, ball.towardSelf ? 1 : -1, ball.radius);
    }

    for (let i = 0; i < 4; i += 1) {
      const item = observation.powerups[i] || { x: 0, y: 0, radius: 0, life: 0 };
      values.push(item.x, item.y, item.radius, item.life);
    }

    return values;
  }

  function inferFeedForward(network, inputs) {
    let activations = inputs.slice();
    for (let layerIndex = 0; layerIndex < network.layers.length; layerIndex += 1) {
      const layer = network.layers[layerIndex];
      const next = new Array(layer.biases.length).fill(0);
      for (let neuron = 0; neuron < layer.biases.length; neuron += 1) {
        let sum = layer.biases[neuron];
        const weights = layer.weights[neuron];
        for (let i = 0; i < weights.length; i += 1) {
          sum += weights[i] * (activations[i] || 0);
        }
        const isLastLayer = layerIndex === network.layers.length - 1;
        next[neuron] = isLastLayer ? sum : tanh(sum);
      }
      activations = next;
    }
    return activations;
  }

  function createHumanController(inputSource, controllerParams = {}) {
    return {
      kind: 'human',
      controllerParams,
      decide() {
        const snapshot = typeof inputSource === 'function' ? inputSource() : (inputSource || {});
        return {
          moveAxis: snapshot.moveAxis || 0,
          fire: !!snapshot.fire
        };
      }
    };
  }

  function createScriptedController(params = {}) {
    const difficulty = params.difficulty || 'spicy';
    const tuning = { ...DEFAULT_SCRIPTED_BY_DIFFICULTY[difficulty], ...params };
    let fireCooldown = 0;
    return {
      kind: 'scripted',
      controllerParams: {
        reactionDelayTicks: params.reactionDelayTicks || 0,
        actionHoldTicks: params.actionHoldTicks || 0
      },
      clone() {
        return createScriptedController({ ...params });
      },
      decide(observation, context = {}) {
        fireCooldown = Math.max(0, fireCooldown - 1);
        const random = typeof context.random === 'function' ? context.random : Math.random;
        const targetBall = observation.balls.find((ball) => ball.towardSelf) || observation.balls[0];
        let moveAxis = 0;
        if (targetBall) {
          const predictedY = targetBall.y + targetBall.vy * tuning.leadScale;
          const delta = predictedY - observation.self.y;
          if (delta > tuning.deadband) moveAxis = 1;
          else if (delta < -tuning.deadband) moveAxis = -1;
        }

        let fire = false;
        if (targetBall && observation.self.cooldown < 0.08 && observation.self.charge > 0.1 && fireCooldown <= 0) {
          const distance = Math.hypot(targetBall.x, targetBall.y - observation.self.y);
          const centered = Math.abs((targetBall.y || 0) - observation.self.y) < tuning.maxAimError;
          const towardChance = targetBall.towardSelf ? tuning.fireChance : tuning.awayFireChance;
          const chargeBonus = clamp(observation.self.charge * 0.5, 0, 0.35);
          if (centered && distance < 1.25 && random() < towardChance + chargeBonus) {
            fire = true;
            fireCooldown = 2;
          }
        }

        return { moveAxis, fire };
      }
    };
  }

  function createNeuralController(botAsset) {
    if (!botAsset || !botAsset.network || botAsset.schemaVersion !== 1) {
      throw new Error('Invalid bot asset. Expected schemaVersion 1 with a network definition.');
    }
    const controllerParams = botAsset.controllerParams || {};
    return {
      kind: 'neural',
      botId: botAsset.id,
      controllerParams,
      clone() {
        return createNeuralController(botAsset);
      },
      decide(observation) {
        const inputs = flattenObservation(observation);
        const outputs = inferFeedForward(botAsset.network, inputs);
        const moveLeft = sigmoid(outputs[0] || 0);
        const moveRight = sigmoid(outputs[1] || 0);
        const fireScore = sigmoid(outputs[2] || 0);
        let moveAxis = 0;
        if (moveLeft > 0.55 || moveRight > 0.55) {
          moveAxis = moveLeft > moveRight ? -1 : 1;
        }
        return {
          moveAxis,
          fire: fireScore > (controllerParams.fireThreshold || 0.58)
        };
      }
    };
  }

  function selectBotForDifficulty(bots, difficulty) {
    function activityScore(bot) {
      const validation = bot && bot.runtimeValidation;
      return validation ? (Number(validation.totalMovedTicks) || 0) + (Number(validation.totalGoals) || 0) * 100 : 0;
    }

    const roster = (Array.isArray(bots) ? bots : [])
      .filter((bot) => !bot.reviewBlocked && !bot.runtimeDisabled)
      .slice()
      .sort((a, b) => {
        const activityDelta = activityScore(b) - activityScore(a);
        if (activityDelta !== 0) return activityDelta;
        return (Number(b.elo) || 0) - (Number(a.elo) || 0);
      });
    const exact = roster.filter((bot) => bot.difficultyBand === difficulty);
    if (exact.length) return exact[0];
    return roster[0] || null;
  }

  return {
    flattenObservation,
    inferFeedForward,
    createHumanController,
    createScriptedController,
    createNeuralController,
    selectBotForDifficulty
  };
});
