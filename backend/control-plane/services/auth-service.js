const crypto = require('crypto');
const { issueScopedToken, verifySignedPayload } = require('../../lib/tokens.js');
const { ensureRating } = require('../store.js');

function sanitizeDisplayName(value, fallbackPrefix) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const safe = trimmed.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 20);
  if (safe) return safe;
  return `${fallbackPrefix}${Math.floor(Math.random() * 9000 + 1000)}`;
}

function serializePlayer(player) {
  return {
    id: player.id,
    displayName: player.displayName,
    guest: !!player.guest,
    verified: !!player.verified,
    createdAt: player.createdAt,
    ratings: player.ratings || {},
    sanctions: player.sanctions || {}
  };
}

function createAuthService(options) {
  const { store, multiplayer, secret } = options;
  const authConfig = multiplayer.auth || {};

  function issueSession(player) {
    const accessToken = issueScopedToken(secret, { type: 'access', playerId: player.id }, authConfig.accessTokenTtlSeconds || 1200);
    const refreshToken = issueScopedToken(secret, { type: 'refresh', playerId: player.id, refreshId: crypto.randomUUID() }, authConfig.refreshTokenTtlSeconds || 2592000);
    store.refreshTokens.set(refreshToken, {
      playerId: player.id,
      createdAt: Date.now()
    });
    return {
      accessToken,
      refreshToken,
      player: serializePlayer(player)
    };
  }

  return {
    createGuest(payload) {
      const playerId = crypto.randomUUID();
      const displayName = sanitizeDisplayName(payload && payload.displayName, authConfig.guestDisplayNamePrefix || 'Guest');
      const player = {
        id: playerId,
        displayName,
        guest: true,
        verified: false,
        createdAt: new Date().toISOString(),
        ratings: {},
        mutedPlayerIds: new Set(),
        blockedPlayerIds: new Set(),
        moderationHistory: {
          lobbyMessages: [],
          quickChatMessages: []
        },
        sanctions: {}
      };
      store.players.set(playerId, player);
      for (const playlist of options.multiplayer.listPlaylists()) {
        for (const region of options.multiplayer.listRegions()) {
          ensureRating(player, playlist.id, region.id).placementsRemaining = (((options.multiplayer.seasons || {}).placementMatches) || 5);
        }
      }
      return issueSession(player);
    },
    upgrade(player, payload) {
      player.guest = false;
      player.verified = true;
      if (payload && payload.displayName) {
        player.displayName = sanitizeDisplayName(payload.displayName, 'Player');
      }
      player.verificationMethod = (payload && payload.method) || 'local-dev';
      return issueSession(player);
    },
    authenticateAccess(token) {
      const payload = verifySignedPayload(token, secret);
      if (payload.type !== 'access') {
        throw new Error('Expected an access token.');
      }
      const player = store.players.get(payload.playerId);
      if (!player) {
        throw new Error('Unknown player.');
      }
      return player;
    },
    serializePlayer
  };
}

module.exports = {
  createAuthService
};
