const crypto = require('crypto');
const { issueScopedToken, verifySignedPayload } = require('../lib/tokens.js');
const { AuthoritativeMatch } = require('./authoritative-match.js');

function createMatchWorkerManager(options = {}) {
  const secret = options.secret || 'wave-pong-local-secret';
  const workerUrl = options.workerUrl || 'ws://127.0.0.1:8788/ws/match';
  const matches = new Map();
  let matchFinishedHandler = null;

  return {
    createMatch(payload) {
      const matchId = crypto.randomUUID();
      const match = new AuthoritativeMatch({
        matchId,
        playlistId: payload.playlistId,
        region: payload.region,
        players: payload.players,
        seed: Math.floor(Math.random() * 0xffffffff),
        onFinished(summary) {
          if (matchFinishedHandler) {
            matchFinishedHandler(summary);
          }
        }
      });
      matches.set(matchId, match);
      return {
        matchId,
        workerUrl,
        tickets: {
          left: issueScopedToken(secret, { type: 'match', matchId, playerId: payload.players[0].id }, 60 * 5),
          right: issueScopedToken(secret, { type: 'match', matchId, playerId: payload.players[1].id }, 60 * 5)
        }
      };
    },
    verifyMatchTicket(ticket) {
      const payload = verifySignedPayload(ticket, secret);
      if (payload.type !== 'match') {
        throw new Error('Expected a match ticket.');
      }
      const match = matches.get(payload.matchId);
      if (!match) {
        throw new Error('Unknown match.');
      }
      return {
        match,
        playerId: payload.playerId
      };
    },
    issueReconnectTicket(matchId, playerId) {
      if (!matches.has(matchId)) {
        throw new Error('Unknown match.');
      }
      return issueScopedToken(secret, { type: 'match', matchId, playerId }, 60 * 5);
    },
    setMatchFinishedHandler(handler) {
      matchFinishedHandler = handler;
    }
  };
}

module.exports = {
  createMatchWorkerManager
};
