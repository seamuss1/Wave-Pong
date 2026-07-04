const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Verifies that gameplay stat persistence is deferred off the hot loop: writing
// history / best-rally to localStorage on every ball hit and goal was the source
// of the per-hit and per-goal stutter (localStorage.setItem is synchronous and
// slow on mobile). Writes must instead coalesce and flush only at natural breaks.

const REPO_ROOT = path.resolve(__dirname, '../..');
const config = require(path.join(REPO_ROOT, 'runtime/js/config.js'));
const simCore = require(path.join(REPO_ROOT, 'runtime/js/sim-core.js'));
const controllers = require(path.join(REPO_ROOT, 'runtime/js/controllers.js'));

function countingStorage() {
  const map = new Map();
  const stats = { writes: 0 };
  return {
    stats,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { stats.writes += 1; map.set(k, v); },
    removeItem: (k) => map.delete(k)
  };
}

function bootHeadless(storage) {
  const pendingTimers = [];
  const win = {
    // Capture (do not auto-run) scheduled flushes so we can assert nothing is
    // written synchronously during play.
    setTimeout: (fn) => { pendingTimers.push(fn); return pendingTimers.length; },
    clearTimeout: () => {},
    localStorage: storage
  };
  const runtime = simCore.createSimulation({ config, seed: 4, storage, window: win });
  return { runtime, pendingTimers };
}

test('stat persistence is deferred during play and flushes at a break point', () => {
  const storage = countingStorage();
  const { runtime } = bootHeadless(storage);

  // Two scripted opponents keep a long rally going so best-rally records fire.
  runtime.startMatch({
    mode: 'pvp',
    skipCountdown: true,
    scoreLimit: 99, // don't let the match end mid-test
    leftController: controllers.createScriptedController({ difficulty: 'spicy' }),
    rightController: controllers.createScriptedController({ difficulty: 'spicy' })
  });

  runtime.stepSimulation(3000); // ~25s of play: many hits, likely some goals

  const rallyReached = Math.max(runtime.state.rally, runtime.state.bestRally, runtime.matchStats.longestRally);
  assert.ok(rallyReached > 0, 'expected the scripted rally to produce at least one paddle hit');

  // The whole point: no synchronous storage writes happened on the hot loop.
  assert.equal(storage.stats.writes, 0, `expected 0 synchronous writes during play, saw ${storage.stats.writes}`);

  // Leaving the match is a natural break and must persist the deferred stats.
  runtime.backToMenu();
  assert.ok(storage.stats.writes > 0, 'expected deferred stats to flush when returning to the menu');
});
