const http = require('http');
const path = require('path');
const { parseUrl, sendJson, sendEmpty, readJsonBody, getBearerToken } = require('../lib/http.js');
const { attachTinyWebSocketServer } = require('../lib/tiny-ws.js');
const { createRuntimeStaticHandler } = require('../lib/static-runtime.js');
const protocol = require('../../shared/protocol/index.js');
const multiplayer = require('../../shared/multiplayer/config.js');
const { createMemoryStore, ensurePlayerConnections } = require('./store.js');
const { authError } = require('../lib/tokens.js');
const { createAuthService } = require('./services/auth-service.js');
const { createQueueService } = require('./services/queue-service.js');

// The browser client may be served from anywhere (this server, file://, itch.io),
// so the JSON API answers cross-origin requests permissively.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};

function createControlPlaneApp(options = {}) {
  const store = options.store || createMemoryStore();
  const secret = options.secret || 'wave-pong-local-secret';
  const workerManager = options.workerManager;
  const workerUrl = options.workerUrl || 'ws://127.0.0.1:8788/ws/match';
  const publicWorkerUrl = options.publicWorkerUrl || workerUrl;
  // Optional metrics collector (see lib/metrics.js). Absent in unit tests, so
  // every call site guards on it.
  const metrics = options.metrics || null;
  const metricsToken = options.metricsToken || '';
  if (!workerManager) {
    throw new Error('createControlPlaneApp requires a workerManager.');
  }
  const staticHandler = options.serveRuntime === false ? null : createRuntimeStaticHandler({
    runtimeDir: options.runtimeDir || path.join(__dirname, '../../runtime'),
    publicRuntimeEnv: options.publicRuntimeEnv || {}
  });

  function broadcastToPlayer(playerId, type, payload) {
    const connections = ensurePlayerConnections(store, playerId);
    for (const connection of connections) {
      connection.sendJson({ type, payload });
    }
  }

  const authService = createAuthService({
    store,
    multiplayer,
    secret
  });
  const queueService = createQueueService({
    store,
    workerManager,
    broadcastToPlayer,
    publicWorkerUrl,
    metrics
  });

  workerManager.setMatchFinishedHandler((summary) => {
    const record = store.matches.get(summary.matchId);
    if (record) {
      record.status = 'completed';
      record.result = summary;
    }
    if (metrics) metrics.recordMatchFinished(summary);
  });

  function authenticateRequest(req, body) {
    const token = getBearerToken(req) || (body && body.accessToken) || '';
    if (!token) {
      throw authError('Missing access token.');
    }
    return authService.authenticateAccess(token);
  }

  async function handleRequest(req, res) {
    const url = parseUrl(req);
    if (req.method === 'OPTIONS') {
      sendEmpty(res, 204, CORS_HEADERS);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok', service: 'control-plane' }, CORS_HEADERS);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/metrics') {
      if (!metrics || !metrics.enabled) {
        sendJson(res, 404, { error: 'Metrics are disabled.' }, CORS_HEADERS);
        return;
      }
      if (metricsToken) {
        const provided = getBearerToken(req) || url.searchParams.get('token') || '';
        if (provided !== metricsToken) {
          sendJson(res, 401, { error: 'Unauthorized.' }, CORS_HEADERS);
          return;
        }
      }
      sendJson(res, 200, metrics.snapshot(), CORS_HEADERS);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/auth/guest') {
      const body = await readJsonBody(req);
      const session = authService.createGuest(body);
      if (metrics) metrics.recordGuestCreated();
      sendJson(res, 200, session, CORS_HEADERS);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/queue/join') {
      const body = await readJsonBody(req);
      const player = authenticateRequest(req, body);
      sendJson(res, 200, {
        queue: queueService.joinQueue(player)
      }, CORS_HEADERS);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/queue/leave') {
      const body = await readJsonBody(req);
      const player = authenticateRequest(req, body);
      sendJson(res, 200, {
        queue: queueService.leaveQueue(player)
      }, CORS_HEADERS);
      return;
    }

    if (req.method === 'POST' && /^\/matches\/[^/]+\/reconnect$/.test(url.pathname)) {
      const body = await readJsonBody(req);
      const player = authenticateRequest(req, body);
      const matchId = url.pathname.split('/')[2];
      const ticket = workerManager.issueReconnectTicket(matchId, player.id);
      sendJson(res, 200, {
        matchId,
        workerUrl: publicWorkerUrl,
        ticket
      }, CORS_HEADERS);
      return;
    }

    if (staticHandler && staticHandler(req, res, url.pathname)) {
      return;
    }

    sendJson(res, 404, { error: 'Not found.' }, CORS_HEADERS);
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      const status = error.code === 'auth_error' ? 401 : 400;
      sendJson(res, status, {
        error: error.message || 'Request failed.',
        code: error.code || undefined
      }, CORS_HEADERS);
    });
  });

  const wsHandlers = {
    [protocol.WS_PATHS.control]: (connection) => {
      let player = null;

      connection.on('message', (raw) => {
        try {
          const message = protocol.parseMessage(raw);
          if (message.type === 'hello' || message.type === 'resume') {
            player = authService.authenticateAccess(message.payload.accessToken);
            ensurePlayerConnections(store, player.id).add(connection);
            connection.playerId = player.id;
            // Count each authenticated control socket once for the live-players
            // gauge, even if the client re-sends hello/resume on the same socket.
            if (metrics && !connection._metricsCounted) {
              connection._metricsCounted = true;
              metrics.recordControlConnected();
            }
            connection.sendJson({
              type: 'hello.ok',
              payload: {
                player: authService.serializePlayer(player)
              }
            });
            return;
          }
          if (!player) {
            throw new Error('Control socket is not authenticated.');
          }
          if (message.type === 'queue.join') {
            connection.sendJson({ type: 'queue.state', payload: queueService.joinQueue(player) });
            return;
          }
          if (message.type === 'queue.leave') {
            connection.sendJson({ type: 'queue.state', payload: queueService.leaveQueue(player) });
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
            payload: protocol.createError(error.code || 'control_error', error.message || 'Control message failed.')
          });
        }
      });

      connection.on('close', () => {
        if (metrics && connection._metricsCounted) {
          connection._metricsCounted = false;
          metrics.recordControlDisconnected();
        }
        if (!player) return;
        const connections = ensurePlayerConnections(store, player.id);
        connections.delete(connection);
        // A player with no remaining control connections cannot receive match.found;
        // drop them from the queue instead of matching them into a dead game.
        if (!connections.size) {
          store.queue = store.queue.filter((entry) => entry.playerId !== player.id);
        }
      });
    }
  };
  // Single-port deployments mount the match-worker socket here too, so one origin
  // (and one Cloudflare hostname) serves the client, control, and match sockets.
  Object.assign(wsHandlers, options.extraWsHandlers || {});
  attachTinyWebSocketServer(server, wsHandlers);

  return {
    server,
    store
  };
}

module.exports = {
  createControlPlaneApp
};
