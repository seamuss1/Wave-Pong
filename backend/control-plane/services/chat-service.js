const protocol = require('../../../shared/protocol/index.js');
const { getQueueKey } = require('../store.js');

function withinRateLimit(history, now, burst, windowSeconds) {
  const cutoff = now - windowSeconds * 1000;
  while (history.length && history[0] < cutoff) {
    history.shift();
  }
  if (history.length >= burst) return false;
  history.push(now);
  return true;
}

function createChatService(options) {
  const { store, multiplayer, broadcastToBucket } = options;
  const moderation = multiplayer.moderation || {};

  return {
    sendLobbyMessage(player, payload) {
      const bucketKey = getQueueKey(payload.playlistId, payload.region);
      const validation = protocol.validateChatPayload(payload.message, {
        maxLength: moderation.lobbyMessageMaxLength
      });
      if (!validation.ok) throw new Error(validation.error);
      const message = validation.value;
      if (message.kind === 'free' && !player.verified) {
        throw new Error('Free-text lobby chat requires a verified account.');
      }
      const history = message.kind === 'quick'
        ? player.moderationHistory.quickChatMessages
        : player.moderationHistory.lobbyMessages;
      const burst = message.kind === 'quick' ? moderation.quickChatRateLimitBurst : moderation.lobbyRateLimitBurst;
      const windowSeconds = message.kind === 'quick' ? moderation.quickChatRateLimitWindowSeconds : moderation.lobbyRateLimitWindowSeconds;
      if (!withinRateLimit(history, Date.now(), burst || 4, windowSeconds || 8)) {
        throw new Error('Chat rate limit exceeded.');
      }

      const entry = {
        id: `chat_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        bucketKey,
        playerId: player.id,
        displayName: player.displayName,
        verified: player.verified,
        createdAt: new Date().toISOString(),
        ...message
      };
      broadcastToBucket(bucketKey, 'chat.message', entry, (targetPlayerId) => {
        const target = store.players.get(targetPlayerId);
        return !target || !target.mutedPlayerIds || !target.mutedPlayerIds.has(player.id);
      });
      return entry;
    }
  };
}

module.exports = {
  createChatService
};
