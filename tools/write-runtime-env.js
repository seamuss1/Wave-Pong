#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, 'runtime', 'js', 'runtime-env.js');
const { buildRuntimeConfig } = require(path.join(repoRoot, 'backend', 'config.js'));

const config = buildRuntimeConfig({
  serviceName: 'runtime-env-writer'
});

const runtimeEnv = {
  apiBaseUrl: config.publicRuntimeEnv.apiBaseUrl,
  controlWsUrl: config.publicRuntimeEnv.controlWsUrl,
  workerWsUrl: config.publicRuntimeEnv.workerWsUrl,
  enabled: config.publicRuntimeEnv.enabled
};

const contents = `(function (root) {
  if (!root) return;
  const injected = root.__WAVE_PONG_ENV__ || {};
  root.__WAVE_PONG_ENV__ = Object.assign(${JSON.stringify(runtimeEnv, null, 2)}, injected);
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

fs.writeFileSync(outputPath, contents, 'utf8');
process.stdout.write(`${outputPath}\n`);
