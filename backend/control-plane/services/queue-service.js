const { ensureQueueBucket, getQueueKey } = require('../store.js');

function createQueueService(options) {
  const { store, multiplayer, workerManager, broadcastToPlayer, broadcastQueuePresence } = options;

  function serializeQueueState(playerId, playlistId, region) {
    const bucket = ensureQueueBucket(store, playlistId, region);
    return {
      playlistId,
      region,
      queueSize: bucket.entries.length,
      queued: bucket.entries.some((entry) => entry.playerId === playerId)
    };
  }

  function removePlayerFromAllQueues(playerId) {
    const changedBuckets = [];
    for (const [bucketKey, entries] of store.queueBuckets.entries()) {
      const nextEntries = entries.filter((entry) => entry.playerId !== playerId);
      if (nextEntries.length !== entries.length) {
        store.queueBuckets.set(bucketKey, nextEntries);
        changedBuckets.push({
          bucketKey,
          queueSize: nextEntries.length
        });
      }
    }
    return changedBuckets;
  }

  function maybeCreateMatches(playlistId, region) {
    const bucket = ensureQueueBucket(store, playlistId, region);
    while (bucket.entries.length >= 2) {
      const left = bucket.entries.shift();
      const right = bucket.entries.shift();
      const leftPlayer = store.players.get(left.playerId);
      const rightPlayer = store.players.get(right.playerId);
      if (!leftPlayer || !rightPlayer) continue;
      const created = workerManager.createMatch({
        playlistId,
        region,
        players: [
          { id: leftPlayer.id, displayName: leftPlayer.displayName, verified: leftPlayer.verified, side: 'left' },
          { id: rightPlayer.id, displayName: rightPlayer.displayName, verified: rightPlayer.verified, side: 'right' }
        ]
      });
      store.matches.set(created.matchId, {
        matchId: created.matchId,
        playlistId,
        region,
        playerIds: [leftPlayer.id, rightPlayer.id],
        status: 'found',
        createdAt: new Date().toISOString()
      });
      broadcastToPlayer(leftPlayer.id, 'match.found', {
        matchId: created.matchId,
        playlistId,
        region,
        workerUrl: options.publicWorkerUrl || created.workerUrl,
        side: 'left',
        ticket: created.tickets.left,
        opponent: { id: rightPlayer.id, displayName: rightPlayer.displayName, verified: rightPlayer.verified }
      });
      broadcastToPlayer(rightPlayer.id, 'match.found', {
        matchId: created.matchId,
        playlistId,
        region,
        workerUrl: options.publicWorkerUrl || created.workerUrl,
        side: 'right',
        ticket: created.tickets.right,
        opponent: { id: leftPlayer.id, displayName: leftPlayer.displayName, verified: leftPlayer.verified }
      });
    }
    broadcastQueuePresence(getQueueKey(playlistId, region), bucket.entries.length);
  }

  return {
    joinQueue(player, payload) {
      const playlist = multiplayer.getPlaylist(payload.playlistId);
      if (!playlist) throw new Error('Unknown playlist.');
      const region = multiplayer.getRegion(payload.region);
      if (!region) throw new Error('Unknown region.');
      if (playlist.requireVerifiedAccount && !player.verified) {
        throw new Error('This queue requires a verified account.');
      }
      for (const changed of removePlayerFromAllQueues(player.id)) {
        broadcastQueuePresence(changed.bucketKey, changed.queueSize);
      }
      const bucket = ensureQueueBucket(store, playlist.id, region.id);
      bucket.entries.push({
        playerId: player.id,
        queuedAt: Date.now()
      });
      broadcastQueuePresence(bucket.key, bucket.entries.length);
      maybeCreateMatches(playlist.id, region.id);
      return serializeQueueState(player.id, playlist.id, region.id);
    },
    leaveQueue(player, payload) {
      const playlistId = payload.playlistId;
      const region = payload.region;
      if (!playlistId || !region) {
        for (const changed of removePlayerFromAllQueues(player.id)) {
          broadcastQueuePresence(changed.bucketKey, changed.queueSize);
        }
        return { playlistId: null, region: null, queueSize: 0, queued: false };
      }
      const bucket = ensureQueueBucket(store, playlistId, region);
      bucket.entries = bucket.entries.filter((entry) => entry.playerId !== player.id);
      store.queueBuckets.set(bucket.key, bucket.entries);
      broadcastQueuePresence(bucket.key, bucket.entries.length);
      return serializeQueueState(player.id, playlistId, region);
    }
  };
}

module.exports = {
  createQueueService
};
