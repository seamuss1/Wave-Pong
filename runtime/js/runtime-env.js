(function (root) {
  if (!root) return;
  const injected = root.__WAVE_PONG_ENV__ || {};
  root.__WAVE_PONG_ENV__ = Object.assign({
  "apiBaseUrl": "https://wave-pong.seamusgallagher.org",
  "controlWsUrl": "wss://wave-pong.seamusgallagher.org/ws/control",
  "workerWsUrl": "wss://wave-pong.seamusgallagher.org/ws/match",
  "enabled": true
}, injected);
})(typeof globalThis !== 'undefined' ? globalThis : this);
