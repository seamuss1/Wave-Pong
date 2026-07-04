const { createMatchWorkerManager } = require('./manager.js');
const { createMatchWorkerApp } = require('./app.js');
const { buildRuntimeConfig } = require('../config.js');

const config = buildRuntimeConfig({
  serviceName: 'match-worker'
});

const app = createMatchWorkerApp({
  manager: createMatchWorkerManager({
    secret: config.secret,
    workerUrl: config.worker.internalWsUrl
  })
});

app.server.listen(config.worker.port, () => {
  console.log(`Wave Pong match-worker listening on ${config.worker.origin}`);
});
