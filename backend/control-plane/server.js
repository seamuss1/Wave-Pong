const { createMatchWorkerManager } = require('../match-worker/manager.js');
const { createControlPlaneApp } = require('./app.js');
const { buildRuntimeConfig } = require('../config.js');

const config = buildRuntimeConfig({
  serviceName: 'control-plane'
});

const app = createControlPlaneApp({
  workerManager: createMatchWorkerManager({
    secret: config.secret,
    workerUrl: config.worker.internalWsUrl
  }),
  workerUrl: config.worker.internalWsUrl,
  publicWorkerUrl: config.worker.publicWsUrl,
  secret: config.secret
});

app.server.listen(config.control.port, () => {
  console.log(`Wave Pong control-plane listening on ${config.control.origin}`);
});
