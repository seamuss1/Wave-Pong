#!/usr/bin/env node
// Concurrency benchmark for the authoritative match-worker: ramps up real
// matched games (each a pair of bot websocket clients driven through guest
// auth -> matchmaking -> the match socket) against a running backend, and
// reports the point where the server's single-threaded tick loop stops
// keeping real time.
//
// The server has no hard-coded match cap (see backend/match-worker/manager.js) -
// every match's 120Hz physics loop runs on the same event loop
// (backend/match-worker/authoritative-match.js), so the real ceiling is CPU,
// not config. This script finds that ceiling empirically instead of guessing.
//
// What it measures, per ramp step:
//   - avg authoritative tick rate across active matches (from `serverTick` in
//     match.snapshot payloads vs wall-clock - the direct sign the server is
//     falling behind, independent of network jitter)
//   - control-socket ping RTT (a corroborating symptom of event-loop congestion)
//   - server process CPU in core-equivalents (only when this script spawned
//     the server itself; best-effort, Windows + Linux)
//   - this script's OWN CPU, so you can tell whether the generator or the
//     server saturated first when both run on the same machine
//
// Usage:
//   node backend/tests/load-test.js                              # spawns a local backend, ramps against it
//   node backend/tests/load-test.js http://10.0.0.18:8787         # ramps against an already-running deployment
//   node backend/tests/load-test.js --start=4 --step=8 --interval=10000 --max=300
//
// Options (all optional):
//   --start=N          initial concurrent matches (default 2)
//   --step=N           matches added per ramp step (default 4)
//   --interval=MS       time between ramp decisions (default 8000)
//   --max=N            hard cap on concurrent matches (default 200)
//   --hold=MS           time to hold at the final level before reporting (default 15000)
//   --tick-threshold=F  fraction of the configured tick rate considered healthy (default 0.85)
//   --rtt-threshold=MS  ping RTT considered healthy (default 400)
//   --streak=N          consecutive unhealthy windows before stopping the ramp (default 2)
//   --duration=MS       hard safety cap on total run time (default 1200000 / 20 min)
//   --no-spawn          treat the target as remote even if it's on 127.0.0.1/localhost
//   --force-remote      required to run against a non-loopback host (see safety check below)
//
// CAUTION: this generates real matches and websocket traffic. Refuses to run
// against the known public production hostname; pointing it at any other
// live deployment with real players will degrade their game.

const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const LOCAL_CONTROL_PORT = 18787;
const LOCAL_WORKER_PORT = 18788;
const PRODUCTION_HOSTS = new Set(['wave-pong.seamusgallagher.org']);

function parseArgs(argv) {
  const args = { _: [] };
  for (const token of argv) {
    const kv = token.match(/^--([^=]+)=(.*)$/);
    if (kv) { args[kv[1]] = kv[2]; continue; }
    const flag = token.match(/^--(.+)$/);
    if (flag) { args[flag[1]] = true; continue; }
    args._.push(token);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
function num(name, fallback) {
  return args[name] != null ? Number(args[name]) : fallback;
}

const apiBaseUrl = (args._[0] || `http://127.0.0.1:${LOCAL_CONTROL_PORT}`).replace(/\/+$/, '');
const spawnLocal = /^(https?:\/\/)?(127\.0\.0\.1|localhost)/.test(apiBaseUrl) && !args['no-spawn'];

(function guardAgainstProduction() {
  let hostname = '';
  try {
    hostname = new URL(apiBaseUrl).hostname;
  } catch (error) {
    return;
  }
  if (PRODUCTION_HOSTS.has(hostname) && !args['force-remote']) {
    console.error(`Refusing to load-test ${hostname}: that is the public production deployment with real players.`);
    console.error('Rerun with --force-remote only if you are certain no one is playing (e.g. a maintenance window).');
    process.exit(1);
  }
})();

const RAMP = {
  start: num('start', 2),
  step: num('step', 4),
  intervalMs: num('interval', 8000),
  max: num('max', 200),
  holdMs: num('hold', 15000),
  tickThreshold: num('tick-threshold', 0.85),
  rttThresholdMs: num('rtt-threshold', 400),
  streak: num('streak', 2),
  durationCapMs: num('duration', 20 * 60 * 1000)
};

const config = require(path.join(REPO_ROOT, 'runtime/js/config.js'));
const netcode = config.multiplayer.netcode;
const EXPECTED_TICK_RATE = netcode.serverTickRate || 120;
const INPUT_FRAMES_PER_BATCH = Math.max(1, Math.min(netcode.inputSendIntervalTicks || 4, netcode.maxInputBatchFrames || 12));
const INPUT_SEND_INTERVAL_MS = (1000 / EXPECTED_TICK_RATE) * INPUT_FRAMES_PER_BATCH;
const INITIAL_LEAD_TICKS = netcode.inputBufferTicks || 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Thin websocket message wrapper: dispatches parsed {type, payload} messages
// to persistent listeners and one-shot waiters, on top of the global
// WebSocket client (Node 20+). Kept separate from backend/lib/tiny-ws.js,
// which only implements the server side of the handshake.
// ---------------------------------------------------------------------------
class MsgSocket {
  constructor(raw) {
    this.raw = raw;
    this.listeners = new Map();
    this.closed = false;
    raw.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (error) {
        return;
      }
      const specific = this.listeners.get(msg.type);
      if (specific) for (const fn of Array.from(specific)) fn(msg);
      const any = this.listeners.get('*');
      if (any) for (const fn of Array.from(any)) fn(msg);
    });
    raw.addEventListener('close', () => { this.closed = true; });
    raw.addEventListener('error', () => { /* surfaced via connectSocket()/waitFor timeouts */ });
  }

  send(obj) {
    if (this.raw.readyState === this.raw.OPEN) this.raw.send(JSON.stringify(obj));
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }

  waitFor(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      let off;
      const timer = setTimeout(() => { off(); reject(new Error('Timed out waiting for a websocket message.')); }, timeoutMs);
      off = this.on('*', (msg) => {
        if (msg.type === 'error') {
          clearTimeout(timer); off();
          reject(new Error((msg.payload && msg.payload.message) || 'Server returned an error message.'));
          return;
        }
        if (predicate(msg)) { clearTimeout(timer); off(); resolve(msg); }
      });
    });
  }

  close() {
    try { this.raw.close(); } catch (error) { /* noop */ }
  }
}

function connectSocket(url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let raw;
    try {
      raw = new WebSocket(url);
    } catch (error) {
      reject(error);
      return;
    }
    raw.addEventListener('open', () => { if (!settled) { settled = true; resolve(new MsgSocket(raw)); } });
    raw.addEventListener('error', () => { if (!settled) { settled = true; reject(new Error(`Failed to connect: ${url}`)); } });
  });
}

async function guestAuth(displayName) {
  const response = await fetch(`${apiBaseUrl}/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `guest auth failed: HTTP ${response.status}`);
  return payload;
}

// ---------------------------------------------------------------------------
// Match stats: one entry per active matchId, fed by whichever bot's socket
// sees a snapshot first. Tick rate is measured directly from the server's
// own `serverTick` counter against wall-clock arrival time, which is the
// most direct signal that the authoritative loop is (or isn't) keeping up.
// ---------------------------------------------------------------------------
const matchRegistry = new Map();
const SNAPSHOT_WINDOW_MS = 5000;

function registerMatch(matchId) {
  if (!matchRegistry.has(matchId)) {
    matchRegistry.set(matchId, { window: [] });
  }
  return matchRegistry.get(matchId);
}

function recordSnapshot(stats, tick) {
  const at = Date.now();
  stats.window.push({ tick, at });
  const cutoff = at - SNAPSHOT_WINDOW_MS;
  while (stats.window.length > 1 && stats.window[0].at < cutoff) stats.window.shift();
}

function matchTickRate(stats) {
  if (stats.window.length < 2) return null;
  const first = stats.window[0];
  const last = stats.window[stats.window.length - 1];
  const dtSec = (last.at - first.at) / 1000;
  if (dtSec <= 0) return null;
  return (last.tick - first.tick) / dtSec;
}

let rttSamples = [];
function recordRtt(ms) {
  rttSamples.push(ms);
  if (rttSamples.length > 2000) rttSamples.shift();
}
function drainRtt() {
  const copy = rttSamples;
  rttSamples = [];
  return copy;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

// ---------------------------------------------------------------------------
// PlayerBot: one simulated player. Loops forever - queue, play a full match,
// repeat - so ramp concurrency stays steady instead of decaying as matches
// naturally finish (quick_play has a score limit; see runtime/js/config.js).
// ---------------------------------------------------------------------------
class PlayerBot {
  constructor(index) {
    this.index = index;
    this.stopped = false;
    this.matchesPlayed = 0;
    this.errors = 0;
    this.lastError = null;
  }

  stop() { this.stopped = true; }

  async run() {
    while (!this.stopped) {
      try {
        await this.playOnce();
        this.matchesPlayed += 1;
      } catch (error) {
        this.errors += 1;
        this.lastError = error.message;
        if (!this.stopped) await sleep(300 + Math.random() * 700);
      }
    }
  }

  async playOnce() {
    const auth = await guestAuth(`LoadBot${this.index}`);
    const control = await connectSocket(`${apiBaseUrl.replace(/^http/i, 'ws')}/ws/control`);
    const pingTimer = setInterval(() => {
      const sentAt = Date.now();
      control.send({ type: 'ping', payload: {} });
      control.waitFor((m) => m.type === 'presence.update', 5000)
        .then(() => recordRtt(Date.now() - sentAt))
        .catch(() => { /* dropped pong under load is itself signal; RTT sample just skipped */ });
    }, 2000 + Math.random() * 500);
    try {
      control.send({ type: 'hello', payload: { accessToken: auth.accessToken } });
      await control.waitFor((m) => m.type === 'hello.ok', 10000);
      control.send({ type: 'queue.join', payload: {} });
      const found = await control.waitFor((m) => m.type === 'match.found', 30000);
      await this.playMatch(found.payload);
    } finally {
      clearInterval(pingTimer);
      control.close();
    }
  }

  async playMatch(found) {
    const matchSocket = await connectSocket(found.workerUrl);
    try {
      matchSocket.send({ type: 'hello', payload: { ticket: found.ticket } });
      await matchSocket.waitFor((m) => m.type === 'hello.ok', 10000);
      matchSocket.send({ type: 'match.accept', payload: {} });
      const startMsg = await matchSocket.waitFor((m) => m.type === 'match.start', 20000);

      const matchId = found.matchId;
      const stats = registerMatch(matchId);
      recordSnapshot(stats, startMsg.payload.snapshot.serverTick);
      matchSocket.on('match.snapshot', (m) => recordSnapshot(stats, m.payload.serverTick));
      matchSocket.on('match.correction', (m) => recordSnapshot(stats, m.payload.serverTick));

      let nextTick = startMsg.payload.snapshot.serverTick + INITIAL_LEAD_TICKS;
      let seq = 1;
      let phase = Math.random() * Math.PI * 2;
      let batchCount = 0;
      const inputTimer = setInterval(() => {
        batchCount += 1;
        const frames = [];
        for (let i = 0; i < INPUT_FRAMES_PER_BATCH; i += 1) {
          phase += 0.15;
          const wave = Math.sin(phase);
          const moveAxis = wave > 0.2 ? 1 : (wave < -0.2 ? -1 : 0);
          const fire = i === 0 && batchCount % 15 === 0;
          frames.push({ moveAxis, fire, fireTier: fire ? (batchCount % 30 === 0 ? 'pink' : 'blue') : null });
        }
        matchSocket.send({ type: 'match.input_batch', payload: { matchId, seq: seq++, startTick: nextTick, frames } });
        nextTick += frames.length;
      }, INPUT_SEND_INTERVAL_MS);

      try {
        await matchSocket.waitFor((m) => m.type === 'match.result', 10 * 60 * 1000);
      } finally {
        clearInterval(inputTimer);
        matchRegistry.delete(matchId);
      }
    } finally {
      matchSocket.close();
    }
  }
}

// ---------------------------------------------------------------------------
// CPU sampling: core-equivalents (1.0 = one core fully busy), best-effort.
// ---------------------------------------------------------------------------
function createSelfCpuSampler() {
  let prev = process.cpuUsage();
  let prevAt = Date.now();
  return function sample() {
    const now = Date.now();
    const diff = process.cpuUsage(prev);
    prev = process.cpuUsage();
    const dWallMs = now - prevAt;
    prevAt = now;
    if (dWallMs <= 0) return null;
    return ((diff.user + diff.system) / 1000) / dWallMs;
  };
}

function createChildCpuSampler(pid) {
  let last = null;
  return function sample() {
    let cpuMs = null;
    try {
      if (process.platform === 'win32') {
        const out = execFileSync('powershell', [
          '-NoProfile', '-NonInteractive', '-Command',
          `(Get-Process -Id ${pid}).TotalProcessorTime.TotalMilliseconds`
        ], { timeout: 5000 }).toString().trim();
        cpuMs = Number(out);
      } else {
        // /proc/<pid>/stat fields 14 (utime) and 15 (stime) are in clock ticks;
        // 100 Hz is the standard Linux CLK_TCK and is not worth shelling out
        // to getconf to confirm for a best-effort sampler.
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const afterComm = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
        const utime = Number(afterComm[11]);
        const stime = Number(afterComm[12]);
        cpuMs = ((utime + stime) / 100) * 1000;
      }
    } catch (error) {
      return null;
    }
    if (!Number.isFinite(cpuMs)) return null;
    const now = Date.now();
    if (!last) { last = { cpuMs, at: now }; return null; }
    const dCpu = cpuMs - last.cpuMs;
    const dWall = now - last.at;
    last = { cpuMs, at: now };
    if (dWall <= 0) return null;
    return dCpu / dWall;
  };
}

function fmt(value, digits = 1) {
  return value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);
}

// ---------------------------------------------------------------------------
// Main: spawn (optionally), ramp concurrency, report.
// ---------------------------------------------------------------------------
async function main() {
  let serverProcess = null;
  let childCpuSampler = null;
  const selfCpuSampler = createSelfCpuSampler();

  if (spawnLocal) {
    serverProcess = spawn(process.execPath, [path.join(REPO_ROOT, 'backend/server.js')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WAVE_PONG_SECRET: 'load-test-secret',
        WAVE_PONG_CONTROL_PORT: String(LOCAL_CONTROL_PORT),
        WAVE_PONG_WORKER_PORT: String(LOCAL_WORKER_PORT)
      }
    });
    serverProcess.stdout.on('data', () => {});
    serverProcess.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
    childCpuSampler = createChildCpuSampler(serverProcess.pid);
    let healthy = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`${apiBaseUrl}/health`);
        if (response.ok) { healthy = true; break; }
      } catch (error) { /* not up yet */ }
      await sleep(250);
    }
    if (!healthy) throw new Error('Local backend did not become healthy.');
    console.log(`local backend healthy (pid ${serverProcess.pid}), tick rate ${EXPECTED_TICK_RATE}Hz`);
  } else {
    const response = await fetch(`${apiBaseUrl}/health`);
    if (!response.ok) throw new Error(`Backend health check failed: HTTP ${response.status}`);
    console.log(`remote backend healthy at ${apiBaseUrl} (server CPU sampling unavailable for remote targets)`);
    console.log('note: this machine also runs the load generator - if ITS cpu saturates first, the ceiling below is not trustworthy. Watch the genCpu column.');
  }

  const bots = [];
  function launchBots(count) {
    for (let i = 0; i < count; i += 1) {
      const bot = new PlayerBot(bots.length);
      bots.push(bot);
      bot.run();
    }
  }

  const startedAt = Date.now();
  let target = RAMP.start;
  launchBots(target * 2);
  console.log(`ramping: start=${RAMP.start} matches, +${RAMP.step} every ${RAMP.intervalMs}ms, cap=${RAMP.max}, healthy threshold=${(RAMP.tickThreshold * EXPECTED_TICK_RATE).toFixed(0)}Hz / ${RAMP.rttThresholdMs}ms RTT\n`);

  const history = [];
  let badStreak = 0;
  let overloadedAt = null;
  let rampingDone = false;
  let holdStartedAt = null;

  console.log('elapsed  target  active  avgTick  healthy%  p95Rtt  serverCpu  genCpu  status');

  while (true) {
    await sleep(RAMP.intervalMs);
    const elapsed = Date.now() - startedAt;

    const activeStats = Array.from(matchRegistry.values());
    const tickRates = activeStats.map(matchTickRate).filter((v) => v != null);
    const avgTick = tickRates.length ? tickRates.reduce((a, b) => a + b, 0) / tickRates.length : null;
    const healthyFrac = tickRates.length
      ? tickRates.filter((v) => v >= RAMP.tickThreshold * EXPECTED_TICK_RATE).length / tickRates.length
      : null;
    const rtts = drainRtt().slice().sort((a, b) => a - b);
    const p95Rtt = percentile(rtts, 0.95);
    const serverCpu = childCpuSampler ? childCpuSampler() : null;
    const genCpu = selfCpuSampler();

    const enoughSamples = tickRates.length >= Math.max(2, Math.floor(target * 0.5));
    const unhealthy = enoughSamples && (
      (healthyFrac != null && healthyFrac < 0.9) ||
      (p95Rtt != null && p95Rtt > RAMP.rttThresholdMs)
    );

    let status;
    if (!rampingDone) {
      if (unhealthy) {
        badStreak += 1;
        status = `unhealthy (${badStreak}/${RAMP.streak})`;
        if (badStreak >= RAMP.streak) {
          overloadedAt = target;
          rampingDone = true;
          status = 'OVERLOAD - holding';
        }
      } else {
        badStreak = 0;
        status = 'healthy';
      }
    } else {
      status = 'holding';
    }

    console.log(
      `${(elapsed / 1000).toFixed(0).padStart(6)}s ` +
      `${String(target).padStart(6)}  ${String(matchRegistry.size).padStart(6)}  ` +
      `${fmt(avgTick).padStart(7)}  ${fmt(healthyFrac != null ? healthyFrac * 100 : null, 0).padStart(7)}%  ` +
      `${fmt(p95Rtt, 0).padStart(6)}  ${fmt(serverCpu, 2).padStart(9)}  ${fmt(genCpu, 2).padStart(6)}  ${status}`
    );

    history.push({ elapsed, target, active: matchRegistry.size, avgTick, healthyFrac, p95Rtt, serverCpu, genCpu, status });

    if (!rampingDone && target >= RAMP.max) {
      console.log(`reached --max=${RAMP.max} without detecting overload; holding to confirm.`);
      rampingDone = true;
    }

    if (rampingDone) {
      if (holdStartedAt == null) holdStartedAt = elapsed;
      if (elapsed - holdStartedAt >= RAMP.holdMs || elapsed >= RAMP.durationCapMs) {
        break;
      }
      continue;
    }

    if (elapsed >= RAMP.durationCapMs) {
      console.log('hit --duration safety cap; stopping ramp.');
      break;
    }

    target += RAMP.step;
    launchBots(RAMP.step * 2);
  }

  for (const bot of bots) bot.stop();
  await sleep(1000);

  console.log('\n=== Summary ===');
  console.log(`configured tick rate: ${EXPECTED_TICK_RATE}Hz, snapshot rate: ${netcode.snapshotRateHz || 24}Hz`);
  if (overloadedAt != null) {
    console.log(`Degradation detected at ~${overloadedAt} concurrent matches (${overloadedAt * 2} players).`);
    const lastHealthy = [...history].reverse().find((h) => h.status === 'healthy');
    if (lastHealthy) {
      console.log(`Last confirmed healthy level: ${lastHealthy.target} matches (${lastHealthy.target * 2} players), avg tick rate ${fmt(lastHealthy.avgTick)}Hz, p95 RTT ${fmt(lastHealthy.p95Rtt, 0)}ms.`);
    }
  } else {
    console.log(`No degradation detected up to ${target} matches (${target * 2} players) in this run. Re-run with a higher --max for a firmer ceiling.`);
  }
  const finalServerCpu = history.length ? history[history.length - 1].serverCpu : null;
  const finalGenCpu = history.length ? history[history.length - 1].genCpu : null;
  if (finalServerCpu != null) {
    console.log(`Final server CPU: ${fmt(finalServerCpu, 2)} core-equivalents (single-threaded, so this saturates near 1.0 regardless of vCPU count).`);
  }
  if (finalGenCpu != null && finalGenCpu > 0.7) {
    console.log(`Warning: the load generator itself used ${fmt(finalGenCpu, 2)} cores near the end - it may have been the real bottleneck, not the server. Re-run with --url pointed at the server from a separate machine for a clean number.`);
  }

  if (serverProcess) serverProcess.kill();
  process.exit(0);
}

process.on('SIGINT', () => {
  console.log('\ninterrupted - shutting down.');
  process.exit(130);
});

main().catch((error) => {
  console.error('LOAD TEST FAILED:', error.message);
  process.exit(1);
});
