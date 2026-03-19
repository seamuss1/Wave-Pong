const { createControlPlaneApp } = require('./control-plane/app.js');
const { createMatchWorkerManager } = require('./match-worker/manager.js');
const { createMatchWorkerApp } = require('./match-worker/app.js');
const { buildRuntimeConfig } = require('./config.js');

const config = buildRuntimeConfig({
  serviceName: 'dev-server'
});

const workerManager = createMatchWorkerManager({
  secret: config.secret,
  workerUrl: config.worker.internalWsUrl
});

const controlPlane = createControlPlaneApp({
  workerManager,
  workerUrl: config.worker.internalWsUrl,
  publicWorkerUrl: config.worker.publicWsUrl,
  secret: config.secret
});

const matchWorker = createMatchWorkerApp({
  manager: workerManager
});

controlPlane.server.listen(config.control.port, () => {
  console.log(`Wave Pong control-plane listening on ${config.control.origin}`);
});

matchWorker.server.listen(config.worker.port, () => {
  console.log(`Wave Pong match-worker listening on ${config.worker.origin}`);
});
