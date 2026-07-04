const { createControlPlaneApp } = require('./control-plane/app.js');
const { createMatchWorkerManager } = require('./match-worker/manager.js');
const { createMatchWorkerApp, createMatchConnectionHandler } = require('./match-worker/app.js');
const { buildRuntimeConfig } = require('./config.js');
const protocol = require('../shared/protocol/index.js');

const config = buildRuntimeConfig({
  serviceName: 'wave-pong'
});

const workerManager = createMatchWorkerManager({
  secret: config.secret,
  workerUrl: config.worker.internalWsUrl
});

// In single-port mode the match socket is mounted on the control-plane server so
// the whole game (client, API, /ws/control, /ws/match) sits behind one origin.
const extraWsHandlers = config.singlePort
  ? { [protocol.WS_PATHS.match]: createMatchConnectionHandler(workerManager) }
  : {};

const controlPlane = createControlPlaneApp({
  workerManager,
  workerUrl: config.worker.internalWsUrl,
  publicWorkerUrl: config.worker.publicWsUrl,
  publicRuntimeEnv: config.publicRuntimeEnv,
  extraWsHandlers,
  secret: config.secret
});

controlPlane.server.listen(config.control.port, () => {
  const mode = config.singlePort ? 'client + control + match' : 'control-plane + client';
  console.log(`Wave Pong ${mode} listening on ${config.control.origin}`);
});

if (!config.singlePort) {
  const matchWorker = createMatchWorkerApp({
    manager: workerManager
  });
  matchWorker.server.listen(config.worker.port, () => {
    console.log(`Wave Pong match-worker listening on ${config.worker.origin}`);
  });
}
