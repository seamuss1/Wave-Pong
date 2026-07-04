(function (root, factory) {
  const config = (typeof module === 'object' && module.exports)
    ? require('../config.js')
    : (root && root.WavePong && root.WavePong.CONFIG);
  const api = factory(config);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WavePong = root.WavePong || {};
    root.WavePong.Multiplayer = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (config) {
  const multiplayer = (config && config.multiplayer) || {};
  const playlists = multiplayer.playlists || {};
  const netcode = multiplayer.netcode || {};
  const reconnect = multiplayer.reconnect || {};
  const auth = multiplayer.auth || {};

  function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);
    const next = {};
    for (const key of Object.keys(value)) {
      next[key] = clone(value[key]);
    }
    return next;
  }

  function listPlaylists() {
    return Object.keys(playlists).map((key) => clone(playlists[key]));
  }

  function getPlaylist(playlistId) {
    return clone(playlists[playlistId]) || null;
  }

  function getDefaultPlaylist() {
    return getPlaylist('quick_play') || listPlaylists()[0] || null;
  }

  function buildMatchRuntimeOptions(playlistId, overrides) {
    const playlist = typeof playlistId === 'string' ? getPlaylist(playlistId) : clone(playlistId);
    if (!playlist) {
      throw new Error('Unknown multiplayer playlist: ' + playlistId);
    }
    const mergedOverrides = overrides || {};
    return {
      mode: playlist.mode || 'pvp',
      scoreLimit: playlist.scoreLimit,
      powerupsEnabled: !!playlist.powerupsEnabled,
      longRallyMultiballEnabled: playlist.longRallyMultiballEnabled !== false,
      trailsEnabled: playlist.trailsEnabled !== false,
      theme: playlist.theme || (config && config.defaults && config.defaults.theme) || 'neon',
      skipCountdown: !!mergedOverrides.skipCountdown,
      leftName: mergedOverrides.leftName || 'PLAYER 1',
      rightName: mergedOverrides.rightName || 'PLAYER 2',
      modeLabel: mergedOverrides.modeLabel || playlist.modeLabel || 'ONLINE',
      opponentLabel: mergedOverrides.opponentLabel || playlist.label || 'Online',
      liveInputEnabled: mergedOverrides.liveInputEnabled !== false,
      // Online matches never run a local CPU controller (a stale menu-selected bot
      // in a controller slot silently eats one player's input) and never record a
      // replay (the log grows unboundedly and bloats authoritative snapshots).
      leftController: null,
      rightController: null,
      replayEnabled: mergedOverrides.replayEnabled === true
    };
  }

  return {
    auth: clone(auth),
    reconnect: clone(reconnect),
    netcode: clone(netcode),
    listPlaylists,
    getPlaylist,
    getDefaultPlaylist,
    buildMatchRuntimeOptions
  };
});
