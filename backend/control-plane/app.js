const http = require('http');
const { parseUrl, sendJson, readJsonBody, getBearerToken } = require('../lib/http.js');
const { attachTinyWebSocketServer } = require('../lib/tiny-ws.js');
const protocol = require('../../shared/protocol/index.js');
const multiplayer = require('../../shared/multiplayer/config.js');
const { createMemoryStore, ensurePlayerConnections, ensureRating, getQueueKey } = require('./store.js');
const { createAuthService } = require('./services/auth-service.js');
const { createQueueService } = require('./services/queue-service.js');
const { createChatService } = require('./services/chat-service.js');
const { updatePlayer } = require('./services/glicko2.js');

function createControlPlaneApp(options = {}) {
  const store = options.store || createMemoryStore(multiplayer);
  const secret = options.secret || 'wave-pong-local-secret';
  const workerManager = options.workerManager;
  const workerUrl = options.workerUrl || 'ws://127.0.0.1:8788/ws/match';
  if (!workerManager) {
    throw new Error('createControlPlaneApp requires a workerManager.');
  }

  function broadcastToPlayer(playerId, type, payload) {
    const connections = ensurePlayerConnections(store, playerId);
    for (const connection of connections) {
      connection.sendJson({ type, payload });
    }
  }

  function broadcastToBucket(bucketKey, type, payload, predicate) {
    for (const [playerId, connections] of store.controlConnections.entries()) {
      for (const connection of connections) {
        if (connection.bucketKey !== bucketKey) continue;
        if (typeof predicate === 'function' && !predicate(playerId)) continue;
        connection.sendJson({ type, payload });
      }
    }
  }

  function broadcastQueuePresence(bucketKey, queueSize) {
    broadcastToBucket(bucketKey, 'presence.update', {
      bucketKey,
      queueSize
    });
  }

  const authService = createAuthService({
    store,
    multiplayer,
    secret
  });
  const queueService = createQueueService({
    store,
    multiplayer,
    workerManager,
    broadcastToPlayer,
    broadcastQueuePresence
  });
  const chatService = createChatService({
    store,
    multiplayer,
    broadcastToBucket
  });

  workerManager.setMatchFinishedHandler((summary) => {
    const playlist = multiplayer.getPlaylist(summary.playlistId);
    const record = store.matches.get(summary.matchId);
    if (record) {
      record.status = 'completed';
      record.result = summary;
    }
    if (!playlist || !playlist.rated || !summary.winnerSide) return;
    const leftPlayer = store.players.get(summary.players.left.playerId);
    const rightPlayer = store.players.get(summary.players.right.playerId);
    if (!leftPlayer || !rightPlayer) return;
    const leftRating = ensureRating(leftPlayer, summary.playlistId, summary.region);
    const rightRating = ensureRating(rightPlayer, summary.playlistId, summary.region);
    const leftScore = summary.winnerSide === 'left' ? 1 : 0;
    const rightScore = summary.winnerSide === 'right' ? 1 : 0;
    leftPlayer.ratings[`${summary.playlistId}:${summary.region}`] = {
      ...leftRating,
      ...updatePlayer(leftRating, rightRating, leftScore),
      matchesPlayed: leftRating.matchesPlayed + 1,
      placementsRemaining: Math.max(0, leftRating.placementsRemaining - 1)
    };
    rightPlayer.ratings[`${summary.playlistId}:${summary.region}`] = {
      ...rightRating,
      ...updatePlayer(rightRating, leftRating, rightScore),
      matchesPlayed: rightRating.matchesPlayed + 1,
      placementsRemaining: Math.max(0, rightRating.placementsRemaining - 1)
    };
  });

  function authenticateRequest(req, body) {
    const token = getBearerToken(req) || (body && body.accessToken) || '';
    if (!token) {
      throw new Error('Missing access token.');
    }
    return authService.authenticateAccess(token);
  }

  async function handleRequest(req, res) {
    const url = parseUrl(req);
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok', service: 'control-plane' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/guest') {
      const body = await readJsonBody(req);
      sendJson(res, 200, authService.createGuest(body));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/upgrade') {
      const body = await readJsonBody(req);
      const player = authenticateRequest(req, body);
      sendJson(res, 200, authService.upgrade(player, body));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/queue/join') {
      const body = await readJsonBody(req);
      const player = authenticateRequest(req, body);
      sendJson(res, 200, {
        queue: queueService.joinQueue(player, body)
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/queue/leave') {
      const body = await readJsonBody(req);
      const player = authenticateRequest(req, body);
      sendJson(res, 200, {
        queue: queueService.leaveQueue(player, body)
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/seasons/current') {
      sendJson(res, 200, {
        season: store.season,
        placementMatches: (multiplayer.seasons || {}).placementMatches || 5,
        seasonLengthWeeks: (multiplayer.seasons || {}).seasonLengthWeeks || 8
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/leaderboard') {
      const playlistId = url.searchParams.get('playlistId') || 'ranked_duel';
      const region = url.searchParams.get('region') || 'na';
      const key = `${playlistId}:${region}`;
      const leaderboard = Array.from(store.players.values())
        .map((player) => ({
          playerId: player.id,
          displayName: player.displayName,
          verified: player.verified,
          ...(player.ratings && player.ratings[key] ? player.ratings[key] : ensureRating(player, playlistId, region))
        }))
        .sort((left, right) => right.rating - left.rating)
        .slice(0, 50);
      sendJson(res, 200, { playlistId, region, leaderboard });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/chat/report') {
      const body = await readJsonBody(req);
      const player = authenticateRequest(req, body);
      store.reports.push({
        type: 'chat',
        reporterId: player.id,
        createdAt: new Date().toISOString(),
        ...body
      });
      sendJson(res, 202, { accepted: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/relationships/mute') {
      const body = await readJsonBody(req);
      const player = authenticateRequest(req, body);
      if (!body.targetPlayerId) {
        throw new Error('Missing targetPlayerId.');
      }
      player.mutedPlayerIds.add(body.targetPlayerId);
      sendJson(res, 200, { muted: true, targetPlayerId: body.targetPlayerId });
      return;
    }

    if (req.method === 'POST' && /^\/matches\/[^/]+\/reconnect$/.test(url.pathname)) {
      const body = await readJsonBody(req);
      const player = authenticateRequest(req, body);
      const matchId = url.pathname.split('/')[2];
      const ticket = workerManager.issueReconnectTicket(matchId, player.id);
      sendJson(res, 200, {
        matchId,
        workerUrl,
        ticket
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      sendJson(res, 400, {
        error: error.message || 'Request failed.'
      });
    });
  });

  attachTinyWebSocketServer(server, {
    [protocol.WS_PATHS.control]: (connection) => {
      let player = null;

      connection.on('message', (raw) => {
        try {
          const message = protocol.parseMessage(raw);
          if (message.type === 'hello' || message.type === 'resume') {
            player = authService.authenticateAccess(message.payload.accessToken);
            ensurePlayerConnections(store, player.id).add(connection);
            connection.playerId = player.id;
            connection.sendJson({
              type: 'hello.ok',
              payload: {
                player: authService.serializePlayer(player),
                regions: multiplayer.listRegions(),
                playlists: multiplayer.listPlaylists(),
                season: store.season
              }
            });
            return;
          }
          if (!player) {
            throw new Error('Control socket is not authenticated.');
          }
          if (message.type === 'queue.join') {
            const queueState = queueService.joinQueue(player, message.payload);
            connection.bucketKey = getQueueKey(message.payload.playlistId, message.payload.region);
            connection.sendJson({ type: 'queue.state', payload: queueState });
            return;
          }
          if (message.type === 'queue.leave') {
            const queueState = queueService.leaveQueue(player, message.payload);
            connection.bucketKey = null;
            connection.sendJson({ type: 'queue.state', payload: queueState });
            return;
          }
          if (message.type === 'chat.send') {
            const entry = chatService.sendLobbyMessage(player, message.payload);
            connection.sendJson({ type: 'chat.message', payload: entry });
            return;
          }
          if (message.type === 'chat.report') {
            store.reports.push({
              type: 'chat',
              reporterId: player.id,
              createdAt: new Date().toISOString(),
              ...message.payload
            });
            connection.sendJson({ type: 'chat.moderation', payload: { accepted: true } });
            return;
          }
          if (message.type === 'ping') {
            connection.sendJson({ type: 'presence.update', payload: { now: Date.now() } });
            return;
          }
          throw new Error('Unsupported control message type: ' + message.type);
        } catch (error) {
          connection.sendJson({
            type: 'error',
            payload: protocol.createError('control_error', error.message || 'Control message failed.')
          });
        }
      });

      connection.on('close', () => {
        if (!player) return;
        const connections = ensurePlayerConnections(store, player.id);
        connections.delete(connection);
      });
    }
  });

  return {
    server,
    store
  };
}

module.exports = {
  createControlPlaneApp
};
