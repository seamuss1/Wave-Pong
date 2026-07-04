const QUICK_PLAY_PLAYLIST_ID = 'quick_play';

function createQueueService(options) {
  const { store, workerManager, broadcastToPlayer } = options;

  function serializeQueueState(playerId) {
    return {
      playlistId: QUICK_PLAY_PLAYLIST_ID,
      queueSize: store.queue.length,
      queued: store.queue.some((entry) => entry.playerId === playerId)
    };
  }

  function removeFromQueue(playerId) {
    store.queue = store.queue.filter((entry) => entry.playerId !== playerId);
  }

  function maybeCreateMatches() {
    while (store.queue.length >= 2) {
      const left = store.queue.shift();
      const right = store.queue.shift();
      const leftPlayer = store.players.get(left.playerId);
      const rightPlayer = store.players.get(right.playerId);
      if (!leftPlayer || !rightPlayer) continue;
      const created = workerManager.createMatch({
        playlistId: QUICK_PLAY_PLAYLIST_ID,
        players: [
          { id: leftPlayer.id, displayName: leftPlayer.displayName, side: 'left' },
          { id: rightPlayer.id, displayName: rightPlayer.displayName, side: 'right' }
        ]
      });
      store.matches.set(created.matchId, {
        matchId: created.matchId,
        playlistId: QUICK_PLAY_PLAYLIST_ID,
        playerIds: [leftPlayer.id, rightPlayer.id],
        status: 'found',
        createdAt: new Date().toISOString()
      });
      broadcastToPlayer(leftPlayer.id, 'match.found', {
        matchId: created.matchId,
        playlistId: QUICK_PLAY_PLAYLIST_ID,
        workerUrl: options.publicWorkerUrl || created.workerUrl,
        side: 'left',
        ticket: created.tickets.left,
        opponent: { id: rightPlayer.id, displayName: rightPlayer.displayName }
      });
      broadcastToPlayer(rightPlayer.id, 'match.found', {
        matchId: created.matchId,
        playlistId: QUICK_PLAY_PLAYLIST_ID,
        workerUrl: options.publicWorkerUrl || created.workerUrl,
        side: 'right',
        ticket: created.tickets.right,
        opponent: { id: leftPlayer.id, displayName: leftPlayer.displayName }
      });
    }
  }

  return {
    joinQueue(player) {
      removeFromQueue(player.id);
      store.queue.push({
        playerId: player.id,
        queuedAt: Date.now()
      });
      maybeCreateMatches();
      return serializeQueueState(player.id);
    },
    leaveQueue(player) {
      removeFromQueue(player.id);
      return serializeQueueState(player.id);
    }
  };
}

module.exports = {
  createQueueService
};
