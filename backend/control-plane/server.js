const { createMatchWorkerManager } = require('../match-worker/manager.js');
const { createControlPlaneApp } = require('./app.js');

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.WAVE_PONG_SECRET || 'wave-pong-local-secret';

const app = createControlPlaneApp({
  workerManager: createMatchWorkerManager({
    secret: SECRET,
    workerUrl: process.env.WAVE_PONG_WORKER_URL || 'ws://127.0.0.1:8788/ws/match'
  }),
  workerUrl: process.env.WAVE_PONG_WORKER_URL || 'ws://127.0.0.1:8788/ws/match',
  secret: SECRET
});

app.server.listen(PORT, () => {
  console.log(`Wave Pong control-plane listening on http://127.0.0.1:${PORT}`);
});
