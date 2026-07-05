const { createControlPlaneApp } = require('./control-plane/app.js');
const { createMatchWorkerManager } = require('./match-worker/manager.js');
const { createMatchWorkerApp, createMatchConnectionHandler } = require('./match-worker/app.js');
const { buildRuntimeConfig } = require('./config.js');
const { createMetricsCollector } = require('./lib/metrics.js');
const protocol = require('../shared/protocol/index.js');

const config = buildRuntimeConfig({
  serviceName: 'wave-pong'
});

const metrics = createMetricsCollector({
  enabled: config.metrics.enabled,
  filePath: config.metrics.filePath
});
if (metrics.enabled) {
  console.log(`Wave Pong metrics persisting to ${config.metrics.filePath}`);
}

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
  secret: config.secret,
  metrics,
  metricsToken: config.metrics.token
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

// Persist any buffered metrics on the way out. systemd sends SIGTERM on
// restart/deploy; flush there (and on Ctrl+C locally) so the final counts are
// not lost. beforeExit covers a clean, self-driven exit.
let shuttingDown = false;
function shutdownMetrics(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    metrics.stop();
  } catch (error) {
    console.warn(`[metrics] Error during shutdown flush: ${error.message}`);
  }
  if (signal) {
    process.exit(0);
  }
}
process.on('SIGTERM', () => shutdownMetrics('SIGTERM'));
process.on('SIGINT', () => shutdownMetrics('SIGINT'));
process.on('beforeExit', () => shutdownMetrics(null));
