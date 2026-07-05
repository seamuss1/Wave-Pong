const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { createMetricsCollector } = require('../lib/metrics.js');
const { createControlPlaneApp } = require('../control-plane/app.js');

let fileCounter = 0;
function tmpFile() {
  fileCounter += 1;
  return path.join(os.tmpdir(), `wave-pong-metrics-${process.pid}-${fileCounter}.json`);
}
function cleanup(file) {
  try { fs.rmSync(file, { force: true }); } catch {}
  try { fs.rmSync(`${file}.tmp`, { force: true }); } catch {}
}

// Minimal keep-alive-free HTTP client so app.server.close() never waits on a
// pooled socket.
function request(method, url, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      method,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      agent: false,
      headers: {
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
        ...(headers || {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('records usage/popularity/fun signals, derives rates, and persists across restarts', () => {
  const file = tmpFile();
  const now = () => Date.parse('2026-07-05T12:00:00Z');
  const metrics = createMetricsCollector({ filePath: file, now, flushIntervalMs: 999999 });

  try {
    metrics.recordGuestCreated();
    metrics.recordGuestCreated();
    metrics.recordGuestCreated(); // 3 unique sessions

    metrics.recordControlConnected(); // 1 online
    metrics.recordControlConnected(); // 2 online
    metrics.recordControlConnected(); // 3 online -> peak 3
    metrics.recordControlDisconnected(); // back to 2 online

    metrics.recordQueueJoin('player-a');
    metrics.recordQueueJoin('player-b');
    metrics.recordQueueJoin('player-a'); // a came back -> one repeat queuer
    metrics.recordQueueLeave();

    metrics.recordMatchCreated();
    metrics.recordMatchCreated(); // peak 2 concurrent matches

    // Close, completed match (margin 1), two minutes long.
    metrics.recordMatchFinished({ started: true, reason: 'completed', leftScore: 7, rightScore: 6, durationMs: 120000 });
    // Blowout that ended on a disconnect forfeit (margin 7), forty seconds.
    metrics.recordMatchFinished({ started: true, reason: 'disconnect_forfeit', leftScore: 7, rightScore: 0, durationMs: 40000 });
    // Formed but never accepted: no duration/margin, but still a finish + outcome.
    metrics.recordMatchFinished({ started: false, reason: 'abandoned', leftScore: 0, rightScore: 0, durationMs: 0 });

    const snap = metrics.snapshot();
    assert.equal(snap.enabled, true);
    assert.equal(snap.usage.guestsCreated, 3);
    assert.equal(snap.usage.controlConnections, 3);
    assert.equal(snap.usage.queueJoins, 3);
    assert.equal(snap.usage.queueLeaves, 1);
    assert.equal(snap.usage.matchesCreated, 2);
    assert.equal(snap.usage.matchesStarted, 2);
    assert.equal(snap.usage.matchesFinished, 3);

    assert.equal(snap.popularity.peakConcurrentPlayers, 3);
    assert.equal(snap.popularity.peakConcurrentMatches, 2);

    assert.equal(snap.fun.repeatQueuers, 1);
    assert.equal(snap.fun.closeMatches, 1);
    assert.equal(snap.fun.blowouts, 1);
    assert.deepEqual(snap.fun.outcomes, { completed: 1, disconnect_forfeit: 1, abandoned: 1 });

    assert.equal(snap.derived.currentPlayers, 2);
    assert.equal(snap.derived.currentMatches, 0); // 2 created, 3 finishes clamps the gauge at 0
    assert.equal(snap.derived.avgMatchDurationSeconds, 80); // (120s + 40s) / 2
    assert.equal(snap.derived.avgScoreMargin, 4); // (1 + 7) / 2
    assert.equal(snap.derived.completionRate, 0.5); // 1 of 2 started matches ran to the score limit
    assert.equal(snap.derived.forfeitRate, 0.5);
    assert.equal(snap.derived.abandonRate, 0.5); // 1 of 2 created matches was abandoned
    assert.equal(snap.derived.closeMatchRate, 0.5);
    assert.equal(snap.derived.repeatQueueRate, 0.333); // 1 of 3 new players came back

    metrics.stop(); // flushes to disk

    // A restart loads the same file: lifetime counters carry over, live gauges reset.
    const restarted = createMetricsCollector({ filePath: file, now, flushIntervalMs: 999999 });
    const snap2 = restarted.snapshot();
    assert.equal(snap2.usage.guestsCreated, 3);
    assert.equal(snap2.usage.matchesStarted, 2);
    assert.equal(snap2.popularity.peakConcurrentPlayers, 3);
    assert.equal(snap2.fun.repeatQueuers, 1);
    assert.equal(snap2.derived.currentPlayers, 0);
    assert.equal(snap2.derived.avgMatchDurationSeconds, 80);
    restarted.stop();
  } finally {
    cleanup(file);
  }
});

test('a disabled collector is a no-op and never touches disk', () => {
  const file = tmpFile();
  const metrics = createMetricsCollector({ enabled: false, filePath: file });
  metrics.recordGuestCreated();
  metrics.recordMatchFinished({ started: true, reason: 'completed', leftScore: 7, rightScore: 1, durationMs: 1000 });
  metrics.stop();

  assert.equal(metrics.enabled, false);
  assert.deepEqual(metrics.snapshot(), { enabled: false });
  assert.equal(fs.existsSync(file), false);
  cleanup(file);
});

test('daily buckets accumulate per UTC day and prune to the retention window', () => {
  const file = tmpFile();
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const metrics = createMetricsCollector({ filePath: file, now: () => clock, retainDays: 3, flushIntervalMs: 999999 });
  const DAY_MS = 24 * 60 * 60 * 1000;

  try {
    for (let i = 0; i < 5; i += 1) {
      metrics.recordGuestCreated();
      clock += DAY_MS;
    }
    const snap = metrics.snapshot();
    const days = Object.keys(snap.daily).sort();
    assert.deepEqual(days, ['2026-01-03', '2026-01-04', '2026-01-05']);
    assert.equal(snap.daily['2026-01-05'].guestsCreated, 1);
    metrics.stop();
  } finally {
    cleanup(file);
  }
});

test('control-plane exposes GET /metrics with counts and honors the token gate', async () => {
  const file = tmpFile();
  const metrics = createMetricsCollector({ filePath: file, flushIntervalMs: 999999 });
  const app = createControlPlaneApp({
    workerManager: { setMatchFinishedHandler() {} },
    serveRuntime: false,
    secret: 'test-secret',
    metrics,
    metricsToken: 'sekret'
  });

  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const guest = await request('POST', `${base}/auth/guest`, { body: { displayName: 'Tester' } });
    assert.equal(guest.status, 200);
    assert.ok(guest.json.accessToken);

    // Wrong/absent token is rejected.
    const denied = await request('GET', `${base}/metrics`);
    assert.equal(denied.status, 401);

    // Correct token returns the aggregated snapshot reflecting the guest above.
    const allowed = await request('GET', `${base}/metrics?token=sekret`);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.json.enabled, true);
    assert.equal(allowed.json.usage.guestsCreated, 1);
  } finally {
    if (typeof app.server.closeAllConnections === 'function') app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    metrics.stop();
    cleanup(file);
  }
});
