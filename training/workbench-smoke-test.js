#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_TARGET = 'http://127.0.0.1:8936/training/workbench/index.html';
const REPO_ROOT = path.resolve(__dirname, '..');
const TRAINING_ROOT = path.join(REPO_ROOT, 'training');
const SERVER_SCRIPT = path.join(TRAINING_ROOT, 'workbench', 'server.js');
const REVIEW_RATINGS_PATH = path.join(TRAINING_ROOT, 'reports', 'review-ratings.json');

function parseArgs(argv) {
  const args = {
    target: DEFAULT_TARGET,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    browser: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target' && argv[index + 1]) args.target = argv[++index];
    else if (arg.startsWith('--target=')) args.target = arg.slice('--target='.length);
    else if (arg === '--timeout-ms' && argv[index + 1]) args.timeoutMs = Number(argv[++index]);
    else if (arg.startsWith('--timeout-ms=')) args.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    else if (arg === '--browser' && argv[index + 1]) args.browser = argv[++index];
    else if (arg.startsWith('--browser=')) args.browser = arg.slice('--browser='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms value: ${args.timeoutMs}`);
  }

  return args;
}

function resolveBrowserPath(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.BROWSER_BIN,
    process.env.CHROME_BIN,
    process.env.EDGE_BIN,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('No supported Chromium browser was found. Pass --browser or set BROWSER_BIN.');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError ? lastError.message : 'no response'}`);
}

async function backupRatingsFile() {
  try {
    return await fsp.readFile(REVIEW_RATINGS_PATH, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function restoreRatingsFile(previousContent) {
  if (previousContent == null) {
    await fsp.rm(REVIEW_RATINGS_PATH, { force: true });
    return;
  }
  await fsp.mkdir(path.dirname(REVIEW_RATINGS_PATH), { recursive: true });
  await fsp.writeFile(REVIEW_RATINGS_PATH, previousContent, 'utf8');
}

async function startServerIfNeeded(origin, timeoutMs) {
  const stateUrl = `${origin}/api/state`;
  try {
    await fetchJson(stateUrl);
    return { child: null, started: false };
  } catch (error) {
    const port = Number(new URL(origin).port || 8936);
    const child = spawn(process.execPath, [SERVER_SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        WAVE_PONG_WORKBENCH_PORT: String(port)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    await waitForHttp(stateUrl, timeoutMs);
    return { child, started: true };
  }
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3000)
  ]);
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function extractTick(page) {
  const text = await page.locator('#replayTickLabel').textContent();
  const match = String(text || '').match(/tick\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browserPath = resolveBrowserPath(args.browser);
  const targetUrl = new URL(args.target);
  const origin = `${targetUrl.protocol}//${targetUrl.hostname}:${targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80')}`;
  const ratingsBackup = await backupRatingsFile();

  let server = null;
  let browser = null;

  try {
    const serverState = await startServerIfNeeded(origin, args.timeoutMs);
    server = serverState.child;

    const apiState = await fetchJson(`${origin}/api/state`);
    const run = (apiState.recentRuns || []).find((entry) => Number(entry.replayCount || 0) > 0);
    if (!run) {
      throw new Error('No recent workbench run exposes replay bundles, so the workbench smoke test cannot verify replay functionality.');
    }

    browser = await chromium.launch({
      executablePath: browserPath,
      headless: true,
      args: [
        '--disable-gpu',
        '--allow-file-access-from-files',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });

    const page = await browser.newPage({
      viewport: { width: 1600, height: 1400 }
    });

    await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
    await page.waitForSelector('#runList', { timeout: args.timeoutMs });
    await page.waitForFunction(() => {
      const text = document.getElementById('serverStatus').textContent || '';
      return !/offline/i.test(text);
    }, { timeout: args.timeoutMs });

    const runButton = page.locator(`[data-run-id="${run.runId}"]`).first();
    await runButton.click();

    const replayButtons = page.locator('#replayList [data-replay-id]');
    await replayButtons.first().waitFor({ state: 'visible', timeout: args.timeoutMs });
    const replayId = await replayButtons.first().getAttribute('data-replay-id');
    if (!replayId) throw new Error('Replay queue did not expose a replay id.');

    await replayButtons.first().click();
    await page.waitForFunction(() => {
      const empty = document.getElementById('replayEmpty');
      const meta = document.getElementById('replayMeta');
      return empty && meta && empty.classList.contains('hidden') && meta.textContent.trim().length > 0;
    }, { timeout: args.timeoutMs });

    const tickBefore = await extractTick(page);
    await page.click('#replayPlayPauseButton');
    await page.waitForFunction((startTick) => {
      const text = document.getElementById('replayTickLabel').textContent || '';
      const match = text.match(/tick\s+(\d+)/i);
      return match && Number(match[1]) > startTick;
    }, tickBefore, { timeout: 10000 });
    const tickAfter = await extractTick(page);
    await page.click('#replayPlayPauseButton');

    await page.click('#renderClipButton');
    await page.waitForFunction(() => {
      const button = document.getElementById('renderClipButton');
      return button && !button.disabled && button.textContent !== 'Rendering...';
    }, { timeout: args.timeoutMs });

    await page.click('#clipReplayTab');
    await page.waitForFunction(() => {
      const player = document.getElementById('clipPlayer');
      return !!player && player.readyState >= 1 && Number.isFinite(player.duration) && player.duration > 0;
    }, { timeout: args.timeoutMs });
    const clipDuration = await page.$eval('#clipPlayer', (player) => player.duration);

    const note = `playwright smoke ${Date.now()}`;
    await page.selectOption('#decisionInput', 'accept');
    await page.fill('#notesInput', note);
    await page.click('#saveReplayRatingButton');
    await page.waitForFunction(() => {
      const text = document.getElementById('ratingsStatus').textContent || '';
      return /saved|cached/i.test(text);
    }, { timeout: args.timeoutMs });

    const ratingsPayload = JSON.parse(await fsp.readFile(REVIEW_RATINGS_PATH, 'utf8'));
    const savedItem = (ratingsPayload.items || []).find((item) => item.replayId === replayId);
    if (!savedItem || savedItem.notes !== note || savedItem.decision !== 'accept') {
      throw new Error('Saving a replay review did not persist the expected rating payload.');
    }

    console.log(JSON.stringify({
      browserPath,
      serverStartedByTest: serverState.started,
      runId: run.runId,
      replayId,
      tickBefore,
      tickAfter,
      clipDuration,
      ratingDecision: savedItem.decision
    }, null, 2));
  } finally {
    await restoreRatingsFile(ratingsBackup);
    if (browser) await browser.close();
    await stopChild(server);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
