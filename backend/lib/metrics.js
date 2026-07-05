const fs = require('fs');
const path = require('path');

// Local-file metrics collector for the Wave Pong server. It accumulates usage,
// popularity, and engagement ("are people having fun?") signals in memory and
// atomically persists them to a JSON file so the numbers survive process
// restarts and deploys. Deploys only overwrite backend/ shared/ runtime/, so a
// data/ file at the app root is left untouched between releases.
//
// The collector is intentionally dependency-free and cheap: record calls are
// O(1) counter bumps that mark the state dirty, and a debounced timer flushes
// at most once per interval (only when something changed).

const STATE_VERSION = 1;
const DEFAULT_RETAIN_DAYS = 90;
const DEFAULT_FLUSH_INTERVAL_MS = 10 * 1000;
// Final-score margin thresholds used to bucket "how competitive was it?". A
// tight game reads as more fun; a blowout reads as less.
const CLOSE_MARGIN = 2;
const BLOWOUT_MARGIN = 5;

function n(value) {
  return Number.isFinite(value) ? value : 0;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function emptyDaily() {
  return {
    guestsCreated: 0,
    controlConnections: 0,
    queueJoins: 0,
    matchesCreated: 0,
    matchesStarted: 0,
    matchesFinished: 0
  };
}

function createInitialState(nowIso) {
  return {
    version: STATE_VERSION,
    createdAt: nowIso,
    updatedAt: nowIso,
    // Raw lifetime counters. Everything reported to callers is derived from
    // these so averages/rates stay correct across restarts.
    usage: {
      guestsCreated: 0,
      controlConnections: 0,
      queueJoins: 0,
      queueLeaves: 0,
      matchesCreated: 0,
      matchesStarted: 0,
      matchesFinished: 0
    },
    popularity: {
      peakConcurrentPlayers: 0,
      peakConcurrentMatches: 0
    },
    fun: {
      startedDurationMsTotal: 0,
      scoreMarginTotal: 0,
      closeMatches: 0,
      blowouts: 0,
      repeatQueuers: 0,
      // reason -> count across every finish (completed / disconnect_forfeit /
      // abandoned / ...).
      outcomes: {}
    },
    // Per-UTC-day buckets for trend lines, pruned to the retention window.
    daily: {}
  };
}

function normalizeState(parsed, nowIso) {
  const base = createInitialState(nowIso);
  if (!parsed || typeof parsed !== 'object') return base;
  base.createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : base.createdAt;

  const usage = parsed.usage || {};
  for (const key of Object.keys(base.usage)) base.usage[key] = n(usage[key]);

  const popularity = parsed.popularity || {};
  for (const key of Object.keys(base.popularity)) base.popularity[key] = n(popularity[key]);

  const fun = parsed.fun || {};
  base.fun.startedDurationMsTotal = n(fun.startedDurationMsTotal);
  base.fun.scoreMarginTotal = n(fun.scoreMarginTotal);
  base.fun.closeMatches = n(fun.closeMatches);
  base.fun.blowouts = n(fun.blowouts);
  base.fun.repeatQueuers = n(fun.repeatQueuers);
  if (fun.outcomes && typeof fun.outcomes === 'object') {
    for (const [reason, count] of Object.entries(fun.outcomes)) base.fun.outcomes[reason] = n(count);
  }

  if (parsed.daily && typeof parsed.daily === 'object') {
    for (const [day, bucket] of Object.entries(parsed.daily)) {
      const filled = emptyDaily();
      for (const key of Object.keys(filled)) filled[key] = n((bucket || {})[key]);
      base.daily[day] = filled;
    }
  }
  return base;
}

function createNoopCollector() {
  const noop = () => {};
  return {
    enabled: false,
    recordGuestCreated: noop,
    recordControlConnected: noop,
    recordControlDisconnected: noop,
    recordQueueJoin: noop,
    recordQueueLeave: noop,
    recordMatchCreated: noop,
    recordMatchFinished: noop,
    snapshot: () => ({ enabled: false }),
    flush: noop,
    stop: noop
  };
}

function createMetricsCollector(options = {}) {
  if (options.enabled === false) {
    return createNoopCollector();
  }

  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const filePath = options.filePath || path.join(__dirname, '..', '..', 'data', 'metrics.json');
  const retainDays = Number.isFinite(options.retainDays) ? options.retainDays : DEFAULT_RETAIN_DAYS;
  const flushIntervalMs = Number.isFinite(options.flushIntervalMs) ? options.flushIntervalMs : DEFAULT_FLUSH_INTERVAL_MS;
  const logger = options.logger || console;

  function nowIso() {
    return new Date(now()).toISOString();
  }

  function load() {
    try {
      if (!fs.existsSync(filePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsed || parsed.version !== STATE_VERSION) {
        logger.warn(`[metrics] Ignoring metrics file with unsupported version at ${filePath}; starting fresh.`);
        return null;
      }
      return normalizeState(parsed, nowIso());
    } catch (error) {
      logger.warn(`[metrics] Failed to load ${filePath}, starting fresh: ${error.message}`);
      return null;
    }
  }

  const state = load() || createInitialState(nowIso());
  let dirty = false;
  let writeFailed = false;

  // Live gauges are process-scoped: after a restart there are no live sockets or
  // matches, so these reset to 0 while the persisted peaks carry over.
  let currentPlayers = 0;
  let currentMatches = 0;
  // playerId -> times this player has queued this process lifetime, so a second
  // join (they came back for another game) can be counted once as a "repeat".
  const sessionQueueCounts = new Map();

  function dayKey() {
    return nowIso().slice(0, 10);
  }

  function pruneDaily() {
    const keys = Object.keys(state.daily).sort();
    while (keys.length > retainDays) {
      delete state.daily[keys.shift()];
    }
  }

  function today() {
    const key = dayKey();
    if (!state.daily[key]) {
      state.daily[key] = emptyDaily();
      pruneDaily();
    }
    return state.daily[key];
  }

  function touch() {
    state.updatedAt = nowIso();
    dirty = true;
  }

  function writeNow() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
      // Rename is atomic on the same filesystem, so a crash mid-write can never
      // leave a half-written metrics file behind.
      fs.renameSync(tmpPath, filePath);
      dirty = false;
      writeFailed = false;
    } catch (error) {
      // Persistence is best-effort: a read-only or missing data dir must never
      // take the game server down. Log once, then stay quiet to avoid spam.
      if (!writeFailed) {
        logger.warn(`[metrics] Failed to persist ${filePath}: ${error.message}`);
        writeFailed = true;
      }
    }
  }

  function flush() {
    if (dirty) writeNow();
  }

  const timer = setInterval(flush, flushIntervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();

  return {
    enabled: true,

    recordGuestCreated() {
      state.usage.guestsCreated += 1;
      today().guestsCreated += 1;
      touch();
    },

    recordControlConnected() {
      state.usage.controlConnections += 1;
      today().controlConnections += 1;
      currentPlayers += 1;
      if (currentPlayers > state.popularity.peakConcurrentPlayers) {
        state.popularity.peakConcurrentPlayers = currentPlayers;
      }
      touch();
    },

    recordControlDisconnected() {
      if (currentPlayers > 0) currentPlayers -= 1;
      // Only the live gauge changes; the persisted peak is already captured, so
      // there is nothing new to write here.
    },

    recordQueueJoin(playerId) {
      state.usage.queueJoins += 1;
      today().queueJoins += 1;
      if (playerId != null) {
        const count = (sessionQueueCounts.get(playerId) || 0) + 1;
        sessionQueueCounts.set(playerId, count);
        if (count === 2) state.fun.repeatQueuers += 1;
      }
      touch();
    },

    recordQueueLeave() {
      state.usage.queueLeaves += 1;
      touch();
    },

    recordMatchCreated() {
      state.usage.matchesCreated += 1;
      today().matchesCreated += 1;
      currentMatches += 1;
      if (currentMatches > state.popularity.peakConcurrentMatches) {
        state.popularity.peakConcurrentMatches = currentMatches;
      }
      touch();
    },

    recordMatchFinished(summary = {}) {
      state.usage.matchesFinished += 1;
      today().matchesFinished += 1;
      if (currentMatches > 0) currentMatches -= 1;

      const reason = typeof summary.reason === 'string' && summary.reason ? summary.reason : 'unknown';
      state.fun.outcomes[reason] = (state.fun.outcomes[reason] || 0) + 1;

      // A match that both players accepted (started) is the one that produced
      // actual play, so duration/margin engagement signals only come from those.
      if (summary.started) {
        state.usage.matchesStarted += 1;
        today().matchesStarted += 1;
        state.fun.startedDurationMsTotal += n(summary.durationMs);
        const margin = Math.abs(n(summary.leftScore) - n(summary.rightScore));
        state.fun.scoreMarginTotal += margin;
        if (margin <= CLOSE_MARGIN) state.fun.closeMatches += 1;
        if (margin >= BLOWOUT_MARGIN) state.fun.blowouts += 1;
      }
      touch();
    },

    snapshot() {
      const started = state.usage.matchesStarted;
      const created = state.usage.matchesCreated;
      const completed = state.fun.outcomes.completed || 0;
      const forfeits = state.fun.outcomes.disconnect_forfeit || 0;
      const abandoned = state.fun.outcomes.abandoned || 0;
      const derived = {
        currentPlayers,
        currentMatches,
        avgMatchDurationSeconds: started ? round(state.fun.startedDurationMsTotal / started / 1000, 1) : 0,
        avgScoreMargin: started ? round(state.fun.scoreMarginTotal / started, 2) : 0,
        // Of matches that started, how many were played to the finish (reached
        // the score limit) rather than forfeited by a disconnect.
        completionRate: started ? round(completed / started, 3) : 0,
        forfeitRate: started ? round(forfeits / started, 3) : 0,
        // Of matches that were formed, how many were dropped before anyone
        // accepted (a sign of players bouncing off matchmaking).
        abandonRate: created ? round(abandoned / created, 3) : 0,
        closeMatchRate: started ? round(state.fun.closeMatches / started, 3) : 0,
        // Share of new players who came back for at least a second match.
        repeatQueueRate: state.usage.guestsCreated ? round(state.fun.repeatQueuers / state.usage.guestsCreated, 3) : 0
      };
      return { enabled: true, ...JSON.parse(JSON.stringify(state)), derived };
    },

    flush,

    stop() {
      clearInterval(timer);
      flush();
    }
  };
}

module.exports = {
  createMetricsCollector
};
