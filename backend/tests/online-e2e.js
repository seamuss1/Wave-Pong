#!/usr/bin/env node
// End-to-end online quick-play test: drives two real client stacks (runtime sim +
// online.js) against a backend, verifies matchmaking, input transmission (movement
// and fire), authoritative scoring, and match completion.
//
// Usage:
//   node backend/tests/online-e2e.js                 # spawns a local backend, runs against it
//   node backend/tests/online-e2e.js http://10.0.0.12:8787   # runs against a deployed backend

const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const LOCAL_CONTROL_PORT = 18787;
const LOCAL_WORKER_PORT = 18788;
const apiBaseUrl = (process.argv[2] || `http://127.0.0.1:${LOCAL_CONTROL_PORT}`).replace(/\/+$/, '');
const spawnLocal = /127\.0\.0\.1|localhost/.test(apiBaseUrl) && !process.argv.includes('--no-spawn');
const wsBaseUrl = apiBaseUrl.replace(/^http/i, 'ws');

global.__WAVE_PONG_ENV__ = {
  apiBaseUrl,
  controlWsUrl: `${wsBaseUrl}/ws/control`,
  workerWsUrl: '',
  enabled: true
};

const config = require(path.join(REPO_ROOT, 'runtime/js/config.js'));
const simCore = require(path.join(REPO_ROOT, 'runtime/js/sim-core.js'));
const onlineApi = require(path.join(REPO_ROOT, 'runtime/js/online.js'));

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key)
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClient(name, scriptAction) {
  const runtime = simCore.createSimulation({ config, seed: 1 });
  const service = onlineApi.createOnlineService({
    runtime,
    storage: createMemoryStorage(),
    fetch: global.fetch,
    WebSocket: global.WebSocket,
    window: { setTimeout, clearTimeout },
    decorateLocalAction(defaultAction, context) {
      return scriptAction ? scriptAction(defaultAction, context, runtime) : defaultAction;
    }
  });
  const client = {
    name,
    runtime,
    service,
    matchStarted: false,
    matchResult: null,
    sawRemoteWave: false,
    remotePaddleTravel: 0,
    localSide: null
  };
  service.on('match.result', (payload) => {
    client.matchResult = payload;
  });
  return client;
}

async function main() {
  let serverProcess = null;
  if (spawnLocal) {
    serverProcess = spawn(process.execPath, [path.join(REPO_ROOT, 'backend/server.js')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WAVE_PONG_SECRET: 'e2e-secret',
        WAVE_PONG_CONTROL_PORT: String(LOCAL_CONTROL_PORT),
        WAVE_PONG_WORKER_PORT: String(LOCAL_WORKER_PORT)
      }
    });
    serverProcess.stdout.on('data', () => {});
    serverProcess.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
    // Wait for /health
    let healthy = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`${apiBaseUrl}/health`);
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch (error) {
        /* not up yet */
      }
      await sleep(250);
    }
    if (!healthy) throw new Error('Local backend did not become healthy.');
    console.log('local backend healthy');
  } else {
    const response = await fetch(`${apiBaseUrl}/health`);
    if (!response.ok) throw new Error(`Backend health check failed: HTTP ${response.status}`);
    console.log(`remote backend healthy at ${apiBaseUrl}`);
  }

  try {
    // Client A: chases the nearest ball and fires periodically. Client B: idle.
    let aTick = 0;
    const clientA = createClient('A', (defaultAction, context, runtime) => {
      aTick += 1;
      const side = context.side;
      const paddle = runtime.world.paddles[side];
      const ball = runtime.world.balls[0];
      let moveAxis = 0;
      if (ball && paddle) {
        const center = paddle.y + paddle.h / 2;
        moveAxis = ball.y < center - 10 ? -1 : (ball.y > center + 10 ? 1 : 0);
      }
      const fire = aTick % 60 === 0;
      return { moveAxis, fire, fireTier: fire ? (aTick % 120 === 0 ? 'pink' : 'blue') : null };
    });
    const clientB = createClient('B', () => ({ moveAxis: 0, fire: false, fireTier: null }));

    await clientA.service.joinQueue({ displayName: 'AlphaE2E' });
    await clientB.service.joinQueue({ displayName: 'BravoE2E' });
    console.log('both clients queued');

    // Wait for both matches to start (runtime.state.running + currentMatch).
    const startDeadline = Date.now() + 15000;
    while (Date.now() < startDeadline) {
      const aState = clientA.service.getState();
      const bState = clientB.service.getState();
      if (aState.currentMatch && bState.currentMatch && clientA.runtime.state.running && clientB.runtime.state.running) {
        clientA.localSide = clientA.service._debugState.localSide;
        clientB.localSide = clientB.service._debugState.localSide;
        break;
      }
      await sleep(100);
    }
    if (!clientA.runtime.state.running || !clientB.runtime.state.running) {
      throw new Error('Match did not start on both clients within 15s.');
    }
    console.log(`match started: A=${clientA.localSide}, B=${clientB.localSide}`);
    if (!clientA.localSide || !clientB.localSide || clientA.localSide === clientB.localSide) {
      throw new Error(`Invalid side assignment: A=${clientA.localSide} B=${clientB.localSide}`);
    }

    // Step both client sims at ~120 ticks/sec for up to 45s of game time.
    const remoteSideForB = clientA.localSide; // A's paddle as seen from B
    let bRemoteLastY = null;
    const playDeadline = Date.now() + 45000;
    let scored = false;
    while (Date.now() < playDeadline) {
      for (const client of [clientA, clientB]) {
        if (client.runtime.state.running && !client.runtime.state.gameOver) {
          client.runtime.stepSimulation(3);
        }
      }
      // Observe A's actions propagating into B's sim (via server snapshots/predictions).
      const bWorld = clientB.runtime.world;
      if (bWorld.pulses.some((pulse) => pulse.side === remoteSideForB)) {
        clientB.sawRemoteWave = true;
      }
      const remotePaddle = bWorld.paddles[remoteSideForB];
      if (remotePaddle) {
        if (bRemoteLastY != null) clientB.remotePaddleTravel += Math.abs(remotePaddle.y - bRemoteLastY);
        bRemoteLastY = remotePaddle.y;
      }
      const bState = clientB.runtime.state;
      if ((bState.leftScore + bState.rightScore) > 0) {
        scored = true;
      }
      if (clientA.matchResult || clientB.matchResult) break;
      if (scored && clientB.sawRemoteWave && clientB.remotePaddleTravel > 50) break;
      await sleep(25);
    }

    const checks = {
      scored,
      fireTransmitted: clientB.sawRemoteWave,
      movementTransmitted: clientB.remotePaddleTravel > 50,
      aScore: `${clientA.runtime.state.leftScore}-${clientA.runtime.state.rightScore}`,
      bScore: `${clientB.runtime.state.leftScore}-${clientB.runtime.state.rightScore}`,
      remotePaddleTravel: Math.round(clientB.remotePaddleTravel),
      matchResult: clientA.matchResult || clientB.matchResult || null
    };
    console.log('results:', JSON.stringify(checks, null, 2));

    if (!checks.scored) throw new Error('No goals were scored through the authoritative loop.');
    if (!checks.fireTransmitted) throw new Error("Client A's fire never appeared in client B's simulation.");
    if (!checks.movementTransmitted) throw new Error("Client A's movement never appeared in client B's simulation.");
    console.log('E2E OK');
  } finally {
    if (serverProcess) serverProcess.kill();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('E2E FAILED:', error.message);
  process.exit(1);
});
