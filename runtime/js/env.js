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
  function normalizeUrl(value) {
    return String(value || '').replace(/\/+$/, '');
  }
  function readParam(searchParams, names) {
    for (const name of names) {
      const value = searchParams.get(name);
      if (value) return value;
    }
    return '';
  }
  const searchParams = (() => {
    try {
      return new URLSearchParams((win && win.location && win.location.search) || '');
    } catch (error) {
      return new URLSearchParams('');
    }
  })();
  const injected = (root && root.__WAVE_PONG_ENV__) || {};
  const apiBaseUrl = normalizeUrl(readParam(searchParams, ['api', 'apiBaseUrl']) || injected.apiBaseUrl || '');
  const controlWsUrl = normalizeUrl(readParam(searchParams, ['controlWs', 'controlWsUrl']) || injected.controlWsUrl || '');
  const workerWsUrl = normalizeUrl(readParam(searchParams, ['workerWs', 'workerWsUrl']) || injected.workerWsUrl || '');
  const enabled = typeof injected.enabled === 'boolean'
    ? injected.enabled && !!(apiBaseUrl && controlWsUrl)
    : !!(apiBaseUrl && controlWsUrl);
  return {
    apiBaseUrl,
    controlWsUrl,
    workerWsUrl,
    enabled
  };
});
