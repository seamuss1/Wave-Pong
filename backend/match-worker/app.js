const http = require('http');
const { sendJson } = require('../lib/http.js');
const { attachTinyWebSocketServer } = require('../lib/tiny-ws.js');
const protocol = require('../../shared/protocol/index.js');

function createMatchWorkerApp(options = {}) {
  const manager = options.manager;
  if (!manager) {
    throw new Error('createMatchWorkerApp requires a manager.');
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { status: 'ok', service: 'match-worker' });
      return;
    }
    sendJson(res, 404, { error: 'Not found.' });
  });

  attachTinyWebSocketServer(server, {
    [protocol.WS_PATHS.match]: (connection) => {
      let match = null;
      let playerId = null;

      connection.on('message', (raw) => {
        try {
          const message = protocol.parseMessage(raw);
          if (message.type === 'hello' || message.type === 'resume' || message.type === 'match.reconnect') {
            const verified = manager.verifyMatchTicket(message.payload.ticket);
            match = verified.match;
            playerId = verified.playerId;
            connection.playerId = playerId;
            connection.matchId = match.id;
            match.attachConnection(playerId, connection);
            match.issuePresenceUpdate();
            return;
          }
          if (!match || !playerId) {
            throw new Error('Match socket is not authenticated.');
          }
          if (message.type === 'match.accept') {
            match.handleAccept(playerId);
            return;
          }
          if (message.type === 'match.input_batch') {
            match.receiveInputBatch(playerId, message.payload);
            return;
          }
          if (message.type === 'chat.send') {
            match.receiveChat(playerId, message.payload);
            return;
          }
          if (message.type === 'ping') {
            connection.sendJson({ type: 'presence.update', payload: { now: Date.now() } });
            return;
          }
          throw new Error('Unsupported match message type: ' + message.type);
        } catch (error) {
          connection.sendJson({
            type: 'error',
            payload: protocol.createError('match_error', error.message || 'Match message failed.')
          });
        }
      });

      connection.on('close', () => {
        if (match && playerId) {
          match.handleDisconnect(playerId);
          match.issuePresenceUpdate();
        }
      });
    }
  });

  return {
    server
  };
}

module.exports = {
  createMatchWorkerApp
};
