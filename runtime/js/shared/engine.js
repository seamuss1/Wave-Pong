(function (root, factory) {
  const config = (typeof module === 'object' && module.exports)
    ? require('../config.js')
    : (root && root.WavePong && root.WavePong.CONFIG);
  const simCore = (typeof module === 'object' && module.exports)
    ? require('../sim-core.js')
    : (root && root.WavePong && root.WavePong.SimCore);
  const multiplayer = (typeof module === 'object' && module.exports)
    ? require('./multiplayer.js')
    : (root && root.WavePong && root.WavePong.Multiplayer);
  const api = factory(config, simCore, multiplayer);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WavePong = root.WavePong || {};
    root.WavePong.Engine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (config, simCore, multiplayer) {
  function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Set) return { __wavePongSet: Array.from(value.values(), clone) };
    if (Array.isArray(value)) return value.map(clone);
    const next = {};
    for (const key of Object.keys(value)) {
      next[key] = clone(value[key]);
    }
    return next;
  }

  function restoreSerializable(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(restoreSerializable);
    if (value.__wavePongSet && Array.isArray(value.__wavePongSet)) {
      return new Set(value.__wavePongSet.map(restoreSerializable));
    }
    const next = {};
    for (const key of Object.keys(value)) {
      next[key] = restoreSerializable(value[key]);
    }
    return next;
  }

  function mapPaddle(paddle) {
    return {
      y: paddle.y,
      h: paddle.h,
      vy: paddle.vy,
      aimAngle: paddle.aimAngle,
      pulseCharge: paddle.pulseCharge,
      pulseLevel: paddle.pulseLevel,
      cooldown: paddle.cooldown,
      jamTimer: paddle.jamTimer,
      slowTimer: paddle.slowTimer,
      waveXP: paddle.waveXP
    };
  }

  function mapBall(ball) {
    return {
      id: ball.id,
      x: ball.x,
      y: ball.y,
      vx: ball.vx,
      vy: ball.vy,
      r: ball.r,
      lastHitSide: ball.lastHitSide,
      boostTimer: ball.boostTimer,
      stunTimer: ball.stunTimer,
      blueResistTimer: ball.blueResistTimer
    };
  }

  function mapPulse(pulse) {
    return {
      mode: pulse.mode,
      waveType: pulse.waveType,
      x: pulse.x,
      y: pulse.y,
      angle: pulse.angle,
      side: pulse.side,
      life: pulse.life,
      maxLife: pulse.maxLife,
      range: pulse.range,
      strength: pulse.strength,
      cone: pulse.cone,
      level: pulse.level,
      arcRadius: pulse.arcRadius
    };
  }

  function mapPowerup(powerup) {
    return {
      id: powerup.id,
      type: powerup.type,
      x: powerup.x,
      y: powerup.y,
      r: powerup.r,
      life: powerup.life,
      owner: powerup.owner || null
    };
  }

  function buildPublicSnapshot(runtime, meta) {
    const state = runtime.state;
    const world = runtime.world;
    const ackSeq = meta && meta.ackSeq ? clone(meta.ackSeq) : {};
    return {
      matchId: meta && meta.matchId ? meta.matchId : null,
      playlistId: meta && meta.playlistId ? meta.playlistId : null,
      serverTick: state.tick,
      ackSeq,
      stateHash: runtime.hashSimulationState(),
      full: !!(meta && meta.full),
      scores: {
        left: state.leftScore,
        right: state.rightScore,
        limit: state.scoreLimit
      },
      paddles: {
        left: mapPaddle(world.paddles.left),
        right: mapPaddle(world.paddles.right)
      },
      balls: world.balls.map(mapBall),
      waves: world.pulses.map(mapPulse),
      powerups: world.powerups.map(mapPowerup),
      timers: {
        roundSeconds: state.roundSeconds,
        countdownActive: state.countdownActive,
        countdownTimer: state.countdownTimer,
        leftBoostTimer: state.leftBoostTimer,
        rightBoostTimer: state.rightBoostTimer,
        slowmoTimer: state.slowmoTimer
      },
      lastActions: clone(meta && meta.lastActions ? meta.lastActions : {}),
      stateBlob: meta && meta.includeStateBlob ? serializeStateBlob(runtime.cloneSimulation()) : null
    };
  }

  function serializeStateBlob(snapshot) {
    return clone(snapshot);
  }

  function deserializeStateBlob(snapshot) {
    return restoreSerializable(snapshot);
  }

  function createAuthoritativeMatchEngine(options) {
    const opts = options || {};
    const playlistId = opts.playlistId || 'unranked_standard';
    const playlist = multiplayer.getPlaylist(playlistId);
    if (!playlist) {
      throw new Error('Unknown multiplayer playlist: ' + playlistId);
    }
    const tickRate = (multiplayer.netcode && multiplayer.netcode.serverTickRate) || simCore.DEFAULT_TICK_RATE || 120;
    const runtime = simCore.createSimulation({
      config: opts.config || config,
      seed: opts.seed,
      tickRate
    });
    const lastActions = {
      left: { moveAxis: 0, fire: false },
      right: { moveAxis: 0, fire: false }
    };
    const ackSeq = {
      left: 0,
      right: 0
    };
    let forcedResult = null;

    function start(matchOptions) {
      const runtimeOptions = multiplayer.buildMatchRuntimeOptions(playlist, matchOptions);
      runtime.startMatch(runtimeOptions);
      return buildPublicSnapshot(runtime, {
        matchId: opts.matchId,
        playlistId,
        full: true,
        includeStateBlob: true,
        ackSeq,
        lastActions
      });
    }

    function queueFrames(side, batch) {
      for (let index = 0; index < batch.frames.length; index += 1) {
        const tick = batch.startTick + index;
        const action = batch.frames[index];
        runtime.queueInput(side, tick, action);
        lastActions[side] = {
          moveAxis: action.moveAxis,
          fire: action.fire
        };
      }
      ackSeq[side] = Math.max(ackSeq[side], batch.seq);
    }

    function getResult() {
      if (forcedResult) return clone(forcedResult);
      if (!runtime.state.gameOver) return null;
      const winnerSide = runtime.state.leftScore > runtime.state.rightScore ? 'left' : 'right';
      return {
        winnerSide,
        reason: 'completed',
        leftScore: runtime.state.leftScore,
        rightScore: runtime.state.rightScore
      };
    }

    return {
      runtime,
      playlistId,
      start,
      step(ticks) {
        runtime.stepSimulation(ticks || 1);
      },
      queueFrames,
      snapshot(includeStateBlob) {
        return buildPublicSnapshot(runtime, {
          matchId: opts.matchId,
          playlistId,
          full: !!includeStateBlob,
          includeStateBlob: !!includeStateBlob,
          ackSeq,
          lastActions
        });
      },
      restore(snapshot) {
        runtime.restoreSimulation(deserializeStateBlob(snapshot));
      },
      flushEvents() {
        return runtime.flushEvents();
      },
      forceForfeit(loserSide, reason) {
        const winnerSide = loserSide === 'left' ? 'right' : 'left';
        forcedResult = {
          winnerSide,
          loserSide,
          reason: reason || 'forfeit',
          leftScore: runtime.state.leftScore,
          rightScore: runtime.state.rightScore
        };
      },
      serializeStateBlob,
      deserializeStateBlob,
      getResult,
      getLastActions() {
        return clone(lastActions);
      },
      getAckSeq() {
        return clone(ackSeq);
      }
    };
  }

  return {
    createAuthoritativeMatchEngine,
    buildPublicSnapshot,
    serializeStateBlob,
    deserializeStateBlob
  };
});
