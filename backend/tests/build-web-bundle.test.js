const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const tool = path.join(repoRoot, 'tools', 'build-web-bundle.js');
const runtimeDir = path.join(repoRoot, 'runtime');

function runTool(outDir, extraArgs = []) {
  return spawnSync(process.execPath, [tool, '--out', outDir, ...extraArgs], {
    encoding: 'utf8',
    cwd: repoRoot
  });
}

function tempOut(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wave-pong-${name}-`));
}

test('builds a static bundle that can be served without a backend', () => {
  const outDir = path.join(tempOut('bundle'), 'web');
  try {
    const result = runTool(outDir);
    assert.equal(result.status, 0, result.stderr);

    for (const relative of ['index.html', 'build-info.json', 'js/app.js', 'js/runtime-env.js', 'styles/main.css']) {
      assert.ok(fs.existsSync(path.join(outDir, relative)), `expected ${relative} in the bundle`);
    }

    // The itch.io redirect stub is not useful to a web host serving a directory.
    assert.equal(fs.existsSync(path.join(outDir, 'wave_pong.html')), false);

    const buildInfo = JSON.parse(fs.readFileSync(path.join(outDir, 'build-info.json'), 'utf8'));
    const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'version.json'), 'utf8')).version;
    assert.equal(buildInfo.version, version);

    const env = fs.readFileSync(path.join(outDir, 'js', 'runtime-env.js'), 'utf8');
    assert.match(env, /"enabled": true/);
  } finally {
    fs.rmSync(path.dirname(outDir), { recursive: true, force: true });
  }
});

test('--offline ships a client that never calls a backend', () => {
  const outDir = path.join(tempOut('offline'), 'web');
  try {
    const result = runTool(outDir, ['--offline']);
    assert.equal(result.status, 0, result.stderr);

    const env = fs.readFileSync(path.join(outDir, 'js', 'runtime-env.js'), 'utf8');
    assert.match(env, /"enabled": false/);
    assert.match(env, /"apiBaseUrl": ""/);
  } finally {
    fs.rmSync(path.dirname(outDir), { recursive: true, force: true });
  }
});

test('refuses output paths that overlap the runtime source', () => {
  // The output directory is cleared before copying, so an --out that is the
  // runtime, sits inside it, or contains it would destroy the source or make
  // copyDir recurse into its own destination. Nothing may be deleted first.
  const canary = path.join(runtimeDir, 'index.html');
  const before = fs.readFileSync(canary, 'utf8');

  for (const outDir of [
    runtimeDir,
    path.join(runtimeDir, 'web-build'),
    path.join(runtimeDir, 'js'),
    repoRoot,
    path.join(runtimeDir, 'nested', '..'),
    `${runtimeDir}${path.sep}`
  ]) {
    const result = runTool(outDir);
    assert.notEqual(result.status, 0, `expected a refusal for --out ${outDir}`);
    assert.match(result.stderr, /Refusing to build into/);
    assert.equal(fs.readFileSync(canary, 'utf8'), before, `runtime was modified by --out ${outDir}`);
  }

  assert.ok(fs.existsSync(path.join(runtimeDir, 'js', 'app.js')));
});

test('a sibling directory whose name starts with the runtime path is allowed', () => {
  // A plain string prefix check would reject this: 'runtime-web' starts with
  // 'runtime'. It does not overlap the runtime directory, so it must build.
  const outDir = `${runtimeDir}-web-bundle-test`;
  try {
    const result = runTool(outDir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(outDir, 'index.html')));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('the tool is reachable through the tools package script', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tools', 'package.json'), 'utf8')).scripts;
  assert.equal(scripts['build:web'], 'node build-web-bundle.js');
  execFileSync(process.execPath, ['--check', tool]);
});
