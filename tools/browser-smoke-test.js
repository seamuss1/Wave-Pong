#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs/promises');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const DEFAULT_TIMEOUT_MS = 8000;
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    target: 'runtime/index.html',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    browser: null,
    attachPort: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target' && argv[i + 1]) {
      args.target = argv[++i];
    } else if (arg.startsWith('--target=')) {
      args.target = arg.slice('--target='.length);
    } else if (arg === '--timeout-ms' && argv[i + 1]) {
      args.timeoutMs = Number(argv[++i]);
    } else if (arg.startsWith('--timeout-ms=')) {
      args.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else if (arg === '--browser' && argv[i + 1]) {
      args.browser = argv[++i];
    } else if (arg.startsWith('--browser=')) {
      args.browser = arg.slice('--browser='.length);
    } else if (arg === '--attach-port' && argv[i + 1]) {
      args.attachPort = Number(argv[++i]);
    } else if (arg.startsWith('--attach-port=')) {
      args.attachPort = Number(arg.slice('--attach-port='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms value: ${args.timeoutMs}`);
  }

  if (args.attachPort !== null && (!Number.isFinite(args.attachPort) || args.attachPort <= 0)) {
    throw new Error(`Invalid --attach-port value: ${args.attachPort}`);
  }

  return args;
}

function resolveTargetUrl(target) {
  if (/^(https?|file):/i.test(target)) {
    return target;
  }
  const resolved = path.resolve(REPO_ROOT, target);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Target file does not exist: ${resolved}`);
  }
  return pathToFileURL(resolved).href;
}

function findBrowser(explicitBrowser) {
  const candidates = [
    explicitBrowser,
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
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('No supported Chromium browser was found. Pass --browser or set BROWSER_BIN.');
}

function formatLaunchError(error) {
  if (process.platform === 'win32' && error && error.code === 'EPERM') {
    return new Error(
      'Browser launch was blocked with EPERM. On Windows, use tools/browser-smoke-test.ps1 or npm run smoke so the browser is launched through PowerShell.'
    );
  }
  return error;
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to reserve a TCP port.'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function waitForDebuggerTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const pageTarget = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (pageTarget) {
        return pageTarget;
      }
    } catch (error) {
      // Browser is still starting.
    }
    await sleep(200);
  }

  throw new Error('DevTools page target did not become available before timeout.');
}

async function runDevToolsSmoke(pageWebSocketUrl, targetUrl, timeoutMs) {
  const ws = new WebSocket(pageWebSocketUrl);
  let nextId = 0;
  const pending = new Map();
  const consoleMessages = [];
  const exceptions = [];
  let loaded = false;

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const callback = pending.get(message.id);
      if (!callback) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        callback.reject(new Error(message.error.message));
      } else {
        callback.resolve(message.result);
      }
      return;
    }

    if (message.method === 'Runtime.consoleAPICalled') {
      consoleMessages.push({
        source: 'console',
        type: message.params.type,
        text: message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')
      });
    }

    if (message.method === 'Log.entryAdded') {
      consoleMessages.push({
        source: 'log',
        type: message.params.entry.level,
        text: message.params.entry.text
      });
    }

    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push({
        text: message.params.exceptionDetails.text,
        lineNumber: message.params.exceptionDetails.lineNumber,
        columnNumber: message.params.exceptionDetails.columnNumber,
        url: message.params.exceptionDetails.url
      });
    }

    if (message.method === 'Page.loadEventFired') {
      loaded = true;
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.navigate', { url: targetUrl });

  const deadline = Date.now() + timeoutMs;
  while (!loaded && Date.now() < deadline) {
    await sleep(100);
  }

  await sleep(1000);

  const evaluation = await send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const runtime = window.WavePong && window.WavePong.RUNTIME;
      const controllers = window.WavePong && window.WavePong.Controllers;
      const result = {
        title: document.title,
        canvasPresent: !!document.getElementById('gameCanvas'),
        overlayCount: document.querySelectorAll('.overlay').length,
        menuVisible: !document.getElementById('menuOverlay').classList.contains('hidden'),
        pauseVisible: !document.getElementById('pauseOverlay').classList.contains('hidden'),
        gameOverVisible: !document.getElementById('gameOverOverlay').classList.contains('hidden'),
        messageText: document.getElementById('message')?.textContent,
        wavePongConfigPresent: !!(window.WavePong && window.WavePong.CONFIG),
        leftScore: document.getElementById('leftScore')?.textContent,
        rightScore: document.getElementById('rightScore')?.textContent,
        trainingChecks: null
      };

      if (!runtime || !controllers || typeof runtime.clearStoredTrainingSessions !== 'function') {
        return result;
      }

      function selectCurrentBot() {
        const select = runtime.ui && runtime.ui.difficultySelect;
        if (!select || select.selectedIndex < 0) return null;
        return {
          id: select.value,
          name: select.options[select.selectedIndex].textContent
        };
      }

      function forceLeftGoalToEndMatch() {
        runtime.state.leftScore = Math.max(0, runtime.state.scoreLimit - 1);
        const ball = runtime.world.balls[0];
        if (!ball) return false;
        ball.x = runtime.config.balance.canvas.width + ball.r + 24;
        runtime.stepSimulation(1);
        return true;
      }

      runtime.clearStoredTrainingSessions();
      let captureListenerCount = 0;
      if (typeof runtime.onTrainingSessionCaptured === 'function') {
        runtime.onTrainingSessionCaptured(() => {
          captureListenerCount += 1;
        });
      }
      const selectedBot = selectCurrentBot();
      if (selectedBot && typeof runtime.setTrainingContext === 'function') {
        runtime.setTrainingContext({
          selectedBotId: selectedBot.id,
          selectedBotName: selectedBot.name
        });
      }

      runtime.startMatch({ demo: false, skipCountdown: true });
      forceLeftGoalToEndMatch();
      const cpuExport = typeof runtime.buildTrainingExport === 'function' ? runtime.buildTrainingExport() : null;
      const cpuSessionCount = typeof runtime.getStoredTrainingSessions === 'function' ? runtime.getStoredTrainingSessions().length : 0;
      const trainingSection = document.getElementById('trainingCaptureSection');
      const trainingButtonsPresent = !!document.getElementById('downloadTrainingBtn') && !!document.getElementById('clearTrainingBtn');
      const trainingStatusText = document.getElementById('trainingCaptureStatus')?.textContent || '';
      const repoButtonsPresent = !!document.getElementById('connectRepoTrainingBtn') && !!document.getElementById('disconnectRepoTrainingBtn');
      const repoStatusText = document.getElementById('trainingRepoStatus')?.textContent || '';
      runtime.world.powerups.push({
        type: 'grow',
        x: runtime.config.balance.canvas.width * 0.5,
        y: runtime.config.balance.canvas.height * 0.5,
        r: runtime.config.balance.powerups.spawn.standardRadius,
        life: runtime.config.balance.powerups.spawn.standardLifeSeconds
      });
      const observedState = typeof runtime.getObservation === 'function' ? runtime.getObservation('left') : null;
      const observedPowerup = observedState && observedState.powerups ? observedState.powerups[0] : null;
      const observationVectorSize = observedState ? controllers.flattenObservation(observedState).length : null;
      const expectedObservationVectorSize = typeof controllers.getObservationVectorSize === 'function'
        ? controllers.getObservationVectorSize()
        : null;
      runtime.world.powerups.length = 0;

      runtime.clearStoredTrainingSessions();
      runtime.startMatch({ demo: true, skipCountdown: true });
      forceLeftGoalToEndMatch();
      const demoSessionCount = runtime.getStoredTrainingSessions().length;

      runtime.clearStoredTrainingSessions();
      runtime.setControllers({ left: null, right: null });
      runtime.startMatch({ mode: 'pvp', skipCountdown: true, leftController: null, rightController: null });
      forceLeftGoalToEndMatch();
      const pvpSessionCount = runtime.getStoredTrainingSessions().length;

      result.trainingChecks = {
        sectionVisible: !!trainingSection && !trainingSection.classList.contains('hidden'),
        buttonsPresent: trainingButtonsPresent,
        statusText: trainingStatusText,
        repoButtonsPresent,
        repoStatusText,
        observationVectorSize,
        expectedObservationVectorSize,
        xpFieldsPresent: !!(observedState && observedState.self && observedState.opponent &&
          typeof observedState.self.xpProgress === 'number' &&
          typeof observedState.opponent.xpProgress === 'number'),
        powerupTypeId: observedPowerup ? observedPowerup.typeId : null,
        powerupTypeIdNormalized: observedPowerup ? observedPowerup.typeIdNormalized : null,
        cpuSessionCount,
        cpuExportSchema: cpuExport && cpuExport.schema ? cpuExport.schema : null,
        captureListenerCount,
        demoSessionCount,
        pvpSessionCount,
        finalGameOverVisible: !document.getElementById('gameOverOverlay').classList.contains('hidden')
      };
      return result;
    })())`,
    returnByValue: true
  });

  const pageState = JSON.parse(evaluation.result.value);
  ws.close();

  return {
    loaded,
    exceptions,
    consoleMessages,
    pageState
  };
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  try {
    child.kill('SIGKILL');
  } catch (error) {
    // Process already exited.
  }
}

function waitForChildExit(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function removeDirWithRetries(dir, attempts = 12, delayMs = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fsp.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const retryable = error && ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code);
      if (!retryable || attempt === attempts - 1) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetUrl = resolveTargetUrl(args.target);
  const attachedBrowser = args.attachPort !== null;
  const browserPath = args.browser || (attachedBrowser ? 'attached-browser' : findBrowser(args.browser));
  const port = attachedBrowser ? args.attachPort : await reservePort();
  const profileDir = attachedBrowser ? null : await fsp.mkdtemp(path.join(os.tmpdir(), 'wave-pong-smoke-'));

  let browser = null;
  let stderrBuffer = '';
  let shuttingDown = false;
  let profileRemoved = false;

  function cleanupSync() {
    killProcessTree(browser);
    if (profileRemoved || !profileDir) {
      return;
    }
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
      profileRemoved = true;
    } catch (error) {
      // Best-effort cleanup during process exit.
    }
  }

  async function cleanup() {
    killProcessTree(browser);
    if (!profileRemoved && profileDir) {
      await waitForChildExit(browser);
      await removeDirWithRetries(profileDir);
      profileRemoved = true;
    }
  }

  process.on('exit', cleanupSync);

  async function shutdown(error, exitCode) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    if (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }

    await cleanup();
    process.exit(exitCode);
  }

  process.on('SIGINT', () => {
    shutdown(new Error('Smoke test interrupted.'), 130).catch((error) => {
      console.error(error);
      process.exit(130);
    });
  });

  process.on('SIGTERM', () => {
    shutdown(new Error('Smoke test terminated.'), 143).catch((error) => {
      console.error(error);
      process.exit(143);
    });
  });

  process.on('uncaughtException', (error) => {
    shutdown(error, 1).catch((cleanupError) => {
      console.error(cleanupError);
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (error) => {
    shutdown(error, 1).catch((cleanupError) => {
      console.error(cleanupError);
      process.exit(1);
    });
  });

  try {
    if (!attachedBrowser) {
      try {
        browser = spawn(browserPath, [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--allow-file-access-from-files',
          '--remote-allow-origins=*',
          `--remote-debugging-port=${port}`,
          `--user-data-dir=${profileDir}`,
          'about:blank'
        ], {
          stdio: ['ignore', 'ignore', 'pipe']
        });
      } catch (error) {
        throw formatLaunchError(error);
      }

      browser.stderr.setEncoding('utf8');
      browser.stderr.on('data', (chunk) => {
        stderrBuffer += chunk;
        if (stderrBuffer.length > 4000) {
          stderrBuffer = stderrBuffer.slice(-4000);
        }
      });
    }

    const pageTarget = await waitForDebuggerTarget(port, args.timeoutMs);
    const result = await runDevToolsSmoke(pageTarget.webSocketDebuggerUrl, targetUrl, args.timeoutMs);

    const summary = {
      browserPath,
      targetUrl,
      result
    };

    if (stderrBuffer.trim()) {
      summary.browserStderrTail = stderrBuffer.trim().split(/\r?\n/).slice(-20);
    }

    console.log(JSON.stringify(summary, null, 2));

    const trainingChecks = result.pageState.trainingChecks || {};
    const passed = result.loaded &&
      result.pageState.canvasPresent &&
      result.pageState.wavePongConfigPresent &&
      result.exceptions.length === 0 &&
      trainingChecks.sectionVisible === true &&
      trainingChecks.buttonsPresent === true &&
      trainingChecks.repoButtonsPresent === true &&
      typeof trainingChecks.repoStatusText === 'string' &&
      trainingChecks.repoStatusText.length > 0 &&
      trainingChecks.xpFieldsPresent === true &&
      trainingChecks.powerupTypeId === 1 &&
      typeof trainingChecks.powerupTypeIdNormalized === 'number' &&
      trainingChecks.powerupTypeIdNormalized > 0 &&
      trainingChecks.observationVectorSize === trainingChecks.expectedObservationVectorSize &&
      trainingChecks.cpuSessionCount === 1 &&
      trainingChecks.cpuExportSchema === 'human-training-export/v1' &&
      trainingChecks.captureListenerCount === 1 &&
      trainingChecks.demoSessionCount === 0 &&
      trainingChecks.pvpSessionCount === 0 &&
      trainingChecks.finalGameOverVisible === true;
    await cleanup();
    process.exit(passed ? 0 : 1);
  } catch (error) {
    if (stderrBuffer.trim()) {
      console.error(stderrBuffer.trim().split(/\r?\n/).slice(-20).join('\n'));
    }
    await cleanup();
    throw error;
  }
}

main();
