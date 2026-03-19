const test = require('node:test');
const assert = require('node:assert/strict');

const protocol = require('../../shared/protocol/index.js');
const multiplayer = require('../../shared/multiplayer/config.js');
const engineApi = require('../../shared/sim/engine.js');
const { AuthoritativeMatch } = require('../match-worker/authoritative-match.js');

test('protocol validates and normalizes input batches', () => {
  const result = protocol.validateInputBatch({
    matchId: 'match_1',
    seq: 7.8,
    startTick: 12.2,
    frames: [
      { moveAxis: 2, fire: 1 },
      { moveAxis: -2, fire: 0 }
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    matchId: 'match_1',
    seq: 7,
    startTick: 12,
    frames: [
      { moveAxis: 1, fire: true },
      { moveAxis: -1, fire: false }
    ]
  });
});

test('authoritative engine builds a serializable snapshot blob', () => {
  const engine = engineApi.createAuthoritativeMatchEngine({
    playlistId: 'unranked_standard',
    matchId: 'match_engine',
    seed: 42
  });

  const started = engine.start({
    skipCountdown: true,
    leftName: 'Alpha',
    rightName: 'Bravo'
  });

  assert.equal(started.matchId, 'match_engine');
  assert.equal(started.full, true);
  assert.ok(started.stateBlob);

  const restored = engineApi.deserializeStateBlob(started.stateBlob);
  assert.ok(restored.state);
  assert.equal(restored.state.leftScore, 0);
  assert.equal(restored.state.rightScore, 0);
});

test('authoritative match accepts players and emits a start payload', () => {
  const match = new AuthoritativeMatch({
    matchId: 'match_live',
    playlistId: 'unranked_standard',
    region: multiplayer.getDefaultRegion().id,
    players: [
      { id: 'left-player', displayName: 'Lefty', side: 'left' },
      { id: 'right-player', displayName: 'Righty', side: 'right' }
    ],
    seed: 9
  });

  const leftConnection = {
    messages: [],
    sendJson(payload) {
      this.messages.push(payload);
    }
  };
  const rightConnection = {
    messages: [],
    sendJson(payload) {
      this.messages.push(payload);
    }
  };

  match.attachConnection('left-player', leftConnection);
  match.attachConnection('right-player', rightConnection);
  match.handleAccept('left-player');
  match.handleAccept('right-player');

  try {
    assert.equal(match.started, true);
    assert.ok(leftConnection.messages.some((message) => message.type === 'match.start'));
    assert.ok(rightConnection.messages.some((message) => message.type === 'match.start'));
    assert.ok(match.currentSnapshot);
    assert.equal(match.currentSnapshot.matchId, 'match_live');
  } finally {
    if (match.loopHandle) {
      clearInterval(match.loopHandle);
      match.loopHandle = null;
    }
  }
});
