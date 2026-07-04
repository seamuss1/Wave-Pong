const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const protocol = require('../../shared/protocol/index.js');
const engineApi = require('../../shared/sim/engine.js');
const { AuthoritativeMatch } = require('../match-worker/authoritative-match.js');
const { createMemoryStore } = require('../control-plane/store.js');
const { createQueueService } = require('../control-plane/services/queue-service.js');
const { issueScopedToken } = require('../lib/tokens.js');
const { createAuthService } = require('../control-plane/services/auth-service.js');

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

test('protocol validates and normalizes input batches with fire tiers', () => {
  const result = protocol.validateInputBatch({
    matchId: 'match_1',
    seq: 7.8,
    startTick: 12.2,
    frames: [
      { moveAxis: 2, fire: 1, fireTier: 'pink' },
      { moveAxis: -2, fire: 0, fireTier: 'pink' },
      { moveAxis: 0, fire: true, fireTier: 'nonsense' }
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    matchId: 'match_1',
    seq: 7,
    startTick: 12,
    frames: [
      { moveAxis: 1, fire: true, fireTier: 'pink' },
      { moveAxis: -1, fire: false, fireTier: null },
      { moveAxis: 0, fire: true, fireTier: null }
    ]
  });
});

test('authoritative engine builds a serializable snapshot blob', () => {
  const engine = engineApi.createAuthoritativeMatchEngine({
    playlistId: 'quick_play',
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

test('queued fire actions produce waves in the authoritative engine', () => {
  const engine = engineApi.createAuthoritativeMatchEngine({
    playlistId: 'quick_play',
    matchId: 'match_fire',
    seed: 7
  });
  engine.start({ skipCountdown: true, leftName: 'Alpha', rightName: 'Bravo' });

  const startTick = engine.runtime.state.tick;
  engine.queueFrames('left', {
    matchId: 'match_fire',
    seq: 1,
    startTick,
    frames: [{ moveAxis: 0, fire: true, fireTier: 'blue' }]
  });
  engine.step(1);

  const snapshot = engine.snapshot(false);
  assert.equal(snapshot.waves.length, 1);
  assert.equal(snapshot.waves[0].side, 'left');
});

test('snapshots echo how early or late each side\'s inputs arrive', () => {
  const engine = engineApi.createAuthoritativeMatchEngine({
    playlistId: 'quick_play',
    matchId: 'match_margin',
    seed: 13
  });
  engine.start({ skipCountdown: true, leftName: 'Alpha', rightName: 'Bravo' });
  engine.step(10); // server is now at tick 10; next consumable tick is 11

  // Early batch: stamped 4 ticks ahead of the next server tick.
  engine.queueFrames('left', {
    matchId: 'match_margin',
    seq: 1,
    startTick: 15,
    frames: [{ moveAxis: 1, fire: false, fireTier: null }]
  });
  // Late batch: stamped 5 ticks behind the next server tick.
  engine.queueFrames('right', {
    matchId: 'match_margin',
    seq: 1,
    startTick: 6,
    frames: [{ moveAxis: -1, fire: false, fireTier: null }]
  });

  const snapshot = engine.snapshot(false);
  assert.equal(snapshot.inputMargin.left, 4);
  assert.equal(snapshot.inputMargin.right, -5);
});

test('network snapshots stay lean and do not grow with match length', () => {
  const engine = engineApi.createAuthoritativeMatchEngine({
    playlistId: 'quick_play',
    matchId: 'match_lean',
    seed: 11
  });
  engine.start({ skipCountdown: true, leftName: 'Alpha', rightName: 'Bravo' });

  for (let tick = 1; tick <= 600; tick += 1) {
    engine.queueFrames('left', {
      matchId: 'match_lean',
      seq: tick,
      startTick: tick,
      frames: [{ moveAxis: tick % 2 ? 1 : -1, fire: tick % 120 === 0, fireTier: null }]
    });
    engine.step(1);
  }
  const earlyBlob = engine.snapshot(true).stateBlob;
  // The blob must not carry the replay log, local history, or cosmetic arrays —
  // those grow with match length and were the source of runaway snapshot sizes.
  assert.equal(earlyBlob.replay, undefined);
  assert.equal(earlyBlob.history, undefined);
  assert.deepEqual(earlyBlob.world.particles, []);
  assert.deepEqual(earlyBlob.world.floatTexts, []);
  for (const ball of earlyBlob.world.balls) assert.deepEqual(ball.trail, []);

  const earlySize = JSON.stringify(earlyBlob).length;
  for (let tick = 601; tick <= 3600; tick += 1) {
    engine.step(1);
  }
  const lateSize = JSON.stringify(engine.snapshot(true).stateBlob).length;
  // Allow variance from ball/pulse/powerup counts, but 25 extra seconds of
  // simulation must not meaningfully inflate the payload.
  assert.ok(lateSize < Math.max(earlySize * 3, 20000), `snapshot grew from ${earlySize} to ${lateSize} bytes`);
});

test('authoritative match accepts players and emits a start payload', () => {
  const match = new AuthoritativeMatch({
    matchId: 'match_live',
    playlistId: 'quick_play',
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

test('queue service matches pairs and returns the public worker url to browsers', () => {
  const store = createMemoryStore();
  const playerA = { id: 'player-a', displayName: 'Alpha' };
  const playerB = { id: 'player-b', displayName: 'Bravo' };
  store.players.set(playerA.id, playerA);
  store.players.set(playerB.id, playerB);

  const matchFound = [];
  const queueService = createQueueService({
    store,
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
    publicWorkerUrl: 'ws://10.0.0.12:8788/ws/match'
  });

  const soloState = queueService.joinQueue(playerA);
  assert.equal(soloState.queued, true);
  assert.equal(soloState.queueSize, 1);

  // Re-joining does not duplicate the entry.
  const rejoinState = queueService.joinQueue(playerA);
  assert.equal(rejoinState.queueSize, 1);

  queueService.joinQueue(playerB);
  assert.equal(store.queue.length, 0);
  assert.equal(matchFound.length, 2);
  assert.equal(matchFound[0].type, 'match.found');
  assert.equal(matchFound[0].payload.workerUrl, 'ws://10.0.0.12:8788/ws/match');
  assert.equal(matchFound[0].payload.side, 'left');
  assert.equal(matchFound[1].payload.side, 'right');
  assert.equal(matchFound[0].payload.opponent.displayName, 'Bravo');

  const leaveState = queueService.leaveQueue(playerA);
  assert.equal(leaveState.queued, false);
});

test('auth service tags a token whose player was wiped (server restart) as auth_error', () => {
  const secret = 'test-secret';
  const authService = createAuthService({
    store: createMemoryStore(),
    multiplayer: { auth: {} },
    secret
  });
  // Signature-valid, not expired, but no matching player was ever registered
  // in this store instance - simulates a client token surviving a server
  // restart that wiped the in-memory player map.
  const orphanToken = issueScopedToken(secret, { type: 'access', playerId: 'ghost-player' }, 1200);

  assert.throws(
    () => authService.authenticateAccess(orphanToken),
    (error) => error.code === 'auth_error' && /unknown player/i.test(error.message)
  );
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
            player: { id: 'fresh-player', displayName: 'Fresh' }
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
          player: { id: 'fresh-player', displayName: 'Fresh' }
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

test('joinQueue recovers from a stored session the server no longer recognizes', async () => {
  // Reproduces the reported bug: "Find Match" does nothing and the status
  // reads "Unknown player." A stored session can look locally fresh (its own
  // claimed expiry hasn't passed) while pointing at a player the server's
  // in-memory store no longer has, most commonly because the server restarted
  // since the token was issued. joinQueue should discard that session and
  // transparently retry as a new guest instead of failing forever.
  const secret = 'test-secret';
  const staleToken = issueScopedToken(secret, { type: 'access', playerId: 'stale-player' }, 1200);
  const freshToken = issueScopedToken(secret, { type: 'access', playerId: 'fresh-player' }, 1200);
  const storageState = new Map([
    ['wavePongOnlineSessionV1', JSON.stringify({ accessToken: staleToken, player: { id: 'stale-player' } })]
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
      if (message.type !== 'hello') return;
      if (message.payload.accessToken === staleToken) {
        // Simulates the server after a restart: signature still verifies, but
        // the in-memory player record is gone.
        this.emit('message', {
          type: 'error',
          payload: { code: 'auth_error', message: 'Unknown player.' }
        });
        return;
      }
      this.emit('message', {
        type: 'hello.ok',
        payload: { player: { id: 'fresh-player', displayName: 'Fresh' } }
      });
    }
    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }
  FakeWebSocket.instances = [];

  const fetchCalls = [];
  global.__WAVE_PONG_ENV__ = {
    apiBaseUrl: 'http://127.0.0.1:8787',
    controlWsUrl: 'ws://127.0.0.1:8787/ws/control',
    workerWsUrl: 'ws://127.0.0.1:8788/ws/match',
    enabled: true
  };
  delete require.cache[require.resolve('../../runtime/js/env.js')];
  delete require.cache[require.resolve('../../runtime/js/online.js')];
  const onlineApi = require('../../runtime/js/online.js');

  const service = onlineApi.createOnlineService({
    runtime: {},
    storage,
    fetch(url) {
      fetchCalls.push(url);
      if (url.endsWith('/auth/guest')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            accessToken: freshToken,
            refreshToken: 'refresh-token',
            player: { id: 'fresh-player', displayName: 'Fresh' }
          })
        });
      }
      if (url.endsWith('/queue/join')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ queue: { playlistId: 'quick_play', queueSize: 1, queued: true } })
        });
      }
      throw new Error(`Unexpected fetch url: ${url}`);
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

  await service.joinQueue({ displayName: 'Fresh' });

  const state = service.getState();
  assert.equal(state.session.player.id, 'fresh-player');
  assert.equal(state.queue.queued, true);
  assert.equal(fetchCalls.filter((url) => url.endsWith('/auth/guest')).length, 1);
  assert.equal(fetchCalls.filter((url) => url.endsWith('/queue/join')).length, 1);
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
            player: { id: 'player-1', displayName: 'Player 1' }
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
    workerWsUrl: 'ws://10.0.0.12:8788/ws/match',
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
      setLocalHumanSide() {},
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
            player: { id: 'player-1', displayName: 'Player 1' }
          })
        });
      }
      if (url.includes('/matches/match-1/reconnect')) {
        reconnectCalls.push(url);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            matchId: 'match-1',
            workerUrl: 'ws://10.0.0.12:8788/ws/match',
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
      playlistId: 'quick_play',
      workerUrl: 'ws://10.0.0.12:8788/ws/match',
      side: 'left',
      ticket: 'initial-ticket',
      opponent: { id: 'player-2', displayName: 'Player 2' }
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
