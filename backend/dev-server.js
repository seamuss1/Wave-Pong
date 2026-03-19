const { createControlPlaneApp } = require('./control-plane/app.js');
const { createMatchWorkerManager } = require('./match-worker/manager.js');
const { createMatchWorkerApp } = require('./match-worker/app.js');

const CONTROL_PORT = Number(process.env.WAVE_PONG_CONTROL_PORT || 8787);
const WORKER_PORT = Number(process.env.WAVE_PONG_WORKER_PORT || 8788);
const SECRET = process.env.WAVE_PONG_SECRET || 'wave-pong-local-secret';

const workerManager = createMatchWorkerManager({
  secret: SECRET,
  workerUrl: `ws://127.0.0.1:${WORKER_PORT}/ws/match`
});

const controlPlane = createControlPlaneApp({
  workerManager,
  workerUrl: `ws://127.0.0.1:${WORKER_PORT}/ws/match`,
  secret: SECRET
});

const matchWorker = createMatchWorkerApp({
  manager: workerManager
});

controlPlane.server.listen(CONTROL_PORT, () => {
  console.log(`Wave Pong control-plane listening on http://127.0.0.1:${CONTROL_PORT}`);
});

matchWorker.server.listen(WORKER_PORT, () => {
  console.log(`Wave Pong match-worker listening on http://127.0.0.1:${WORKER_PORT}`);
});
