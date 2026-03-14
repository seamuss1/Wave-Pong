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

function replacePattern(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Could not find ${label} while building the itch.io HTML artifact.`);
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function escapeInlineScript(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

const htmlPath = path.join(runtimeDir, 'index.html');
const cssPath = path.join(runtimeDir, 'styles', 'main.css');
const versionJsPath = path.join(runtimeDir, 'js', 'version.js');
const configPath = path.join(runtimeDir, 'js', 'config.js');
const appPath = path.join(runtimeDir, 'js', 'app.js');
const legacyPath = path.join(runtimeDir, 'wave_pong.html');
const versionPath = path.join(repoRoot, 'version.json');

let html = read(htmlPath);
const css = read(cssPath);
const versionJs = read(versionJsPath);
const configJs = read(configPath);
const appJs = read(appPath);
const legacyHtml = read(legacyPath);
const versionJson = read(versionPath);

html = replaceExact(
  html,
  '<link rel="stylesheet" href="./styles/main.css" />',
  `<style>\n${css}\n</style>`,
  'the stylesheet link tag'
);

html = replacePattern(
  html,
  /^\s*<script src="\.\/*js\/version\.js"><\/script>\s*\r?\n\s*<script src="\.\/*js\/config\.js"><\/script>\s*\r?\n\s*<script src="\.\/*js\/app\.js"><\/script>/m,
  `  <script>\n${escapeInlineScript(versionJs)}\n</script>\n  <script>\n${escapeInlineScript(configJs)}\n</script>\n  <script>\n${escapeInlineScript(appJs)}\n</script>`,
  'the runtime script tags'
);

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
