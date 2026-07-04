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
  const regions = multiplayer.regions || {};
  const playlists = multiplayer.playlists || {};
  const seasons = multiplayer.seasons || {};
  const netcode = multiplayer.netcode || {};
  const moderation = multiplayer.moderation || {};
  const reconnect = multiplayer.reconnect || {};
  const auth = multiplayer.auth || {};
  const antiCheat = multiplayer.antiCheat || {};
  const quickChat = Array.isArray(multiplayer.quickChat) ? multiplayer.quickChat.slice() : [];

  function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);
    const next = {};
    for (const key of Object.keys(value)) {
      next[key] = clone(value[key]);
    }
    return next;
  }

  function listRegions() {
    return Object.keys(regions).map((key) => clone(regions[key]));
  }

  function listPlaylists() {
    return Object.keys(playlists).map((key) => clone(playlists[key]));
  }

  function getRegion(regionId) {
    return clone(regions[regionId]) || null;
  }

  function getPlaylist(playlistId) {
    return clone(playlists[playlistId]) || null;
  }

  function getDefaultRegion() {
    const available = listRegions();
    return available[0] || null;
  }

  function getDefaultPlaylist() {
    return getPlaylist('unranked_standard') || listPlaylists()[0] || null;
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
      liveInputEnabled: mergedOverrides.liveInputEnabled !== false
    };
  }

  return {
    auth: clone(auth),
    antiCheat: clone(antiCheat),
    moderation: clone(moderation),
    seasons: clone(seasons),
    reconnect: clone(reconnect),
    netcode: clone(netcode),
    quickChat: clone(quickChat),
    listRegions,
    listPlaylists,
    getRegion,
    getPlaylist,
    getDefaultRegion,
    getDefaultPlaylist,
    buildMatchRuntimeOptions,
    supportsFreeTextChat(playlistId, verified) {
      const playlist = getPlaylist(playlistId);
      if (!playlist) return false;
      if (playlist.matchChatMode !== 'free') return false;
      return !!verified;
    },
    requiresVerifiedAccount(playlistId) {
      const playlist = getPlaylist(playlistId);
      return !!(playlist && playlist.requireVerifiedAccount);
    },
    isRatedPlaylist(playlistId) {
      const playlist = getPlaylist(playlistId);
      return !!(playlist && playlist.rated);
    }
  };
});
