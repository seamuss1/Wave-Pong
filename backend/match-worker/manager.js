const crypto = require('crypto');
const { issueScopedToken, verifySignedPayload, authError } = require('../lib/tokens.js');
const { AuthoritativeMatch } = require('./authoritative-match.js');

function createMatchWorkerManager(options = {}) {
  const secret = options.secret || 'wave-pong-local-secret';
  const workerUrl = options.workerUrl || 'ws://127.0.0.1:8788/ws/match';
  const matches = new Map();
  let matchFinishedHandler = null;
  // Finished matches linger briefly so late result/reconnect traffic still
  // resolves, then get dropped. Without this every match leaked its engine
  // (and ever-growing sim state) for the life of the process.
  const finishedRetentionMs = Number(options.finishedRetentionMs) || 60 * 1000;
  // Matches where both players never accepted are abandoned after this long.
  const acceptTimeoutMs = Number(options.acceptTimeoutMs) || 60 * 1000;

  function scheduleDelete(matchId, delayMs) {
    const timer = setTimeout(() => matches.delete(matchId), delayMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  return {
    createMatch(payload) {
      const matchId = crypto.randomUUID();
      const match = new AuthoritativeMatch({
        matchId,
        playlistId: payload.playlistId,
        players: payload.players,
        seed: Math.floor(Math.random() * 0xffffffff),
        onFinished(summary) {
          if (matchFinishedHandler) {
            matchFinishedHandler(summary);
          }
          scheduleDelete(matchId, finishedRetentionMs);
        }
      });
      matches.set(matchId, match);
      const acceptTimer = setTimeout(() => {
        const pending = matches.get(matchId);
        if (pending && !pending.started && !pending.finished) {
          pending.finish({
            winnerSide: null,
            reason: 'abandoned',
            leftScore: 0,
            rightScore: 0
          });
        }
      }, acceptTimeoutMs);
      if (typeof acceptTimer.unref === 'function') acceptTimer.unref();
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
        throw authError('Expected a match ticket.');
      }
      const match = matches.get(payload.matchId);
      if (!match) {
        // Ticket is signature-valid but the match it names is gone (finished,
        // abandoned, or the worker restarted) - same class of failure as an
        // unknown player, so tag it the same way.
        throw authError('Unknown match.');
      }
      return {
        match,
        playerId: payload.playerId
      };
    },
    issueReconnectTicket(matchId, playerId) {
      if (!matches.has(matchId)) {
        throw authError('Unknown match.');
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
