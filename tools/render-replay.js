#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    replay: null,
    output: null,
    browser: null,
    fps: 60,
    width: 1920,
    height: 1080
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--replay' && argv[i + 1]) args.replay = path.resolve(argv[++i]);
    else if (arg === '--output' && argv[i + 1]) args.output = path.resolve(argv[++i]);
    else if (arg === '--browser' && argv[i + 1]) args.browser = argv[++i];
    else if (arg === '--fps' && argv[i + 1]) args.fps = Number(argv[++i]);
    else if (arg === '--width' && argv[i + 1]) args.width = Number(argv[++i]);
    else if (arg === '--height' && argv[i + 1]) args.height = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.replay) throw new Error('Missing required --replay path.');
  if (!args.output) args.output = path.resolve(path.dirname(args.replay), path.basename(args.replay, '.json') + '.webm');
  return args;
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
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('No Chromium browser found. Pass --browser or set BROWSER_BIN.');
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function waitForPageTarget(port) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch (error) {
      // Browser is still starting.
    }
    await sleep(200);
  }
  throw new Error('Timed out waiting for a DevTools page target.');
}

async function openDevToolsSocket(pageWebSocketUrl) {
  const ws = new WebSocket(pageWebSocketUrl);
  let nextId = 0;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  return { ws, send };
}

function escapePowerShell(value) {
  return String(value).replace(/'/g, "''");
}

async function launchBrowser(browser, args) {
  if (process.platform !== 'win32') {
    const child = spawn(browser, args, { stdio: 'ignore' });
    return {
      child,
      async dispose() {
        child.kill('SIGKILL');
      }
    };
  }

  const argsList = args.map((arg) => `'${escapePowerShell(arg)}'`).join(', ');
  const browserPath = escapePowerShell(browser);
  const pid = await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      `$proc = Start-Process -FilePath '${browserPath}' -ArgumentList @(${argsList}) -PassThru -WindowStyle Hidden; Write-Output $proc.Id`
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `PowerShell browser launch failed with code ${code}`));
        return;
      }
      const value = Number(stdout.trim());
      if (!Number.isFinite(value) || value <= 0) {
        reject(new Error(`Unable to determine launched browser PID. Output: ${stdout}`));
        return;
      }
      resolve(value);
    });
  });

  return {
    pid,
    async dispose() {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        // Ignore cleanup races.
      }
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = findBrowser(args.browser);
  const port = await reservePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-pong-replay-'));
  const renderUrl = pathToFileURL(path.join(repoRoot, 'tools', 'replay-render.html')).href;
  const replayBundle = JSON.parse(fs.readFileSync(args.replay, 'utf8'));

  const browserHandle = await launchBrowser(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--remote-allow-origins=*',
    '--remote-debugging-address=127.0.0.1',
    `--window-size=${args.width},${args.height}`,
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    renderUrl
  ]);

  try {
    const page = await waitForPageTarget(port);
    const { ws, send } = await openDevToolsSocket(page.webSocketDebuggerUrl);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: renderUrl });
    await sleep(1500);

    const bundleLiteral = JSON.stringify(replayBundle).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const renderResult = await send('Runtime.evaluate', {
      expression: `(async () => {
        const bundle = JSON.parse('${bundleLiteral}');
        return await window.WavePongReplayRenderer.renderBundle(bundle, {
          fps: ${args.fps},
          width: ${args.width},
          height: ${args.height}
        });
      })()`,
      awaitPromise: true,
      returnByValue: true
    });

    const { base64 } = renderResult.result.value;
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, Buffer.from(base64, 'base64'));
    ws.close();
    console.log(`Replay video written to ${args.output}`);
  } finally {
    await browserHandle.dispose();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch (error) {
      // Browser profile cleanup can race on Windows; the render is still valid.
    }
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
