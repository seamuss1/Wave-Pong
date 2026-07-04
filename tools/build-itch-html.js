#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeDir = path.join(repoRoot, 'runtime');
const outputDir = path.join(repoRoot, 'itch-build');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

function replaceExact(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Could not find ${label} while building the itch.io HTML artifact.`);
  }
  return source.replace(search, replacement);
}

function escapeInlineScript(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

const htmlPath = path.join(runtimeDir, 'index.html');
const cssPath = path.join(runtimeDir, 'styles', 'main.css');
const legacyPath = path.join(runtimeDir, 'wave_pong.html');
const versionPath = path.join(repoRoot, 'version.json');

let html = read(htmlPath);
const css = read(cssPath);
const legacyHtml = read(legacyPath);
const versionJson = read(versionPath);

html = replaceExact(
  html,
  '<link rel="stylesheet" href="./styles/main.css" />',
  `<style>\n${css}\n</style>`,
  'the stylesheet link tag'
);

// itch.io serves games over https, so the checked-in runtime-env.js (which may point
// at a plain-http LAN backend) would only produce mixed-content errors there. Ship
// the itch build with online disabled unless ITCH_RUNTIME_ENV_JSON provides an
// https/wss endpoint config.
function buildItchRuntimeEnv() {
  const overrides = process.env.ITCH_RUNTIME_ENV_JSON;
  const env = overrides
    ? JSON.parse(overrides)
    : { apiBaseUrl: '', controlWsUrl: '', workerWsUrl: '', enabled: false };
  return [
    '(function (root) {',
    '  if (!root) return;',
    '  const injected = root.__WAVE_PONG_ENV__ || {};',
    `  root.__WAVE_PONG_ENV__ = Object.assign(${JSON.stringify(env, null, 2)}, injected);`,
    "})(typeof globalThis !== 'undefined' ? globalThis : this);",
    ''
  ].join('\n');
}

const runtimeScriptTagPattern = /^\s*<script src="\.\/*js\/([^"]+)"><\/script>\s*$/gm;
if (!runtimeScriptTagPattern.test(html)) {
  throw new Error('Could not find the runtime script tags while building the itch.io HTML artifact.');
}
runtimeScriptTagPattern.lastIndex = 0;
html = html.replace(runtimeScriptTagPattern, (match, scriptName) => {
  const scriptContents = scriptName === 'runtime-env.js'
    ? buildItchRuntimeEnv()
    : read(path.join(runtimeDir, 'js', scriptName));
  return `  <script>\n${escapeInlineScript(scriptContents)}\n</script>`;
});

write(path.join(outputDir, 'index.html'), html);
write(path.join(outputDir, 'wave_pong.html'), legacyHtml);
write(path.join(outputDir, 'version.json'), versionJson);

console.log(
  JSON.stringify(
    {
      outputDir,
      files: ['index.html', 'wave_pong.html', 'version.json']
    },
    null,
    2
  )
);
