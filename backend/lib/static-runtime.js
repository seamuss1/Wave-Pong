const fs = require('fs');
const path = require('path');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

// Serves the static browser runtime from the repo's runtime/ directory, with
// /js/runtime-env.js generated from config so the client connects back to this host.
function createRuntimeStaticHandler(options) {
  const runtimeDir = path.resolve(options.runtimeDir);
  const publicRuntimeEnv = options.publicRuntimeEnv || {};

  function buildRuntimeEnvScript() {
    return [
      '(function (root) {',
      '  if (!root) return;',
      '  const injected = root.__WAVE_PONG_ENV__ || {};',
      `  root.__WAVE_PONG_ENV__ = Object.assign(${JSON.stringify(publicRuntimeEnv, null, 2)}, injected);`,
      "})(typeof globalThis !== 'undefined' ? globalThis : this);",
      ''
    ].join('\n');
  }

  return function handleStaticRequest(req, res, pathname) {
    if (req.method !== 'GET') return false;
    let target = pathname === '/' ? '/index.html' : pathname;
    if (target === '/js/runtime-env.js') {
      const body = buildRuntimeEnvScript();
      res.writeHead(200, { 'content-type': CONTENT_TYPES['.js'], 'cache-control': 'no-store' });
      res.end(body);
      return true;
    }
    const filePath = path.join(runtimeDir, path.normalize(target));
    if (!filePath.startsWith(runtimeDir)) return false; // path traversal guard
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (error) {
      return false;
    }
    if (!stat.isFile()) return false;
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
    return true;
  };
}

module.exports = {
  createRuntimeStaticHandler
};
