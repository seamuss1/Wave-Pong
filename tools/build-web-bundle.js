#!/usr/bin/env node

// Builds a self-contained copy of the browser runtime for hosting the game on
// any static web server (a personal site, S3, nginx) instead of an itch.io
// iframe. Unlike tools/build-itch-html.js, this keeps the runtime as separate
// files so the host can cache and compress them normally.
//
//   node tools/build-web-bundle.js --out ../portfolio/public/games/wave-pong
//   node tools/build-web-bundle.js --api https://wave-pong.example.org
//   node tools/build-web-bundle.js --offline        # single/local play only
//
// The bundle is static: single player, local two-player, and the bot roster
// work with no backend. Online play calls the backend at --api cross-origin
// (the control plane sends permissive CORS headers) and the client shows an
// "online is offline" notice when that host is unreachable.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeDir = path.join(repoRoot, 'runtime');

const DEFAULT_API_BASE = process.env.WAVE_PONG_PUBLIC_URL || 'https://wave-pong.seamusgallagher.org';

// The itch.io build ships a redirect stub for its historical entry point; a web
// host serves the directory index directly and does not need it.
const SKIP_FILES = new Set(['wave_pong.html']);

function parseArgs(argv) {
  const args = { out: path.join(repoRoot, 'web-build'), api: DEFAULT_API_BASE, offline: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--offline') {
      args.offline = true;
    } else if (arg === '--out' || arg === '--api') {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} needs a value.`);
      args[arg.slice(2)] = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  args.out = path.resolve(args.out);
  args.api = String(args.api).replace(/\/+$/, '');
  return args;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_FILES.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, destination);
    else fs.copyFileSync(source, destination);
  }
}

function buildRuntimeEnv(args) {
  if (args.offline || !args.api) {
    return { apiBaseUrl: '', controlWsUrl: '', workerWsUrl: '', enabled: false };
  }
  const wsBase = args.api.replace(/^http/, 'ws');
  return {
    apiBaseUrl: args.api,
    controlWsUrl: `${wsBase}/ws/control`,
    workerWsUrl: `${wsBase}/ws/match`,
    enabled: true
  };
}

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, 'version.json'), 'utf8')).version;
  } catch (error) {
    return 'unknown';
  }
}

function readCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch (error) {
    return 'unknown';
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(runtimeDir)) {
    throw new Error(`Expected the runtime at ${runtimeDir}.`);
  }
  if (args.out === repoRoot || runtimeDir.startsWith(`${args.out}${path.sep}`)) {
    throw new Error(`Refusing to build into ${args.out}: it would delete the repo or the runtime.`);
  }

  fs.rmSync(args.out, { recursive: true, force: true });
  copyDir(runtimeDir, args.out);

  const runtimeEnv = buildRuntimeEnv(args);
  fs.writeFileSync(
    path.join(args.out, 'js', 'runtime-env.js'),
    `(function (root) {
  if (!root) return;
  const injected = root.__WAVE_PONG_ENV__ || {};
  root.__WAVE_PONG_ENV__ = Object.assign(${JSON.stringify(runtimeEnv, null, 2)}, injected);
})(typeof globalThis !== 'undefined' ? globalThis : this);
`,
    'utf8'
  );

  const version = readVersion();
  const buildInfo = {
    source: 'https://github.com/seamuss1/Wave-Pong',
    commit: readCommit(),
    version
  };
  fs.writeFileSync(path.join(args.out, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        outputDir: args.out,
        version,
        online: runtimeEnv.enabled ? runtimeEnv.apiBaseUrl : 'disabled'
      },
      null,
      2
    )
  );
}

main();
