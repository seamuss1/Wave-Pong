const protocol = require('../../shared/protocol/index.js');
const multiplayer = require('../../shared/multiplayer/config.js');
const engineApi = require('../../shared/sim/engine.js');

class AuthoritativeMatch {
  constructor(options) {
    this.id = options.matchId;
    this.playlistId = options.playlistId;
    this.players = {
      left: options.players.find((player) => player.side === 'left'),
      right: options.players.find((player) => player.side === 'right')
    };
    this.connections = new Map();
    this.accepted = new Set();
    this.disconnectedAt = new Map();
    this.engine = engineApi.createAuthoritativeMatchEngine({
      matchId: this.id,
      playlistId: this.playlistId,
      seed: options.seed
    });
    this.started = false;
    this.finished = false;
    this.currentSnapshot = null;
    this.loopHandle = null;
    this.onFinished = typeof options.onFinished === 'function' ? options.onFinished : null;
    this.tickRate = (multiplayer.netcode || {}).serverTickRate || 120;
    this.snapshotIntervalTicks = Math.max(1, Math.round(this.tickRate / ((multiplayer.netcode || {}).snapshotRateHz || 24)));
    this.simStartMs = 0;
  }

  getPlayerById(playerId) {
    if (this.players.left && this.players.left.id === playerId) return this.players.left;
    if (this.players.right && this.players.right.id === playerId) return this.players.right;
    return null;
  }

  attachConnection(playerId, connection) {
    const player = this.getPlayerById(playerId);
    if (!player) {
      throw new Error('Player does not belong to this match.');
    }
    this.connections.set(playerId, connection);
    this.disconnectedAt.delete(playerId);
    connection.sendJson({
      type: 'hello.ok',
      payload: {
        scope: 'match',
        matchId: this.id,
        playerId,
        side: player.side,
        playlistId: this.playlistId
      }
    });
    if (this.started && this.currentSnapshot) {
      connection.sendJson({
        type: 'match.correction',
        payload: this.currentSnapshot
      });
    } else {
      connection.sendJson({
        type: 'match.ready',
        payload: {
          matchId: this.id,
          playlistId: this.playlistId,
          players: {
            left: this.players.left && { playerId: this.players.left.id, displayName: this.players.left.displayName },
            right: this.players.right && { playerId: this.players.right.id, displayName: this.players.right.displayName }
          }
        }
      });
    }
  }

  handleAccept(playerId) {
    this.accepted.add(playerId);
    if (!this.started && this.accepted.size === 2) {
      const snapshot = this.engine.start({
        skipCountdown: true,
        leftName: this.players.left.displayName,
        rightName: this.players.right.displayName
      });
      this.currentSnapshot = snapshot;
      this.started = true;
      this.simStartMs = Date.now();
      this.broadcast('match.start', {
        matchId: this.id,
        playlistId: this.playlistId,
        snapshot,
        tickRate: this.tickRate
      });
      // Step from wall-clock elapsed time instead of one-tick-per-callback:
      // Node timers fire late, and a naive 8.3ms interval runs the sim 10-30%
      // slower than real time, which reads as permanent lag on both clients.
      this.loopHandle = setInterval(() => this.pump(), 1000 / this.tickRate);
    }
  }

  receiveInputBatch(playerId, payload) {
    const player = this.getPlayerById(playerId);
    if (!player) throw new Error('Unknown match player.');
    const validation = protocol.validateInputBatch(payload, {
      maxFrames: ((multiplayer.netcode || {}).maxInputBatchFrames) || 12
    });
    if (!validation.ok) throw new Error(validation.error);
    this.engine.queueFrames(player.side, validation.value);
  }

  handleDisconnect(playerId) {
    this.connections.delete(playerId);
    this.disconnectedAt.set(playerId, Date.now());
  }

  issuePresenceUpdate() {
    this.broadcast('presence.update', {
      matchId: this.id,
      connectedPlayerIds: Array.from(this.connections.keys())
    });
  }

  broadcast(type, payload) {
    // Serialize once per message instead of once per connection; snapshots are
    // the largest payloads this server produces.
    const text = JSON.stringify({ type, payload });
    for (const connection of this.connections.values()) {
      if (typeof connection.sendText === 'function') {
        connection.sendText(text);
      } else {
        connection.sendJson({ type, payload });
      }
    }
  }

  pump() {
    if (!this.started || this.finished) return;
    const targetTick = Math.floor(((Date.now() - this.simStartMs) / 1000) * this.tickRate);
    let due = targetTick - this.engine.runtime.state.tick;
    if (due <= 0) return;
    const maxCatchUpTicks = this.tickRate; // one second of simulation
    if (due > maxCatchUpTicks) {
      // Long stall (event-loop pause, host suspend): resync the clock instead
      // of freezing the process on a huge burst.
      this.simStartMs = Date.now() - ((this.engine.runtime.state.tick + maxCatchUpTicks) / this.tickRate) * 1000;
      due = maxCatchUpTicks;
    }
    let snapshotDue = false;
    for (let i = 0; i < due; i += 1) {
      this.engine.step(1);
      if (this.engine.runtime.state.tick % this.snapshotIntervalTicks === 0) {
        snapshotDue = true;
      }
    }
    if (snapshotDue) {
      // Full snapshots (with state blob) are what clients restore from; thin
      // snapshots would be ignored by the client reconciliation path.
      const snapshot = this.engine.snapshot(true);
      this.currentSnapshot = snapshot;
      this.broadcast('match.snapshot', snapshot);
    }
    // Drain the runtime event queue so it cannot grow, but do not broadcast it:
    // clients ignore match.event, and forwarding per-tick tone/status events
    // multiplied websocket traffic for nothing.
    this.engine.flushEvents();
    this.applyDisconnectRules();
    const result = this.engine.getResult();
    if (result) {
      this.finish(result);
    }
  }

  applyDisconnectRules() {
    const reconnect = multiplayer.reconnect || {};
    const timeoutMs = (reconnect.graceSeconds || 30) * 1000;
    for (const [playerId, disconnectedAt] of this.disconnectedAt.entries()) {
      if (Date.now() - disconnectedAt < timeoutMs) continue;
      const player = this.getPlayerById(playerId);
      if (!player) continue;
      this.engine.forceForfeit(player.side, 'disconnect_forfeit');
      break;
    }
  }

  finish(result) {
    if (this.finished) return;
    this.finished = true;
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
    }
    const summary = {
      matchId: this.id,
      playlistId: this.playlistId,
      winnerSide: result.winnerSide || null,
      reason: result.reason || 'completed',
      leftScore: result.leftScore,
      rightScore: result.rightScore,
      players: {
        left: { playerId: this.players.left.id, displayName: this.players.left.displayName },
        right: { playerId: this.players.right.id, displayName: this.players.right.displayName }
      }
    };
    this.broadcast('match.result', summary);
    if (this.onFinished) {
      this.onFinished(summary);
    }
  }
}

module.exports = {
  AuthoritativeMatch
};
