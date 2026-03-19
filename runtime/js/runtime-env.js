(function (root) {
  if (!root) return;
  const injected = root.__WAVE_PONG_ENV__ || {};
  root.__WAVE_PONG_ENV__ = Object.assign({
  "apiBaseUrl": "http://127.0.0.1:8787",
  "controlWsUrl": "ws://127.0.0.1:8787/ws/control",
  "workerWsUrl": "ws://127.0.0.1:8788/ws/match",
  "enabled": true
}, injected);
})(typeof globalThis !== 'undefined' ? globalThis : this);
