const { loadEnvFiles } = require('./lib/env-loader.js');

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function toWsUrl(value) {
  return trimTrailingSlash(String(value || '').replace(/^http/i, 'ws'));
}

function boolFromEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function buildRuntimeConfig(options = {}) {
  loadEnvFiles();
  const rootPort = parseInteger(process.env.PORT, null);
  const serviceName = options.serviceName || 'wave-pong';
  const defaultControlPort = options.controlPort != null
    ? options.controlPort
    : ((serviceName === 'control-plane' && rootPort != null) ? rootPort : 8787);
  const defaultWorkerPort = options.workerPort != null
    ? options.workerPort
    : ((serviceName === 'match-worker' && rootPort != null) ? rootPort : 8788);
  const controlPort = parseInteger(process.env.WAVE_PONG_CONTROL_PORT, defaultControlPort);
  const workerPort = parseInteger(process.env.WAVE_PONG_WORKER_PORT, defaultWorkerPort);
  const controlHost = process.env.WAVE_PONG_CONTROL_HOST || '127.0.0.1';
  const workerHost = process.env.WAVE_PONG_WORKER_HOST || '127.0.0.1';
  const secret = process.env.WAVE_PONG_SECRET || 'wave-pong-local-secret';
  const apiBaseUrl = trimTrailingSlash(process.env.WAVE_PONG_PUBLIC_API_BASE_URL || `http://${controlHost}:${controlPort}`);
  const controlWsUrl = trimTrailingSlash(process.env.WAVE_PONG_PUBLIC_CONTROL_WS_URL || `${toWsUrl(apiBaseUrl)}/ws/control`);
  const internalWorkerWsUrl = trimTrailingSlash(
    process.env.WAVE_PONG_INTERNAL_WORKER_WS_URL ||
    process.env.WAVE_PONG_WORKER_URL ||
    `ws://${workerHost}:${workerPort}/ws/match`
  );
  const publicWorkerWsUrl = trimTrailingSlash(process.env.WAVE_PONG_PUBLIC_WORKER_WS_URL || internalWorkerWsUrl);
  return {
    serviceName,
    environment: process.env.NODE_ENV || process.env.WAVE_PONG_ENVIRONMENT || 'development',
    secret,
    staticClientOrigin: trimTrailingSlash(process.env.WAVE_PONG_STATIC_CLIENT_ORIGIN || ''),
    databaseUrl: process.env.DATABASE_URL || '',
    redisUrl: process.env.REDIS_URL || '',
    control: {
      host: controlHost,
      port: controlPort,
      origin: `http://${controlHost}:${controlPort}`,
      publicApiBaseUrl: apiBaseUrl,
      publicControlWsUrl: controlWsUrl
    },
    worker: {
      host: workerHost,
      port: workerPort,
      origin: `http://${workerHost}:${workerPort}`,
      internalWsUrl: internalWorkerWsUrl,
      publicWsUrl: publicWorkerWsUrl
    },
    publicRuntimeEnv: {
      apiBaseUrl,
      controlWsUrl,
      workerWsUrl: publicWorkerWsUrl,
      enabled: boolFromEnv(process.env.WAVE_PONG_ONLINE_ENABLED, !!(apiBaseUrl && controlWsUrl))
    }
  };
}

module.exports = {
  buildRuntimeConfig
};
