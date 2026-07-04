const protocol = require('../../shared/protocol/index.js');
const multiplayer = require('../../shared/multiplayer/config.js');
const engineApi = require('../../shared/sim/engine.js');

class AuthoritativeMatch {
  constructor(options) {
    this.id = options.matchId;
    this.playlistId = options.playlistId;
    this.region = options.region;
    this.players = {
      left: options.players.find((player) => player.side === 'left'),
      right: options.players.find((player) => player.side === 'right')
    };
    this.playlist = multiplayer.getPlaylist(this.playlistId);
    this.connections = new Map();
    this.accepted = new Set();
    this.disconnectedAt = new Map();
    this.matchChatHistory = [];
    this.engine = engineApi.createAuthoritativeMatchEngine({
      matchId: this.id,
      playlistId: this.playlistId,
      region: this.region,
      seed: options.seed
    });
    this.started = false;
    this.finished = false;
    this.currentSnapshot = null;
    this.loopHandle = null;
    this.onFinished = typeof options.onFinished === 'function' ? options.onFinished : null;
    this.snapshotIntervalTicks = Math.max(1, Math.round(((multiplayer.netcode || {}).serverTickRate || 120) / ((multiplayer.netcode || {}).snapshotRateHz || 24)));
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
        playlistId: this.playlistId,
        region: this.region
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
          region: this.region,
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
      this.broadcast('match.start', {
        matchId: this.id,
        playlistId: this.playlistId,
        region: this.region,
        snapshot,
        tickRate: (multiplayer.netcode || {}).serverTickRate || 120
      });
      this.loopHandle = setInterval(() => this.step(), 1000 / (((multiplayer.netcode || {}).serverTickRate) || 120));
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

  receiveChat(playerId, payload) {
    const player = this.getPlayerById(playerId);
    if (!player) throw new Error('Unknown match player.');
    const validation = protocol.validateChatPayload(payload, {
      maxLength: ((multiplayer.moderation || {}).matchMessageMaxLength) || 140
    });
    if (!validation.ok) throw new Error(validation.error);
    const entry = {
      matchId: this.id,
      playerId,
      displayName: player.displayName,
      createdAt: new Date().toISOString(),
      ...validation.value
    };
    if (this.playlist && this.playlist.matchChatMode === 'quick' && entry.kind !== 'quick') {
      throw new Error('This match only allows quick chat.');
    }
    this.matchChatHistory.push(entry);
    this.broadcast('chat.message', entry);
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
    for (const connection of this.connections.values()) {
      connection.sendJson({ type, payload });
    }
  }

  step() {
    if (!this.started || this.finished) return;
    this.engine.step(1);
    const snapshot = this.engine.snapshot(false);
    this.currentSnapshot = snapshot;
    if (snapshot.serverTick % this.snapshotIntervalTicks === 0) {
      this.broadcast('match.snapshot', snapshot);
    }
    const events = this.engine.flushEvents();
    for (const event of events) {
      this.broadcast('match.event', {
        matchId: this.id,
        ...event
      });
    }
    this.applyDisconnectRules();
    const result = this.engine.getResult();
    if (result) {
      this.finish(result);
    }
  }

  applyDisconnectRules() {
    const reconnect = multiplayer.reconnect || {};
    const rated = !!(this.playlist && this.playlist.rated);
    const timeoutMs = ((rated ? reconnect.rankedForfeitSeconds : reconnect.graceSeconds) || 15) * 1000;
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
      region: this.region,
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
