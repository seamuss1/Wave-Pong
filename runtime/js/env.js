(function (root, factory) {
  const env = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = env;
  }
  if (root) {
    root.WavePong = root.WavePong || {};
    root.WavePong.ENV = env;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const win = root && root.window ? root.window : root;
  const searchParams = (() => {
    try {
      return new URLSearchParams((win && win.location && win.location.search) || '');
    } catch (error) {
      return new URLSearchParams('');
    }
  })();
  const injected = (root && root.__WAVE_PONG_ENV__) || {};
  const apiBaseUrl = searchParams.get('api') || injected.apiBaseUrl || '';
  const controlWsUrl = searchParams.get('controlWs') || injected.controlWsUrl || '';
  const workerWsUrl = searchParams.get('workerWs') || injected.workerWsUrl || '';
  const enabled = !!(apiBaseUrl && controlWsUrl);
  return {
    apiBaseUrl,
    controlWsUrl,
    workerWsUrl,
    enabled
  };
});
