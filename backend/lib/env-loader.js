const fs = require('fs');
const path = require('path');

let loaded = false;
let loadedFiles = [];

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function applyEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const contents = fs.readFileSync(filePath, 'utf8');
  const lines = contents.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = parseEnvValue(value);
    }
  }
  loadedFiles.push(filePath);
  return true;
}

function loadEnvFiles() {
  if (loaded) {
    return loadedFiles.slice();
  }
  loaded = true;
  loadedFiles = [];
  const repoRoot = path.resolve(__dirname, '..', '..');
  const backendRoot = path.resolve(__dirname, '..');
  const candidates = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, '.env.local'),
    path.join(backendRoot, '.env'),
    path.join(backendRoot, '.env.local')
  ];
  for (const filePath of candidates) {
    applyEnvFile(filePath);
  }
  return loadedFiles.slice();
}

module.exports = {
  loadEnvFiles
};
