const { createMatchWorkerManager } = require('./manager.js');
const { createMatchWorkerApp } = require('./app.js');

const PORT = Number(process.env.PORT || 8788);
const SECRET = process.env.WAVE_PONG_SECRET || 'wave-pong-local-secret';

const app = createMatchWorkerApp({
  manager: createMatchWorkerManager({
    secret: SECRET,
    workerUrl: process.env.WAVE_PONG_WORKER_URL || `ws://127.0.0.1:${PORT}/ws/match`
  })
});

app.server.listen(PORT, () => {
  console.log(`Wave Pong match-worker listening on http://127.0.0.1:${PORT}`);
});
