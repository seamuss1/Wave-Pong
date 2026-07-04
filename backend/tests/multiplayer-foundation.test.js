const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const protocol = require('../../shared/protocol/index.js');
const multiplayer = require('../../shared/multiplayer/config.js');
const engineApi = require('../../shared/sim/engine.js');
const { AuthoritativeMatch } = require('../match-worker/authoritative-match.js');
const { createMemoryStore } = require('../control-plane/store.js');
const { createQueueService } = require('../control-plane/services/queue-service.js');
const { issueScopedToken } = require('../lib/tokens.js');

function createExpiredToken(secret, playerId) {
  const payload = {
    type: 'access',
    playerId,
    iat: 1,
    exp: 1
  };
  const body = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${body}.${signature}`;
}

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

test('queue service broadcasts old bucket presence and returns the public worker url to browsers', () => {
  const store = createMemoryStore(multiplayer);
  const playerA = { id: 'player-a', displayName: 'Alpha', verified: true };
  const playerB = { id: 'player-b', displayName: 'Bravo', verified: true };
  const playerC = { id: 'player-c', displayName: 'Charlie', verified: true };
  store.players.set(playerA.id, playerA);
  store.players.set(playerB.id, playerB);
  store.players.set(playerC.id, playerC);

  const presenceUpdates = [];
  const matchFound = [];
  const queueService = createQueueService({
    store,
    multiplayer,
    workerManager: {
      createMatch(payload) {
        return {
          matchId: 'match-public-url',
          workerUrl: 'ws://10.0.0.9:8788/ws/match',
          tickets: {
            left: `${payload.players[0].id}-ticket`,
            right: `${payload.players[1].id}-ticket`
          }
        };
      }
    },
    broadcastToPlayer(playerId, type, payload) {
      matchFound.push({ playerId, type, payload });
    },
    broadcastQueuePresence(bucketKey, queueSize) {
      presenceUpdates.push({ bucketKey, queueSize });
    },
    publicWorkerUrl: 'wss://worker.wave-pong.example/ws/match'
  });

  queueService.joinQueue(playerA, { playlistId: 'unranked_standard', region: 'na' });
  queueService.joinQueue(playerB, { playlistId: 'unranked_chaos', region: 'eu' });
  presenceUpdates.length = 0;

  queueService.joinQueue(playerA, { playlistId: 'unranked_standard', region: 'eu' });
  assert.deepEqual(presenceUpdates.slice(0, 3), [
    { bucketKey: 'unranked_standard:na', queueSize: 0 },
    { bucketKey: 'unranked_standard:eu', queueSize: 1 },
    { bucketKey: 'unranked_standard:eu', queueSize: 1 }
  ]);

  presenceUpdates.length = 0;
  queueService.joinQueue(playerC, { playlistId: 'unranked_standard', region: 'eu' });

  assert.equal(matchFound.length, 2);
  assert.equal(matchFound[0].payload.workerUrl, 'wss://worker.wave-pong.example/ws/match');
  assert.equal(matchFound[1].payload.workerUrl, 'wss://worker.wave-pong.example/ws/match');

  queueService.leaveQueue(playerB, {});
  assert.deepEqual(presenceUpdates.at(-1), { bucketKey: 'unranked_chaos:eu', queueSize: 0 });
});

test('online service refreshes expired stored sessions before connecting control socket', async () => {
  const secret = 'test-secret';
  const expiredToken = createExpiredToken(secret, 'expired-player');
  const freshToken = issueScopedToken(secret, { type: 'access', playerId: 'fresh-player' }, 1200);
  const storageState = new Map([
    ['wavePongOnlineSessionV1', JSON.stringify({ accessToken: expiredToken, player: { id: 'expired-player' } })]
  ]);
  const storage = {
    getItem(key) {
      return storageState.has(key) ? storageState.get(key) : null;
    },
    setItem(key, value) {
      storageState.set(key, value);
    },
    removeItem(key) {
      storageState.delete(key);
    }
  };
  const fetchCalls = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.listeners = new Map();
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => this.emit('open'));
    }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }
    emit(type, payload) {
      const listeners = this.listeners.get(type);
      if (!listeners) return;
      for (const listener of listeners) {
        if (type === 'message') {
          listener({ data: JSON.stringify(payload) });
        } else {
          listener(payload);
        }
      }
    }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.type === 'hello') {
        this.emit('message', {
          type: 'hello.ok',
          payload: {
            player: { id: 'fresh-player', displayName: 'Fresh', verified: false }
          }
        });
      }
    }
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  FakeWebSocket.instances = [];

  function loadOnlineApi() {
    global.__WAVE_PONG_ENV__ = {
      apiBaseUrl: 'http://127.0.0.1:8787',
      controlWsUrl: 'ws://127.0.0.1:8787/ws/control',
      workerWsUrl: 'ws://127.0.0.1:8788/ws/match',
      enabled: true
    };
    delete require.cache[require.resolve('../../runtime/js/env.js')];
    delete require.cache[require.resolve('../../runtime/js/online.js')];
    return require('../../runtime/js/online.js');
  }

  const onlineApi = loadOnlineApi();
  const service = onlineApi.createOnlineService({
    runtime: {},
    storage,
    fetch(url) {
      fetchCalls.push(url);
      return Promise.resolve({
        ok: true,
        json: async () => ({
          accessToken: freshToken,
          refreshToken: 'refresh-token',
          player: { id: 'fresh-player', displayName: 'Fresh', verified: false }
        })
      });
    },
    WebSocket: FakeWebSocket,
    window: {
      fetch: null,
      WebSocket: FakeWebSocket,
      localStorage: storage,
      setTimeout,
      clearTimeout
    }
  });

  await service.ensureConnected('Fresh');

  assert.equal(fetchCalls.length, 1);
  assert.equal(service.getState().controlConnected, true);
  assert.equal(service.getState().session.player.id, 'fresh-player');
});

test('online service attempts to reconnect a dropped match websocket', async () => {
  const freshToken = issueScopedToken('test-secret', { type: 'access', playerId: 'player-1' }, 1200);
  const reconnectCalls = [];
  const timers = [];
  const storage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {}
  };

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.listeners = new Map();
      this.sent = [];
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => this.emit('open'));
    }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(listener);
    }
    emit(type, payload) {
      const listeners = this.listeners.get(type);
      if (!listeners) return;
      for (const listener of listeners) {
        if (type === 'message') {
          listener({ data: JSON.stringify(payload) });
        } else {
          listener(payload);
        }
      }
    }
    send(raw) {
      const message = JSON.parse(raw);
      this.sent.push(message);
      if (message.type === 'hello' && message.payload.accessToken) {
        this.emit('message', {
          type: 'hello.ok',
          payload: {
            player: { id: 'player-1', displayName: 'Player 1', verified: false }
          }
        });
      } else if ((message.type === 'hello' || message.type === 'resume') && message.payload.ticket) {
        this.emit('message', {
          type: 'match.ready',
          payload: {
            matchId: 'match-1'
          }
        });
      }
    }
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  FakeWebSocket.instances = [];

  global.__WAVE_PONG_ENV__ = {
    apiBaseUrl: 'http://127.0.0.1:8787',
    controlWsUrl: 'ws://127.0.0.1:8787/ws/control',
    workerWsUrl: 'wss://worker.wave-pong.example/ws/match',
    enabled: true
  };
  delete require.cache[require.resolve('../../runtime/js/env.js')];
  delete require.cache[require.resolve('../../runtime/js/online.js')];
  const onlineApi = require('../../runtime/js/online.js');

  const service = onlineApi.createOnlineService({
    runtime: {
      startMatch() {},
      setInputProvider() {},
      setLiveInputEnabled() {},
      restoreSimulation() {},
      queueInput() {},
      stepSimulation() {},
      state: { tick: 0 }
    },
    storage,
    fetch(url) {
      if (url.endsWith('/auth/guest')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            accessToken: freshToken,
            refreshToken: 'refresh-token',
            player: { id: 'player-1', displayName: 'Player 1', verified: false }
          })
        });
      }
      if (url.includes('/matches/match-1/reconnect')) {
        reconnectCalls.push(url);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            matchId: 'match-1',
            workerUrl: 'wss://worker.wave-pong.example/ws/match',
            ticket: 'resume-ticket'
          })
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    },
    WebSocket: FakeWebSocket,
    window: {
      fetch: null,
      WebSocket: FakeWebSocket,
      localStorage: storage,
      setTimeout(callback) {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout() {}
    }
  });

  await service.ensureConnected('Player 1');
  const controlSocket = FakeWebSocket.instances[0];
  controlSocket.emit('message', {
    type: 'match.found',
    payload: {
      matchId: 'match-1',
      playlistId: 'unranked_standard',
      region: 'na',
      workerUrl: 'wss://worker.wave-pong.example/ws/match',
      side: 'left',
      ticket: 'initial-ticket',
      opponent: { id: 'player-2', displayName: 'Player 2', verified: false }
    }
  });

  const firstMatchSocket = FakeWebSocket.instances[1];
  firstMatchSocket.close();
  assert.equal(timers.length, 1);

  await timers[0]();

  assert.equal(reconnectCalls.length, 1);
  const resumedSocket = FakeWebSocket.instances[2];
  assert.equal(resumedSocket.sent.some((message) => message.type === 'resume' && message.payload.ticket === 'resume-ticket'), true);
});
