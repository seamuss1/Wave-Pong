const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// These tests drive the browser runtime's real canvas pointer listeners with a
// mock DOM to lock in the mobile touch-steering behavior:
//   - a touch drag moves the paddle,
//   - lifting the finger stops it (no glide / no snap-back), and
//   - a stationary tap (tap-to-fire) never steers the paddle.

const REPO_ROOT = path.resolve(__dirname, '../..');

function makeCtx() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'canvas') return null;
      return typeof prop === 'string' ? noop : undefined;
    },
    set() { return true; }
  });
}

function makeCanvas() {
  const listeners = {};
  return {
    id: 'gameCanvas', style: {}, width: 0, height: 0,
    _ctx: null,
    getContext() { if (!this._ctx) this._ctx = makeCtx(); return this._ctx; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800 }),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: () => {},
    setPointerCapture: () => {}, releasePointerCapture: () => {},
    _fire(type, ev) { for (const fn of (listeners[type] || [])) fn(ev); }
  };
}

function makeEl() {
  return {
    style: {}, dataset: {}, width: 0, height: 0,
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800 }),
    addEventListener: () => {}, removeEventListener: () => {},
    appendChild: () => {}, querySelectorAll: () => [], contains: () => false,
    setAttribute: () => {}, removeAttribute: () => {}, getAttribute: () => null,
    textContent: '', innerHTML: '', value: '', options: [], selectedIndex: -1
  };
}

function bootRuntime() {
  const canvas = makeCanvas();
  const els = {};
  const documentRef = {
    getElementById: (id) => (id === 'gameCanvas' ? canvas : (els[id] || (els[id] = makeEl()))),
    createElement: () => makeEl(),
    querySelectorAll: () => [],
    addEventListener: () => {}, removeEventListener: () => {},
    documentElement: { style: { setProperty: () => {} }, classList: { add: () => {}, remove: () => {}, toggle: () => {} } },
    hidden: false, fullscreenElement: null
  };
  const windowRef = {
    innerWidth: 400, innerHeight: 800, devicePixelRatio: 2,
    document: documentRef,
    performance: { now: () => 0 },
    navigator: { maxTouchPoints: 5, getGamepads: () => [] },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchMedia: () => ({ matches: true, addEventListener: () => {} }),
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
    addEventListener: () => {}, removeEventListener: () => {}
  };
  const config = require(path.join(REPO_ROOT, 'runtime/js/config.js'));
  const simCore = require(path.join(REPO_ROOT, 'runtime/js/sim-core.js'));
  const runtime = simCore.createRuntime({ document: documentRef, window: windowRef, config, runtimeVersion: 'test', canvas });
  runtime.mountBrowser();
  runtime.startMatch({ mode: 'pvp', skipCountdown: true, theme: 'neon' });
  return { runtime, canvas };
}

const touch = (pointerId, clientY) => ({ pointerType: 'touch', pointerId, clientY, preventDefault() {} });

test('touch drag steers the paddle and releasing the finger stops it', () => {
  const { runtime, canvas } = bootRuntime();
  const paddle = runtime.world.paddles.left;
  const startY = paddle.y;

  canvas._fire('pointerdown', touch(1, 20));
  canvas._fire('pointermove', touch(1, 20)); // drag toward the top of the screen
  runtime.stepSimulation(90);
  const afterDragY = paddle.y;
  assert.ok(startY - afterDragY > 40, `drag should move the paddle up (moved ${Math.round(startY - afterDragY)}px)`);

  canvas._fire('pointerup', touch(1, 20));
  runtime.stepSimulation(20);
  const settleA = paddle.y;
  runtime.stepSimulation(60);
  const settleB = paddle.y;
  assert.ok(Math.abs(settleB - settleA) <= 2, `paddle must stop after release (glided ${Math.round(Math.abs(settleB - settleA))}px)`);
});

test('a stationary tap (tap-to-fire) does not steer the paddle', () => {
  const { runtime, canvas } = bootRuntime();
  const paddle = runtime.world.paddles.left;
  const before = paddle.y;

  // Tap far from the paddle: pre-fix this snapped the paddle toward the tap.
  canvas._fire('pointerdown', touch(2, 780));
  canvas._fire('pointerup', touch(2, 780));
  runtime.stepSimulation(60);

  assert.ok(Math.abs(paddle.y - before) <= 2, `a tap must not move the paddle (drifted ${Math.round(Math.abs(paddle.y - before))}px)`);
});
