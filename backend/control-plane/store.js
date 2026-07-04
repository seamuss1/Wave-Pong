function createSeason(multiplayer) {
  const seasonLengthWeeks = (((multiplayer || {}).seasons || {}).seasonLengthWeeks) || 8;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + seasonLengthWeeks * 7 * 24 * 60 * 60 * 1000);
  return {
    id: `${start.getUTCFullYear()}-s${Math.max(1, Math.ceil((start.getUTCMonth() + 1) / 2))}`,
    startsAt: start.toISOString(),
    endsAt: end.toISOString()
  };
}

function createMemoryStore(multiplayer) {
  return {
    season: createSeason(multiplayer),
    players: new Map(),
    refreshTokens: new Map(),
    queueBuckets: new Map(),
    controlConnections: new Map(),
    matches: new Map(),
    reports: [],
    sanctions: new Map()
  };
}

function getQueueKey(playlistId, region) {
  return `${playlistId}:${region}`;
}

function ensureQueueBucket(store, playlistId, region) {
  const key = getQueueKey(playlistId, region);
  if (!store.queueBuckets.has(key)) {
    store.queueBuckets.set(key, []);
  }
  return {
    key,
    entries: store.queueBuckets.get(key)
  };
}

function ensurePlayerConnections(store, playerId) {
  if (!store.controlConnections.has(playerId)) {
    store.controlConnections.set(playerId, new Set());
  }
  return store.controlConnections.get(playerId);
}

function ensureRating(player, playlistId, region) {
  if (!player.ratings) player.ratings = {};
  const key = `${playlistId}:${region}`;
  if (!player.ratings[key]) {
    player.ratings[key] = {
      rating: 1500,
      rd: 350,
      volatility: 0.06,
      matchesPlayed: 0,
      placementsRemaining: 5
    };
  }
  return player.ratings[key];
}

module.exports = {
  createMemoryStore,
  getQueueKey,
  ensureQueueBucket,
  ensurePlayerConnections,
  ensureRating
};
