function createMemoryStore() {
  return {
    players: new Map(),
    refreshTokens: new Map(),
    // Single quick-play queue: array of { playerId, queuedAt }.
    queue: [],
    controlConnections: new Map(),
    matches: new Map()
  };
}

function ensurePlayerConnections(store, playerId) {
  if (!store.controlConnections.has(playerId)) {
    store.controlConnections.set(playerId, new Set());
  }
  return store.controlConnections.get(playerId);
}

module.exports = {
  createMemoryStore,
  ensurePlayerConnections
};
