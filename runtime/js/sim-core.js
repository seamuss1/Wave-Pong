(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WavePong = root.WavePong || {};
    root.WavePong.SimCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  const DEFAULT_TICK_RATE = 120;
  const DEFAULT_DECISION_INTERVAL_TICKS = 2;

  function normalizeSeed(seed) {
    if (typeof seed === 'number' && Number.isFinite(seed)) {
      return (seed >>> 0) || 1;
    }
    const text = String(seed == null ? 'wave-pong' : seed);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 1;
  }

  function createSeededRandom(seed) {
    let state = normalizeSeed(seed);
    return {
      next() {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      getState() {
        return state >>> 0;
      },
      setState(nextState) {
        state = normalizeSeed(nextState);
      }
    };
  }

  function stableSerialize(value) {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (value instanceof Set) {
      return stableSerialize(Array.from(value.values()));
    }
    if (Array.isArray(value)) {
      return '[' + value.map(stableSerialize).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableSerialize(value[key])).join(',') + '}';
  }

  function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function deepClone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Set) return new Set(Array.from(value.values(), deepClone));
    if (Array.isArray(value)) return value.map(deepClone);
    const clone = {};
    for (const key of Object.keys(value)) {
      clone[key] = deepClone(value[key]);
    }
    return clone;
  }

  function createUIBindings(documentRef) {
    const get = (id) => (documentRef ? documentRef.getElementById(id) : null);
    return {
      leftScore: get('leftScore'),
      rightScore: get('rightScore'),
      leftName: get('leftName'),
      rightName: get('rightName'),
      modeLabel: get('modeLabel'),
      difficultyLabel: get('difficultyLabel'),
      rallyLabel: get('rallyLabel'),
      bestRallyLabel: get('bestRallyLabel'),
      leftStatusIcons: get('leftStatusIcons'),
      globalStatusIcons: get('globalStatusIcons'),
      rightStatusIcons: get('rightStatusIcons'),
      statusPill: get('statusPill'),
      menu: get('menuOverlay'),
      help: get('helpOverlay'),
      pause: get('pauseOverlay'),
      gameOver: get('gameOverOverlay'),
      winnerTitle: get('winnerTitle'),
      winnerSubtitle: get('winnerSubtitle'),
      gameOverScoreLine: get('gameOverScoreLine'),
      gameOverMatchStats: get('gameOverMatchStats'),
      gameOverHistoryStats: get('gameOverHistoryStats'),
      menuBestRally: get('menuBestRally'),
      lastWinnerStat: get('lastWinnerStat'),
      energyStat: get('energyStat'),
      pauseScoreLine: get('pauseScoreLine'),
      pauseBallCount: get('pauseBallCount'),
      pausePowerCount: get('pausePowerCount'),
      pauseScoreLimit: get('pauseScoreLimit'),
      menuVersion: get('menuVersion'),
      modeSelect: get('modeSelect'),
      difficultySelect: get('difficultySelect'),
      scoreLimitSelect: get('scoreLimitSelect'),
      themeSelect: get('themeSelect'),
      powerupsToggle: get('powerupsToggle'),
      trailToggle: get('trailToggle')
    };
  }

  function createRuntime(options = {}) {
      const documentRef = options.document || null;
      const windowRef = options.window || (documentRef && documentRef.defaultView) || root || null;
      const canvas = options.canvas || (documentRef ? documentRef.getElementById('gameCanvas') : null);
      const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      const ui = options.ui || createUIBindings(documentRef);
      const config = options.config || (root && root.WavePong && root.WavePong.CONFIG) || null;
      const runtimeVersion = options.runtimeVersion || (root && root.WavePong && root.WavePong.VERSION) || null;
      const storageAdapter = options.storage || null;
      const headless = !!options.headless || !documentRef;
      if (!config) {
        throw new Error('Wave Pong config missing. Load js/config.js before the runtime.');
      }

      if (ui.menuVersion && runtimeVersion) {
        ui.menuVersion.textContent = 'v' + runtimeVersion;
      }

      const {
        storage,
        defaults,
        balance,
        defaultHistory,
        powerupDefs,
        wittyLines,
        themes,
        difficultyMap
      } = config;
      const canvasBalance = balance.canvas;
      const paddleBalance = balance.paddle;
      const ballBalance = balance.ball;
      const chargeBalance = balance.charge;
      const waveLevelBalance = balance.waveLevels;
      const xpBalance = balance.xp;
      const waveAimBalance = balance.waveAim;
      const paddleControlBalance = balance.paddleControl;
      const aiBalance = balance.ai;
      const waveBalance = balance.waves;
      const blueWaveInteractionBalance = balance.blueWaveInteraction;
      const pinkWaveInteractionBalance = balance.pinkWaveInteraction;
      const goldWaveInteractionBalance = balance.goldWaveInteraction;
      const rallyBalance = balance.rally;
      const matchFlowBalance = balance.matchFlow;
      const powerupBalance = balance.powerups;
      const paddleHitBalance = balance.paddleHit;
      const ballBoostBalance = ballBalance.boost;

      const W = canvasBalance.width;
      const H = canvasBalance.height;
      const pauseButtonRect = {
        x: W / 2 - 38,
        y: 16,
        width: 76,
        height: 32,
        radius: 12
      };
      let scale = 1;
      let lastFrameTime = 0;
      let loopHandle = null;
      let fixedAccumulator = 0;
      let audioCtx = null;
      let history;
      let lastWinner = 'None';
      let matchStats;
      let screenShake = 0;
      let nextBallId = 1;
      let mounted = false;
      let muted = false;
      const fixedTickRate = Math.max(30, Number(options.tickRate) || DEFAULT_TICK_RATE);
      const fixedDt = 1 / fixedTickRate;
      const decisionIntervalTicks = Math.max(1, Number(options.decisionIntervalTicks) || DEFAULT_DECISION_INTERVAL_TICKS);
      const initialSeed = normalizeSeed(options.seed);
      const rng = createSeededRandom(initialSeed);
      const replay = {
        version: 1,
        seed: initialSeed,
        configHash: hashString(stableSerialize(config.balance || config)),
        actions: [],
        events: [],
        stateHashes: []
      };
      const eventQueue = [];
      const inputQueue = {
        left: new Map(),
        right: new Map()
      };
      const controllerSlots = {
        left: (options.controllers && options.controllers.left) || null,
        right: (options.controllers && options.controllers.right) || null
      };
      let inputProvider = typeof options.inputProvider === 'function' ? options.inputProvider : null;
      let liveInputEnabled = options.liveInputEnabled !== false;

      function normalizeDifficulty(value) {
        const difficulty = String(value || '').toLowerCase();
        if (difficulty === 'ridiculous' || difficulty === 'absurd') return 'absurd';
        if (difficulty === 'chill' || difficulty === 'spicy') return difficulty;
        return 'spicy';
      }

      function formatDifficultyLabel(value) {
        const difficulty = normalizeDifficulty(value);
        if (difficulty === 'chill') return 'Chill';
        if (difficulty === 'spicy') return 'Spicy';
        return 'Ridiculous';
      }

      function getSelectedDifficultyOption() {
        return ui.difficultySelect && ui.difficultySelect.selectedIndex >= 0
          ? ui.difficultySelect.options[ui.difficultySelect.selectedIndex]
          : null;
      }

      function getSelectedDifficulty() {
        const option = getSelectedDifficultyOption();
        const optionDifficulty = option && option.dataset ? option.dataset.difficulty : '';
        return normalizeDifficulty(optionDifficulty || (ui.difficultySelect ? ui.difficultySelect.value : defaults.difficulty));
      }

      function getDifficultyConfig(difficulty) {
        const normalized = normalizeDifficulty(difficulty);
        return difficultyMap[normalized] || difficultyMap.spicy;
      }

      function focusGameCanvas() {
        if (!canvas || typeof canvas.focus !== 'function') return;
        try {
          canvas.focus({ preventScroll: true });
        } catch (err) {
          canvas.focus();
        }
      }

      function shouldCaptureGameplayKeys() {
        const helpOpen = ui.help && !ui.help.classList.contains('hidden');
        return !state.menuOpen && !helpOpen;
      }

      function beginPlayCountdown(context = 'start') {
        const countdownLabel = String(Math.max(1, Math.ceil(matchFlowBalance.countdownSeconds)));
        state.countdownActive = true;
        state.countdownContext = context;
        state.countdownDuration = matchFlowBalance.countdownSeconds;
        state.countdownTimer = matchFlowBalance.countdownSeconds;
        focusGameCanvas();
        updateStatus(context === 'resume'
          ? ('Resuming in ' + countdownLabel + '. Fire to skip.')
          : ('Starting in ' + countdownLabel + '. Fire to skip.'));
      }

      function finishPlayCountdown(skipped = false) {
        state.countdownActive = false;
        state.countdownTimer = 0;
        state.countdownDuration = matchFlowBalance.countdownSeconds;
        updateStatus(skipped ? 'Countdown skipped. Play live.' : 'Play live. Brace for geometry.');
      }

      function skipPlayCountdown() {
        if (!state.countdownActive) return false;
        finishPlayCountdown(true);
        return true;
      }

      function updatePlayCountdown(dt) {
        if (!state.countdownActive) return;
        state.countdownTimer = Math.max(0, state.countdownTimer - dt);
        if (state.countdownTimer <= 0) {
          finishPlayCountdown(false);
        }
      }

      const BALL_SPEED_CAP = ballBalance.speedCap;
      const BLUE_WAVE_COST = chargeBalance.blueCost;
      const PINK_WAVE_COST = chargeBalance.pinkCost;
      const GOLD_WAVE_COST = chargeBalance.goldCost;
      const MIN_FIRE_CHARGE = BLUE_WAVE_COST;
      const SOLID_CHARGE_THRESHOLD = PINK_WAVE_COST;
      const FULL_CHARGE_THRESHOLD = GOLD_WAVE_COST;
      const BASE_MAX_CHARGE = chargeBalance.baseMax;
      const OVERCAP_MAX_CHARGE = chargeBalance.overcapMax;
      const HISTORY_KEY = storage.historyKey;
      const BEST_RALLY_KEY = storage.bestRallyKey;
      const MAX_WAVE_LEVEL = waveLevelBalance.max;
      const WAVE_LEVEL_XP = waveLevelBalance.xpThresholds;
      const PASSIVE_XP_PER_SEC = xpBalance.passivePerSecond;
      const GOAL_XP = xpBalance.goal;
      const OPPONENT_HIT_XP = xpBalance.opponentHit;
      const PULSE_POWERUP_XP = xpBalance.powerupSurge;
      const MINION_XP = xpBalance.minion;
      const DEBUFF_XP_LOSS = xpBalance.debuffLoss;
      const YELLOW_HIT_XP_LOSS = xpBalance.goldHitLoss;

      function safeStorageGetItem(key) {
        try {
          if (storageAdapter && typeof storageAdapter.getItem === 'function') {
            return storageAdapter.getItem(key);
          }
          if (windowRef && windowRef.localStorage) {
            return windowRef.localStorage.getItem(key);
          }
          return null;
        } catch (err) {
          return null;
        }
      }

      function safeStorageSetItem(key, value) {
        try {
          if (storageAdapter && typeof storageAdapter.setItem === 'function') {
            storageAdapter.setItem(key, value);
            return true;
          }
          if (windowRef && windowRef.localStorage) {
            windowRef.localStorage.setItem(key, value);
            return true;
          }
          return true;
        } catch (err) {
          return false;
        }
      }

      function loadHistory() {
        try {
          const raw = safeStorageGetItem(HISTORY_KEY);
          if (!raw) return { ...defaultHistory };
          return { ...defaultHistory, ...JSON.parse(raw) };
        } catch (err) {
          return { ...defaultHistory };
        }
      }

      function saveHistory(history) {
        safeStorageSetItem(HISTORY_KEY, JSON.stringify(history));
      }

      function createMatchStats() {
        return {
          leftShots: 0,
          rightShots: 0,
          leftBallHits: 0,
          rightBallHits: 0,
          leftWaveHits: 0,
          rightWaveHits: 0,
          leftPowerups: 0,
          rightPowerups: 0,
          leftRoleMetrics: createRoleMetrics(),
          rightRoleMetrics: createRoleMetrics(),
          longestRally: 0
        };
      }

      function createRoleMetrics() {
        return {
          blueShots: 0,
          pinkShots: 0,
          goldShots: 0,
          blueBallHits: 0,
          pinkBallHits: 0,
          goldBallHits: 0,
          blueTowardHits: 0,
          blueAwayHits: 0,
          blueResistGrants: 0,
          pinkThreatHits: 0,
          pinkEmergencyHits: 0,
          blueWavePowerups: 0,
          pinkWavePowerups: 0,
          goldWavePowerups: 0,
          goldPaddleHits: 0,
          goldCenterHits: 0
        };
      }

      function getRoleMetricsForSide(side) {
        return side === 'left' ? matchStats.leftRoleMetrics : matchStats.rightRoleMetrics;
      }
      history = loadHistory();
      lastWinner = history.lastWinner || 'None';
      matchStats = createMatchStats();

      const input = {
        w: false,
        s: false,
        up: false,
        down: false,
        leftFireQueued: false,
        rightFireQueued: false
      };
      const controllerActionState = {
        left: { moveAxis: 0, fire: false, lastTick: -1 },
        right: { moveAxis: 0, fire: false, lastTick: -1 }
      };

      const REDUCED_WAVE_FX = (() => {
        try {
          return !windowRef || windowRef.self !== windowRef.top;
        } catch (err) {
          return true;
        }
      })();

      const state = {
        running: false,
        paused: false,
        menuOpen: true,
        gameOver: false,
        demoMode: false,
        mode: defaults.mode,
        difficulty: defaults.difficulty,
        scoreLimit: defaults.scoreLimit,
        powerupsEnabled: defaults.powerupsEnabled,
        trailsEnabled: defaults.trailsEnabled,
        theme: defaults.theme,
        bestRally: Number(history.bestRally || safeStorageGetItem(BEST_RALLY_KEY) || 0),
        powerSpawnTimer: powerupBalance.spawn.initialDelayBaseSeconds + powerupBalance.spawn.initialDelayRandomSeconds,
        powerDurationTimer: 0,
        lastPowerType: null,
        leftScore: 0,
        rightScore: 0,
        rally: 0,
        roundSeconds: 0,
        serveDirection: 1,
        leftBoostTimer: 0,
        rightBoostTimer: 0,
        slowmoTimer: 0,
        comboFlash: 0,
        impacts: 0,
        nextLongRallySpawnAt: rallyBalance.initialSpawnAtSeconds,
        helpReturnToPause: false,
        lowPerfEffects: REDUCED_WAVE_FX,
        countdownActive: false,
        countdownTimer: 0,
        countdownDuration: matchFlowBalance.countdownSeconds,
        countdownContext: 'start',
        longRallyMultiballEnabled: true,
        playerLabels: {
          left: null,
          right: null
        },
        modeLabelOverride: '',
        opponentLabelOverride: '',
        tick: 0,
        simulationTimeMs: 0,
        presentationTimeMs: 0
      };

      const world = {
        paddles: {
          left: createPaddle(paddleBalance.leftX, H / 2 - paddleBalance.height / 2, 'left'),
          right: createPaddle(W - paddleBalance.rightXOffset, H / 2 - paddleBalance.height / 2, 'right')
        },
        balls: [],
        goalFlashes: [],
        particles: [],
        powerups: [],
        pulses: [],
        floatTexts: []
      };

      function createPaddle(x, y, side) {
        return {
          x,
          y,
          w: paddleBalance.width,
          h: paddleBalance.height,
          baseH: paddleBalance.height,
          vy: 0,
          speed: paddleBalance.speed,
          side,
          flash: 0,
          hitScale: 1,
          aiJitter: 0,
          aimAngle: side === 'left' ? 0 : Math.PI,
          targetAimAngle: side === 'left' ? 0 : Math.PI,
          cooldown: 0,
          jamTimer: 0,
          pulseLevel: 1,
          waveXP: 0,
          pulseCharge: BASE_MAX_CHARGE,
          maxCharge: BASE_MAX_CHARGE,
          overcapTimer: 0,
          chargeBoostTimer: 0,
          chargeGlowPhase: rng.next() * Math.PI * 2,
          slowTimer: 0
        };
      }

      function createBall(direction = 1, x = W / 2, y = H / 2) {
        const baseSpeed = getDifficultyConfig(state.difficulty).ballSpeed;
        const sign = rng.next() < 0.5 ? -1 : 1;
        const angle = sign * (ballBalance.initialAngleBase + rng.next() * ballBalance.initialAngleRange);
        return {
          id: nextBallId++,
          x,
          y,
          r: ballBalance.radius,
          vx: Math.cos(angle) * baseSpeed * direction,
          vy: Math.sin(angle) * baseSpeed,
          trail: [],
          flash: 1,
          hueShift: rng.next() * Math.PI * 2,
          lastHitSide: null,
          boostTimer: 0,
          boostIntensity: 0,
          boostAcceleration: 0,
          boostMaxSpeed: BALL_SPEED_CAP,
          boostColor: '#7bd2ff',
          stunTimer: 0,
          storedVx: 0,
          storedVy: 0,
          blueResistTimer: 0,
          blueResistStrength: 0,
          serveHoldTimer: 0,
          serveHoldDuration: 0,
          serveReleaseVx: 0,
          serveReleaseVy: 0
        };
      }

      function getBallRenderColor(ball, palette = themes[state.theme]) {
        if (ball.lastHitSide === 'left') return palette.paddleLeft;
        if (ball.lastHitSide === 'right') return palette.paddleRight;
        return palette.ball;
      }

      function applyServeHold(ball) {
        const holdSeconds = Math.max(0, Number(matchFlowBalance.serveHoldSeconds) || 0);
        ball.serveHoldDuration = holdSeconds;
        ball.serveHoldTimer = holdSeconds;
        if (holdSeconds <= 0) {
          ball.serveReleaseVx = 0;
          ball.serveReleaseVy = 0;
          return ball;
        }
        ball.serveReleaseVx = ball.vx;
        ball.serveReleaseVy = ball.vy;
        ball.vx = 0;
        ball.vy = 0;
        ball.trail.length = 0;
        return ball;
      }

      function storeBestRally(value) {
        state.bestRally = value;
        safeStorageSetItem(BEST_RALLY_KEY, String(value));
        history.bestRally = Math.max(history.bestRally || 0, value);
        saveHistory(history);
      }

      function formatStat(value) {
        return typeof value === 'number' ? String(Math.round(value)) : String(value);
      }

      function makeStatusIcon(symbol, tone, title) {
        return '<span class="statusIcon ' + tone + '" title="' + title + '">' + symbol + '</span>';
      }

      function chargeIconFor(paddle) {
        if ((paddle.pulseCharge || 0) >= FULL_CHARGE_THRESHOLD) return { symbol: '☀', tone: 'push', title: 'Max charge' };
        if ((paddle.pulseCharge || 0) >= SOLID_CHARGE_THRESHOLD) return { symbol: '◆', tone: 'solid', title: 'Solid charge' };
        return { symbol: '~', tone: 'wave', title: 'Wave charge' };
      }

      function getPaddleEffectTokens(paddle) {
        const icons = [];
        if (paddle.overcapTimer > 0.05) icons.push({ symbol: '▰', tone: 'buff', title: 'Cap Bank active' });
        if (paddle.chargeBoostTimer > 0.05) icons.push({ symbol: '≫', tone: 'buff', title: 'Rapid Charge active' });
        if (paddle.h > paddle.baseH + 8) icons.push({ symbol: '⇕', tone: 'buff', title: 'Mega Paddle active' });
        if (paddle.h < paddle.baseH - 8) icons.push({ symbol: '⇣', tone: 'debuff', title: 'Shrink Hex active' });
        if (paddle.slowTimer > 0.05) icons.push({ symbol: '⌛', tone: 'debuff', title: 'Drag Field active' });
        if (paddle.jamTimer > 0.05) icons.push({ symbol: '✶', tone: 'debuff', title: 'Aim Jam active' });
        return icons.slice(0, 3);
      }

      function renderStatusIcons() {
        const left = world.paddles.left;
        const right = world.paddles.right;

        function iconsForPaddle(paddle) {
          const tokens = [chargeIconFor(paddle), { symbol: 'L' + paddle.pulseLevel, tone: 'neutral', title: 'Wave level ' + paddle.pulseLevel }, ...getPaddleEffectTokens(paddle)];
          return tokens.map(token => makeStatusIcon(token.symbol, token.tone, token.title)).join('');
        }

        const globalIcons = [];
        if (world.balls.length > 1) globalIcons.push(makeStatusIcon('◎' + world.balls.length, 'buff', 'Multiball active'));
        if (state.slowmoTimer > 0.05) globalIcons.push(makeStatusIcon('⏳', 'neutral', 'Time distortion active'));
        if (world.powerups.length > 0) {
          const def = powerupDefs[world.powerups[0].type];
          globalIcons.push(makeStatusIcon(def.kind === 'debuff' ? '!' : '+', def.kind === 'minion' ? 'buff' : def.kind, 'Powerup on field'));
        }
        if (!globalIcons.length) globalIcons.push(makeStatusIcon('·', 'neutral empty', 'No global effects'));

        if (ui.leftStatusIcons) ui.leftStatusIcons.innerHTML = iconsForPaddle(left);
        if (ui.rightStatusIcons) ui.rightStatusIcons.innerHTML = iconsForPaddle(right);
        if (ui.globalStatusIcons) ui.globalStatusIcons.innerHTML = globalIcons.join('');
      }

      function spawnFloatText(x, y, text, kind = 'buff') {
        world.floatTexts.push({
          x,
          y,
          text,
          kind,
          life: 1.65,
          maxLife: 1.65,
          driftX: (rng.next() - 0.5) * 18,
          driftY: -34 - rng.next() * 12
        });
      }

      function updateFloatTexts(dt) {
        for (let i = world.floatTexts.length - 1; i >= 0; i--) {
          const t = world.floatTexts[i];
          t.life -= dt;
          t.x += t.driftX * dt;
          t.y += t.driftY * dt;
          if (t.life <= 0) world.floatTexts.splice(i, 1);
        }
      }

      function renderFloatTexts() {
        for (const t of world.floatTexts) {
          const alpha = clamp(t.life / t.maxLife, 0, 1);
          const color = t.kind === 'debuff' ? '#ffd7e1' : '#dcffe8';
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.font = '800 18px Inter, Segoe UI, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 5;
          ctx.strokeStyle = 'rgba(4, 9, 18, 0.82)';
          ctx.fillStyle = color;
          ctx.strokeText(t.text, t.x, t.y);
          ctx.fillText(t.text, t.x, t.y);
          ctx.restore();
        }
      }

      function buildCompareGrid(rows, leftLabel, rightLabel) {
        let html = '<div class="compareHeader"><div>' + leftLabel + '</div><div style="text-align:center;">Metric</div><div style="text-align:right;">' + rightLabel + '</div></div>';
        for (const row of rows) {
          html += '<div class="compareRow"><div class="leftVal">' + formatStat(row.left) + '</div><div class="metric">' + row.label + '</div><div class="rightVal">' + formatStat(row.right) + '</div></div>';
        }
        return html;
      }

      function renderGameOverStats() {
        const leftLabel = ui.leftName.textContent;
        const rightLabel = ui.rightName.textContent;
        ui.gameOverScoreLine.textContent = leftLabel + ' ' + state.leftScore + ' : ' + state.rightScore + ' ' + rightLabel;

        const matchRows = [
          { label: 'Goals', left: state.leftScore, right: state.rightScore },
          { label: 'Ball Hits', left: matchStats.leftBallHits, right: matchStats.rightBallHits },
          { label: 'Waves Fired', left: matchStats.leftShots, right: matchStats.rightShots },
          { label: 'Wave Hits', left: matchStats.leftWaveHits, right: matchStats.rightWaveHits },
          { label: 'Powerups', left: matchStats.leftPowerups, right: matchStats.rightPowerups },
          { label: 'Best Rally', left: matchStats.longestRally, right: matchStats.longestRally }
        ];

        const historyRows = [
          { label: 'Wins', left: history.leftWins, right: history.rightWins },
          { label: 'Goals', left: history.leftPoints, right: history.rightPoints },
          { label: 'Ball Hits', left: history.leftBallHits, right: history.rightBallHits },
          { label: 'Waves Fired', left: history.leftShots, right: history.rightShots },
          { label: 'Wave Hits', left: history.leftWaveHits, right: history.rightWaveHits },
          { label: 'Powerups', left: history.leftPowerups, right: history.rightPowerups }
        ];

        ui.gameOverMatchStats.innerHTML = buildCompareGrid(matchRows, leftLabel, rightLabel);
        ui.gameOverHistoryStats.innerHTML = buildCompareGrid(historyRows, leftLabel, rightLabel);
      }

      function recordMatchHistory(leftWon) {
        history.matches += 1;
        history.leftWins += leftWon ? 1 : 0;
        history.rightWins += leftWon ? 0 : 1;
        history.leftPoints += state.leftScore;
        history.rightPoints += state.rightScore;
        history.leftBallHits += matchStats.leftBallHits;
        history.rightBallHits += matchStats.rightBallHits;
        history.leftShots += matchStats.leftShots;
        history.rightShots += matchStats.rightShots;
        history.leftWaveHits += matchStats.leftWaveHits;
        history.rightWaveHits += matchStats.rightWaveHits;
        history.leftPowerups += matchStats.leftPowerups;
        history.rightPowerups += matchStats.rightPowerups;
        history.bestRally = Math.max(history.bestRally || 0, state.bestRally || 0, matchStats.longestRally || 0);
        const leftName = ui.leftName ? ui.leftName.textContent : 'LEFT';
        const rightName = ui.rightName ? ui.rightName.textContent : 'RIGHT';
        history.lastWinner = leftWon ? leftName : rightName;
        lastWinner = history.lastWinner;
        saveHistory(history);
      }

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function angleDiff(a, b) {
        let d = a - b;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return d;
      }

      function clampBallSpeed(ball, maxSpeed = BALL_SPEED_CAP) {
        const effectiveMaxSpeed = (ball.boostTimer || 0) > 0
          ? Math.max(maxSpeed, ball.boostMaxSpeed || maxSpeed)
          : maxSpeed;
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed <= effectiveMaxSpeed || speed === 0) return;
        const scaleFactor = effectiveMaxSpeed / speed;
        ball.vx *= scaleFactor;
        ball.vy *= scaleFactor;
      }

      function getPaddleMaxCharge(paddle) {
        return Math.max(BASE_MAX_CHARGE, paddle.maxCharge || BASE_MAX_CHARGE);
      }

      function refreshPaddleChargeState(paddle) {
        paddle.maxCharge = (paddle.overcapTimer || 0) > 0 ? OVERCAP_MAX_CHARGE : BASE_MAX_CHARGE;
        paddle.pulseCharge = clamp(paddle.pulseCharge || 0, 0, paddle.maxCharge);
        return paddle.maxCharge;
      }

      function setBallBoost(ball, duration, intensity, color, acceleration = 0, maxSpeed = BALL_SPEED_CAP) {
        ball.boostTimer = Math.max(ball.boostTimer || 0, duration);
        ball.boostIntensity = Math.max(ball.boostIntensity || 0, intensity);
        ball.boostAcceleration = Math.max(ball.boostAcceleration || 0, acceleration);
        ball.boostMaxSpeed = Math.max(ball.boostMaxSpeed || BALL_SPEED_CAP, maxSpeed);
        ball.boostColor = color;
      }

      function applyBallStun(ball, duration, vx, vy, color = waveBalance.blue.color) {
        ball.stunTimer = Math.max(ball.stunTimer || 0, duration);
        ball.storedVx = vx;
        ball.storedVy = vy;
        ball.vx = 0;
        ball.vy = 0;
        setBallBoost(
          ball,
          Math.max(blueWaveInteractionBalance.toward.feedbackBoostMinDuration, duration * blueWaveInteractionBalance.toward.feedbackBoostDurationScale),
          blueWaveInteractionBalance.toward.feedbackBoostIntensity,
          color
        );
      }

      function isBallMovingTowardPaddle(ball, side) {
        return side === 'left'
          ? ball.vx < -blueWaveInteractionBalance.velocityThreshold
          : ball.vx > blueWaveInteractionBalance.velocityThreshold;
      }

      function isBallMovingAwayFromPaddle(ball, side) {
        return side === 'left'
          ? ball.vx > blueWaveInteractionBalance.velocityThreshold
          : ball.vx < -blueWaveInteractionBalance.velocityThreshold;
      }

      function getLevelThreshold(level) {
        return WAVE_LEVEL_XP[Math.max(1, Math.min(MAX_WAVE_LEVEL, level))] || 0;
      }

      function syncPaddleLevel(paddle) {
        let level = 1;
        const xp = Math.max(0, paddle.waveXP || 0);
        for (let i = 2; i <= MAX_WAVE_LEVEL; i++) {
          if (xp >= getLevelThreshold(i)) level = i;
          else break;
        }
        paddle.waveXP = xp;
        paddle.pulseLevel = level;
        return level;
      }

      function getLevelProgress(paddle) {
        const level = syncPaddleLevel(paddle);
        if (level >= MAX_WAVE_LEVEL) return 1;
        const floor = getLevelThreshold(level);
        const ceil = getLevelThreshold(level + 1);
        if (ceil <= floor) return 1;
        return clamp(((paddle.waveXP || 0) - floor) / (ceil - floor), 0, 1);
      }

      function adjustWaveXP(paddle, delta, opts = {}) {
        const before = paddle.pulseLevel || 1;
        paddle.waveXP = Math.max(0, (paddle.waveXP || 0) + delta);
        const after = syncPaddleLevel(paddle);
        if (!opts.silent && after !== before) {
          spawnFloatText(paddle.x + paddle.w / 2, paddle.y - 14, after > before ? 'Wave L' + after : 'Wave Down', after > before ? 'buff' : 'debuff');
        }
        return after;
      }

      function sanitizeScoreLimit(value) {
        const parsed = Math.floor(Number(value));
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
      }

      function createReplacementBall(direction) {
        const ball = createBall(direction);
        ball.x = W / 2;
        ball.y = H / 2;
        ball.flash = 1;
        applyServeHold(ball);
        world.balls.push(ball);
        return ball;
      }

      function spawnGoalFlash(side, y, color) {
        const goalLight = matchFlowBalance.goalLight || {};
        const life = Math.max(0.05, Number(goalLight.durationSeconds) || 0.28);
        world.goalFlashes.push({
          side: side === 'right' ? 'right' : 'left',
          y: clamp(y, 28, H - 28),
          life,
          maxLife: life,
          length: Math.max(40, Number(goalLight.length) || 228),
          thickness: Math.max(8, Number(goalLight.thickness) || 28),
          originInset: Math.max(0, Number(goalLight.originInset) || 18),
          color: color || themes[state.theme].ball
        });
        if (world.goalFlashes.length > 6) {
          world.goalFlashes.splice(0, world.goalFlashes.length - 6);
        }
      }

      function getPulseOrigin(paddle) {
        return {
          x: paddle.side === 'left' ? paddle.x + paddle.w + 6 : paddle.x - 6,
          y: paddle.y + paddle.h / 2
        };
      }

      function pointSegmentDistance(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(px - x1, py - y1);
        const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
        const cx = x1 + dx * t;
        const cy = y1 + dy * t;
        return Math.hypot(px - cx, py - cy);
      }

      function getPulseArcEndpoints(pulse) {
        const radius = pulse.arcRadius || pulse.range || 0;
        const start = pulse.angle - pulse.cone;
        const end = pulse.angle + pulse.cone;
        return {
          x1: pulse.x + Math.cos(start) * radius,
          y1: pulse.y + Math.sin(start) * radius,
          x2: pulse.x + Math.cos(end) * radius,
          y2: pulse.y + Math.sin(end) * radius
        };
      }

function getPulseThickness(pulse, extra = 0) {
  const base = pulse.renderThickness != null ? pulse.renderThickness : (pulse.waveThickness || 0);
  return Math.max(8, base + extra);
}

function getPulseHalfThickness(pulse, extra = 0) {
  return getPulseThickness(pulse, extra) * 0.5;
}

function pulseArcHitsBall(pulse, ball) {
  const radius = pulse.arcRadius || pulse.range || 0;
  return pulseArcSweepHitsBall(pulse, ball, radius, radius, 0);
}

function pulseArcPoseHitsBall(pulse, ball, cx, cy, thicknessBoost = 0) {
  const radius = pulse.arcRadius || pulse.range || 0;
  const halfThickness = getPulseHalfThickness(pulse, thicknessBoost);
  const dx = ball.x - cx;
  const dy = ball.y - cy;
  const dist = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  const collisionPad = ball.r * 0.78 + Math.min(6, halfThickness * 0.12);
  const anglePad = Math.min(0.3, Math.asin(clamp((collisionPad + halfThickness * 0.7) / Math.max(dist, 1), 0, 1)));
  if (Math.abs(angleDiff(angle, pulse.angle)) > pulse.cone + anglePad) return false;
  if (Math.abs(dist - radius) <= halfThickness + collisionPad) return true;
  const edge = getPulseArcEndpoints({ ...pulse, x: cx, y: cy });
  return pointSegmentDistance(ball.x, ball.y, edge.x1, edge.y1, edge.x2, edge.y2) <= halfThickness + collisionPad;
}

function pulseArcSweepHitsBall(pulse, ball, innerRadius, outerRadius, thicknessBoost = 0) {
  const halfThickness = getPulseHalfThickness(pulse, thicknessBoost);
  const dx = ball.x - pulse.x;
  const dy = ball.y - pulse.y;
  const dist = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  const collisionPad = ball.r * 0.76 + Math.min(6, halfThickness * 0.1);
  const anglePad = Math.min(0.32, Math.asin(clamp((collisionPad + halfThickness * 0.68) / Math.max(dist, 1), 0, 1)));
  if (Math.abs(angleDiff(angle, pulse.angle)) > pulse.cone + anglePad) return false;
  const minRadius = Math.min(innerRadius, outerRadius);
  const maxRadius = Math.max(innerRadius, outerRadius);
  if (dist >= Math.max(0, minRadius - halfThickness - collisionPad) && dist <= maxRadius + halfThickness + collisionPad) return true;
  const sampleRadius = clamp(dist, minRadius, maxRadius || minRadius);
  const edge = getPulseArcEndpoints({ ...pulse, arcRadius: sampleRadius });
  return pointSegmentDistance(ball.x, ball.y, edge.x1, edge.y1, edge.x2, edge.y2) <= halfThickness + collisionPad;
}

function pushPulseHitsBall(pulse, ball) {
  const prevX = pulse.prevX == null ? pulse.x : pulse.prevX;
  const prevY = pulse.prevY == null ? pulse.y : pulse.prevY;
  const travel = Math.hypot(pulse.x - prevX, pulse.y - prevY);
  const samples = Math.max(3, Math.ceil(travel / 10));
  const thicknessBoost = Math.max(ball.r * 0.38, getPulseHalfThickness(pulse) * 0.12);
  for (let s = 0; s <= samples; s++) {
    const t = s / samples;
    const cx = prevX + (pulse.x - prevX) * t;
    const cy = prevY + (pulse.y - prevY) * t;
    if (pulseArcPoseHitsBall(pulse, ball, cx, cy, thicknessBoost)) return true;
  }
  return false;
}

function pulseArcHitsPoint(px, py, pulse, radiusOverride = null) {
        const radius = radiusOverride == null ? (pulse.arcRadius || pulse.range || 0) : radiusOverride;
        const halfThickness = getPulseHalfThickness(pulse);
        const dx = px - pulse.x;
        const dy = py - pulse.y;
        const dist = Math.hypot(dx, dy) || 1;
        const diff = Math.abs(angleDiff(Math.atan2(dy, dx), pulse.angle));
        if (diff > pulse.cone) return false;
        return dist >= Math.max(0, radius - halfThickness) && dist <= radius + halfThickness;
      }

      function getPulseArcVerticalExtents(pulse, cx = pulse.x, cy = pulse.y) {
        const radius = pulse.arcRadius || pulse.range || 0;
        const halfThickness = getPulseHalfThickness(pulse);
        const candidates = [pulse.angle - pulse.cone, pulse.angle + pulse.cone];
        for (const vertical of [-Math.PI / 2, Math.PI / 2]) {
          if (Math.abs(angleDiff(vertical, pulse.angle)) <= pulse.cone + 0.0001) candidates.push(vertical);
        }
        const sines = candidates.map((a) => Math.sin(a));
        return {
          top: cy + Math.min(...sines) * radius - halfThickness,
          bottom: cy + Math.max(...sines) * radius + halfThickness
        };
      }

function getPulseRenderRadius(pulse) {
        return pulse.mode === 'push'
          ? (pulse.arcRadius || 0)
          : Math.max(0, pulse.range * (1 - pulse.life / pulse.maxLife));
      }

      function getPulseRenderAlpha(pulse) {
        const baseAlpha = clamp(pulse.life / pulse.maxLife, 0, 1);
        if (pulse.mode !== 'solid') return baseAlpha;
        const lingerMax = pulse.maxEndLingerTimer || 0;
        if (lingerMax <= 0 || (pulse.endLingerTimer || 0) <= 0) return baseAlpha;
        return Math.max(baseAlpha, (pulse.endLingerTimer / lingerMax) * pinkWaveInteractionBalance.endpointLinger.visualAlphaMultiplier);
      }

      function pulseArcIntersectsPulse(pushPulse, otherPulse) {
        if (pushPulse.side === otherPulse.side || otherPulse.mode !== 'solid') return false;
        const otherRadius = getPulseRenderRadius(otherPulse);
        if (otherRadius <= 0) return false;
        const midX = otherPulse.x + Math.cos(otherPulse.angle) * otherRadius;
        const midY = otherPulse.y + Math.sin(otherPulse.angle) * otherRadius;
        if (pulseArcHitsPoint(midX, midY, pushPulse)) return true;
        const otherEdge = getPulseArcEndpoints({ ...otherPulse, arcRadius: otherRadius });
        return pulseArcHitsPoint(otherEdge.x1, otherEdge.y1, pushPulse) || pulseArcHitsPoint(otherEdge.x2, otherEdge.y2, pushPulse);
      }

      function pulseArcHitsPaddle(pulse, paddle) {
        const centerX = paddle.x + paddle.w / 2;
        const centerY = paddle.y + paddle.h / 2;
        const dx = centerX - pulse.x;
        const dy = centerY - pulse.y;
        const dist = Math.hypot(dx, dy) || 1;
        const diff = Math.abs(angleDiff(Math.atan2(dy, dx), pulse.angle));
        const radius = pulse.arcRadius || pulse.range || 0;
        const halfThickness = getPulseHalfThickness(pulse) + Math.max(paddle.w, paddle.h) * 0.18;
        if (diff <= pulse.cone + 0.08 && Math.abs(dist - radius) <= halfThickness) return true;
        const edge = getPulseArcEndpoints(pulse);
        return pointSegmentDistance(centerX, centerY, edge.x1, edge.y1, edge.x2, edge.y2) <= halfThickness + Math.max(paddle.w, paddle.h) * 0.08;
      }

      function getPulseStats(paddle) {
        const level = clamp(syncPaddleLevel(paddle) || 1, 1, MAX_WAVE_LEVEL);
        const charge = clamp(paddle.pulseCharge || 0, 0, getPaddleMaxCharge(paddle));
        const solidReady = charge >= SOLID_CHARGE_THRESHOLD;
        const fullReady = charge >= FULL_CHARGE_THRESHOLD;

        if (fullReady) {
          const thickness = waveBalance.gold.thicknessBase + level * waveBalance.gold.thicknessPerLevel;
          return {
            level,
            charge,
            waveType: 'gold',
            mode: 'push',
            chargeCost: GOLD_WAVE_COST,
            range: W,
            strength: waveBalance.gold.strengthBase + level * waveBalance.gold.strengthPerLevel,
            cone: waveBalance.gold.coneBase + level * waveBalance.gold.conePerLevel,
            cooldown: waveBalance.gold.cooldown,
            life: waveBalance.gold.life,
            speed: waveBalance.gold.speedBase + level * waveBalance.gold.speedPerLevel,
            arcRadius: waveBalance.gold.arcRadiusBase + level * waveBalance.gold.arcRadiusPerLevel,
            waveThickness: thickness,
            renderThickness: thickness,
            color: waveBalance.gold.color,
            glow: waveBalance.gold.glow,
            fill: waveBalance.gold.fill
          };
        }

        if (solidReady) {
          const thickness = waveBalance.pink.thicknessBase + level * waveBalance.pink.thicknessPerLevel;
          const extraCharge = charge - SOLID_CHARGE_THRESHOLD;
          return {
            level,
            charge,
            waveType: 'pink',
            mode: 'solid',
            chargeCost: PINK_WAVE_COST,
            range: waveBalance.pink.rangeBase + level * waveBalance.pink.rangePerLevel + extraCharge * waveBalance.pink.rangeChargeScale,
            strength: waveBalance.pink.strengthBase + level * waveBalance.pink.strengthPerLevel + charge * waveBalance.pink.strengthChargeScale,
            cone: waveBalance.pink.coneBase + level * waveBalance.pink.conePerLevel,
            cooldown: waveBalance.pink.cooldown,
            life: waveBalance.pink.lifeBase + Math.min(waveBalance.pink.lifeBonusCap, waveBalance.pink.lifeBonusBase + extraCharge * waveBalance.pink.lifeChargeScale),
            endLingerSeconds: pinkWaveInteractionBalance.endpointLinger.durationSeconds,
            waveThickness: thickness,
            renderThickness: thickness,
            color: waveBalance.pink.color,
            glow: waveBalance.pink.glow,
            fill: waveBalance.pink.fill
          };
        }

        const thickness = waveBalance.blue.thicknessBase + level * waveBalance.blue.thicknessPerLevel;
        const usableCharge = Math.max(charge, BLUE_WAVE_COST);
        return {
          level,
          charge,
          waveType: 'blue',
          mode: 'wave',
          chargeCost: BLUE_WAVE_COST,
          range: waveBalance.blue.rangeBase + usableCharge * waveBalance.blue.rangeChargeScale + level * waveBalance.blue.rangePerLevel,
          strength: waveBalance.blue.strengthBase + usableCharge * waveBalance.blue.strengthChargeScale + level * waveBalance.blue.strengthPerLevel,
          cone: waveBalance.blue.coneBase + usableCharge * waveBalance.blue.coneChargeScale + level * waveBalance.blue.conePerLevel,
          cooldown: waveBalance.blue.cooldown,
          life: waveBalance.blue.lifeBase + usableCharge * waveBalance.blue.lifeChargeScale,
          waveThickness: thickness,
          renderThickness: thickness,
          color: waveBalance.blue.color,
          glow: waveBalance.blue.glow,
          fill: waveBalance.blue.fill
        };
      }

function updatePaddleAim(paddle, dt) {
        const base = paddle.side === 'left' ? 0 : Math.PI;
        const delta = clamp(paddle.vy / Math.max(500, paddle.speed), -1, 1) * waveAimBalance.tiltScale;
        paddle.targetAimAngle = paddle.side === 'left' ? base + delta : base - delta;
        if (paddle.jamTimer > 0) {
          paddle.targetAimAngle += Math.sin(state.simulationTimeMs * waveAimBalance.jamWobbleSpeed + (paddle.side === 'left' ? 0 : 1.9)) * waveAimBalance.jamWobbleAmplitude * Math.min(1, paddle.jamTimer + 0.25);
        }
        paddle.aimAngle += angleDiff(paddle.targetAimAngle, paddle.aimAngle) * Math.min(1, dt * waveAimBalance.smoothing);
      }

function firePulse(paddle) {
  refreshPaddleChargeState(paddle);
  if (paddle.cooldown > 0 || paddle.jamTimer > waveAimBalance.jamFireLockSeconds || (paddle.pulseCharge || 0) < MIN_FIRE_CHARGE) return false;
  const origin = getPulseOrigin(paddle);
  const currentCharge = clamp(paddle.pulseCharge || 0, 0, getPaddleMaxCharge(paddle));
  const stats = getPulseStats(paddle);
  const usedCharge = Math.min(currentCharge, stats.chargeCost || currentCharge);
  paddle.cooldown = Math.max(paddle.cooldown, stats.cooldown);
  paddle.pulseCharge = Math.max(0, currentCharge - (stats.chargeCost || currentCharge));

  if (paddle.side === 'left') matchStats.leftShots += 1;
  else matchStats.rightShots += 1;
  const roleMetrics = getRoleMetricsForSide(paddle.side);
  if (stats.waveType === 'blue') roleMetrics.blueShots += 1;
  else if (stats.waveType === 'pink') roleMetrics.pinkShots += 1;
  else if (stats.waveType === 'gold') roleMetrics.goldShots += 1;
  emitRuntimeEvent('pulse-fired', {
    side: paddle.side,
    waveType: stats.waveType,
    mode: stats.mode,
    level: stats.level,
    chargeCost: stats.chargeCost
  });

  if (stats.mode === 'push') {
    world.pulses.push({
      mode: 'push',
      x: origin.x,
      y: origin.y,
      prevX: origin.x,
      prevY: origin.y,
      angle: paddle.aimAngle,
      side: paddle.side,
      life: stats.life,
      maxLife: stats.life,
      waveType: stats.waveType,
      strength: stats.strength,
      level: stats.level,
      arcRadius: stats.arcRadius,
      cone: stats.cone,
      waveThickness: stats.waveThickness,
      renderThickness: stats.renderThickness,
      color: stats.color,
      glow: stats.glow,
      fill: stats.fill,
      vx: Math.cos(paddle.aimAngle) * stats.speed,
      vy: Math.sin(paddle.aimAngle) * stats.speed,
      trail: [],
      trailSpawnTimer: 0,
      diffraction: [],
      hitBallIds: new Set(),
      hitPaddleIds: new Set()
    });
  } else {
      world.pulses.push({
        mode: stats.mode,
        waveType: stats.waveType,
        x: origin.x,
        y: origin.y,
        angle: paddle.aimAngle,
      side: paddle.side,
      life: stats.life,
      maxLife: stats.life,
      range: stats.range,
      strength: stats.strength,
      cone: stats.cone,
        waveThickness: stats.waveThickness,
        renderThickness: stats.renderThickness,
        level: stats.level,
        radius: 0,
        endLingerTimer: stats.endLingerSeconds || 0,
        maxEndLingerTimer: stats.endLingerSeconds || 0,
        color: stats.color,
        glow: stats.glow,
        fill: stats.fill,
        hitBallIds: new Set()
    });
  }

  emitParticles(origin.x, origin.y, 14 + stats.level * 3, stats.color, 320 + stats.level * 24);
  playTone(420 + stats.level * 55 + usedCharge * 160, 0.07, 'triangle', 0.04);
  playTone(260 + stats.level * 30 + usedCharge * 120, 0.11, 'sine', 0.025);
  return true;
}

      function maybeTriggerLongRallyMultiball() {
        if (!state.longRallyMultiballEnabled) return;
        if (world.balls.length >= rallyBalance.stopAddingAtBallCount) return;
        const nextAt = state.nextLongRallySpawnAt || rallyBalance.initialSpawnAtSeconds;
        const rallyThreshold = rallyBalance.thresholdBase + Math.max(0, world.balls.length - 1) * rallyBalance.thresholdPerExtraBall;
        if (state.roundSeconds < nextAt && state.rally < rallyThreshold) return;
        state.nextLongRallySpawnAt = state.roundSeconds + rallyBalance.repeatDelayBaseSeconds + world.balls.length * rallyBalance.repeatDelayPerBallSeconds;
        const base = world.balls[(rng.next() * world.balls.length) | 0] || world.balls[0];
        const clone = createBall(base.vx >= 0 ? 1 : -1, W / 2, H / 2);
        clone.vx = base.vx * rallyBalance.cloneVxScale;
        clone.vy = (base.vy >= 0 ? -1 : 1) * Math.max(rallyBalance.cloneMinVy, Math.abs(base.vy) * rallyBalance.cloneVyScale);
        clampBallSpeed(clone, BALL_SPEED_CAP * rallyBalance.cloneCapMultiplier);
        world.balls.push(clone);
        updateStatus('Long rally chaos unlocked. Additional ball deployed.');
        playTone(980, 0.08, 'triangle', 0.04);
        emitParticles(W / 2, H / 2, 30, '#9fdcff', 360);
      }

      function resize() {
        if (!canvas || !ctx || !windowRef) return;
        const dpr = Math.max(1, Math.min(windowRef.devicePixelRatio || 1, 2));
        canvas.width = Math.floor(windowRef.innerWidth * dpr);
        canvas.height = Math.floor(windowRef.innerHeight * dpr);
        canvas.style.width = windowRef.innerWidth + 'px';
        canvas.style.height = windowRef.innerHeight + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        scale = Math.min(windowRef.innerWidth / W, windowRef.innerHeight / H);
      }

      function initAudio() {
        if (headless || !windowRef) return;
        if (!audioCtx) {
          const AC = windowRef.AudioContext || windowRef.webkitAudioContext;
          if (!AC) return;
          audioCtx = new AC();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
      }

      function emitRuntimeEvent(type, payload = {}) {
        const entry = {
          type,
          tick: state.tick,
          payload: deepClone(payload)
        };
        eventQueue.push(entry);
        replay.events.push(entry);
      }

      function playTone(freq, duration = 0.08, type = 'square', volume = 0.03) {
        emitRuntimeEvent('tone', { freq, duration, type, volume });
        if (muted || !audioCtx) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.01);
      }

      function updateStatus(text) {
        emitRuntimeEvent('status', { text });
        if (ui.statusPill) ui.statusPill.textContent = text;
      }

function resetMatch() {
  matchStats = createMatchStats();
  state.leftScore = 0;
  state.rightScore = 0;
  state.rally = 0;
  state.roundSeconds = 0;
  state.leftBoostTimer = 0;
  state.rightBoostTimer = 0;
  state.slowmoTimer = 0;
  state.comboFlash = 0;
  state.impacts = 0;
  state.powerSpawnTimer = powerupBalance.spawn.initialDelayBaseSeconds + rng.next() * powerupBalance.spawn.initialDelayRandomSeconds;
  state.powerDurationTimer = 0;
  state.lastPowerType = null;
  state.tick = 0;
  state.simulationTimeMs = 0;
  state.presentationTimeMs = 0;
  state.nextLongRallySpawnAt = rallyBalance.initialSpawnAtSeconds;
  world.powerups.length = 0;
  world.particles.length = 0;
  world.pulses.length = 0;
  world.floatTexts.length = 0;
  world.goalFlashes.length = 0;
  world.balls.length = 0;
  inputQueue.left.clear();
  inputQueue.right.clear();
  replay.actions.length = 0;
  replay.events.length = 0;
  replay.stateHashes.length = 0;
  eventQueue.length = 0;
  controllerActionState.left.moveAxis = 0;
  controllerActionState.left.fire = false;
  controllerActionState.right.moveAxis = 0;
  controllerActionState.right.fire = false;
  world.paddles.left.y = H / 2 - world.paddles.left.h / 2;
  world.paddles.right.y = H / 2 - world.paddles.right.h / 2;
  world.paddles.left.h = world.paddles.left.baseH;
  world.paddles.right.h = world.paddles.right.baseH;
  world.paddles.left.cooldown = 0;
  world.paddles.right.cooldown = 0;
  world.paddles.left.jamTimer = 0;
  world.paddles.right.jamTimer = 0;
  world.paddles.left.waveXP = 0;
  world.paddles.right.waveXP = 0;
  world.paddles.left.pulseLevel = 1;
  world.paddles.right.pulseLevel = 1;
  world.paddles.left.maxCharge = BASE_MAX_CHARGE;
  world.paddles.right.maxCharge = BASE_MAX_CHARGE;
  world.paddles.left.overcapTimer = 0;
  world.paddles.right.overcapTimer = 0;
  world.paddles.left.chargeBoostTimer = 0;
  world.paddles.right.chargeBoostTimer = 0;
  world.paddles.left.pulseCharge = BASE_MAX_CHARGE;
  world.paddles.right.pulseCharge = BASE_MAX_CHARGE;
  world.paddles.left.slowTimer = 0;
  world.paddles.right.slowTimer = 0;
  spawnServe(state.serveDirection);
  updateUI();
}

function spawnServe(direction) {
  state.serveDirection = direction;
  state.rally = 0;
  state.roundSeconds = 0;
  state.nextLongRallySpawnAt = rallyBalance.initialSpawnAtSeconds;
  createReplacementBall(direction);
  updateUI();
}

function startMatch({
  demo = false,
  mode = null,
  difficulty = null,
  scoreLimit = null,
  powerupsEnabled = null,
  longRallyMultiballEnabled = null,
  trailsEnabled = null,
  theme = null,
  skipCountdown = false,
  leftName = null,
  rightName = null,
  modeLabel = null,
  opponentLabel = null,
  liveInputEnabled: nextLiveInputEnabled = true,
  leftController = undefined,
  rightController = undefined
} = {}) {
        initAudio();
        state.mode = mode || (ui.modeSelect ? ui.modeSelect.value : defaults.mode);
        state.difficulty = normalizeDifficulty(difficulty != null ? difficulty : getSelectedDifficulty());
        state.scoreLimit = sanitizeScoreLimit(scoreLimit != null ? scoreLimit : (ui.scoreLimitSelect ? ui.scoreLimitSelect.value : defaults.scoreLimit));
        if (ui.scoreLimitSelect) ui.scoreLimitSelect.value = state.scoreLimit;
        state.powerupsEnabled = powerupsEnabled != null ? !!powerupsEnabled : (ui.powerupsToggle ? ui.powerupsToggle.checked : defaults.powerupsEnabled);
        state.longRallyMultiballEnabled = longRallyMultiballEnabled != null ? !!longRallyMultiballEnabled : true;
        state.trailsEnabled = trailsEnabled != null ? !!trailsEnabled : (ui.trailToggle ? ui.trailToggle.checked : defaults.trailsEnabled);
        state.theme = theme || (ui.themeSelect ? ui.themeSelect.value : defaults.theme);
        state.demoMode = demo;
        state.playerLabels.left = leftName || null;
        state.playerLabels.right = rightName || null;
        state.modeLabelOverride = modeLabel || '';
        state.opponentLabelOverride = opponentLabel || '';
        liveInputEnabled = nextLiveInputEnabled !== false;
        state.running = true;
        state.paused = false;
        state.menuOpen = false;
        state.gameOver = false;
        state.serveDirection = rng.next() > 0.5 ? 1 : -1;
        if (leftController !== undefined) {
          controllerSlots.left = leftController;
        } else if (demo && !controllerSlots.left && controllerSlots.right) {
          controllerSlots.left = typeof controllerSlots.right.clone === 'function'
            ? controllerSlots.right.clone()
            : controllerSlots.right;
        }
        if (rightController !== undefined) controllerSlots.right = rightController;
        if (ui.menu) ui.menu.classList.add('hidden');
        if (ui.pause) ui.pause.classList.add('hidden');
        if (ui.gameOver) ui.gameOver.classList.add('hidden');
        if (ui.help) ui.help.classList.add('hidden');
        state.helpReturnToPause = false;
        applyTheme(state.theme);
        resetMatch();
        if (skipCountdown || headless) {
          state.countdownActive = false;
          state.countdownTimer = 0;
        } else {
          beginPlayCountdown('start');
        }
        playTone(330, 0.08, 'triangle', 0.04);
        playTone(660, 0.12, 'triangle', 0.03);
      }

      function backToMenu() {
        state.running = false;
        state.paused = false;
        state.menuOpen = true;
        state.gameOver = false;
        state.countdownActive = false;
        state.countdownTimer = 0;
        state.playerLabels.left = null;
        state.playerLabels.right = null;
        state.modeLabelOverride = '';
        state.opponentLabelOverride = '';
        liveInputEnabled = true;
        if (ui.menu) ui.menu.classList.remove('hidden');
        if (ui.pause) ui.pause.classList.add('hidden');
        if (ui.gameOver) ui.gameOver.classList.add('hidden');
        if (ui.help) ui.help.classList.add('hidden');
        state.helpReturnToPause = false;
        updateStatus('Ready to embarrass a rectangle.');
        updateMenuStats();
      }

      function pauseGame(toggle) {
        if (!state.running || state.gameOver) return;
        const wasPaused = state.paused;
        state.paused = typeof toggle === 'boolean' ? toggle : !state.paused;
        if (!state.paused) {
          if (ui.help) ui.help.classList.add('hidden');
          state.helpReturnToPause = false;
        }
        if (ui.pause) ui.pause.classList.toggle('hidden', !state.paused);
        if (state.paused) {
          state.countdownActive = false;
          state.countdownTimer = 0;
          updateStatus('Paused. The ball is thinking about its choices.');
          playTone(260, 0.08, 'sine', 0.03);
        } else if (wasPaused) {
          beginPlayCountdown('resume');
          playTone(390, 0.08, 'sine', 0.03);
        }
      }

function endMatch(leftWon) {
  state.running = false;
  state.gameOver = true;
  state.countdownActive = false;
  state.countdownTimer = 0;
  const leftName = ui.leftName ? ui.leftName.textContent : 'LEFT';
  const rightName = ui.rightName ? ui.rightName.textContent : 'RIGHT';
  const name = leftWon ? leftName : rightName;
  emitRuntimeEvent('match-ended', {
    leftWon,
    leftScore: state.leftScore,
    rightScore: state.rightScore
  });
  recordMatchHistory(leftWon);
  if (ui.winnerTitle) ui.winnerTitle.textContent = name + ' Wins';
  if (ui.winnerSubtitle) ui.winnerSubtitle.textContent = wittyLines[(rng.next() * wittyLines.length) | 0];
  if (ui.gameOverMatchStats && ui.gameOverHistoryStats && ui.gameOverScoreLine) renderGameOverStats();
  if (ui.help) ui.help.classList.add('hidden');
  state.helpReturnToPause = false;
  if (ui.gameOver) ui.gameOver.classList.remove('hidden');
  updateMenuStats();
  updateStatus(name + ' won. The scoreboard has receipts.');
  playTone(leftWon ? 560 : 430, 0.12, 'triangle', 0.05);
  playTone(leftWon ? 720 : 510, 0.2, 'triangle', 0.04);
}

function updateMenuStats() {
  if (ui.menuBestRally) ui.menuBestRally.textContent = Math.max(state.bestRally || 0, history.bestRally || 0);
  if (ui.lastWinnerStat) ui.lastWinnerStat.textContent = lastWinner;
  if (ui.energyStat) ui.energyStat.textContent = 'Wave cap L' + MAX_WAVE_LEVEL;
}

function updateUI() {
  const selectedOpponentOption = getSelectedDifficultyOption();
  const selectedOpponentLabel = selectedOpponentOption && selectedOpponentOption.dataset && selectedOpponentOption.dataset.summary
    ? selectedOpponentOption.dataset.summary
    : (selectedOpponentOption ? selectedOpponentOption.textContent : formatDifficultyLabel(state.difficulty));
  const leftLabel = state.playerLabels.left || (state.demoMode ? 'CPU A' : 'PLAYER');
  const rightLabel = state.playerLabels.right || (state.mode === 'pvp' && !state.demoMode ? 'PLAYER 2' : (state.demoMode ? 'CPU B' : 'CPU'));
  const modeLabel = state.modeLabelOverride || (state.mode === 'pvp' && !state.demoMode ? 'VS HUMAN' : (state.demoMode ? 'DEMO' : 'VS CPU'));
  const opponentLabel = state.opponentLabelOverride || selectedOpponentLabel;
  if (ui.leftScore) ui.leftScore.textContent = state.leftScore;
  if (ui.rightScore) ui.rightScore.textContent = state.rightScore;
  if (ui.leftName) ui.leftName.textContent = leftLabel;
  if (ui.rightName) ui.rightName.textContent = rightLabel;
  if (ui.modeLabel) ui.modeLabel.textContent = modeLabel;
  if (ui.difficultyLabel) ui.difficultyLabel.textContent = opponentLabel;
  if (ui.rallyLabel) ui.rallyLabel.textContent = state.rally;
  if (ui.bestRallyLabel) ui.bestRallyLabel.textContent = Math.max(state.bestRally || 0, history.bestRally || 0);
  if (ui.pauseScoreLine) ui.pauseScoreLine.textContent = state.leftScore + ' : ' + state.rightScore;
  if (ui.pauseBallCount) ui.pauseBallCount.textContent = String(world.balls.length);
  if (ui.pausePowerCount) ui.pausePowerCount.textContent = String(world.powerups.length);
  if (ui.pauseScoreLimit) ui.pauseScoreLimit.textContent = String(state.scoreLimit);
  renderStatusIcons();
}

      function consumeQueuedHumanFire(side) {
        if (side === 'left') {
          const fire = !!input.leftFireQueued;
          input.leftFireQueued = false;
          return fire;
        }
        const fire = !!input.rightFireQueued;
        input.rightFireQueued = false;
        return fire;
      }

      function buildKeyboardAction(side) {
        if (side === 'left') {
          const up = input.w || (state.mode !== 'pvp' && input.up);
          const down = input.s || (state.mode !== 'pvp' && input.down);
          return {
            moveAxis: up === down ? 0 : (up ? -1 : 1),
            fire: consumeQueuedHumanFire('left')
          };
        }
        return {
          moveAxis: input.up === input.down ? 0 : (input.up ? -1 : 1),
          fire: consumeQueuedHumanFire('right')
        };
      }

      function resolveHumanAction(side) {
        const defaultAction = buildKeyboardAction(side);
        if (!inputProvider) return defaultAction;
        const provided = inputProvider({
          side,
          tick: state.tick,
          defaultAction,
          state,
          world,
          runtime: runtimeApi
        });
        return normalizeAction(provided || defaultAction);
      }

      function shouldQueueHumanInput(side) {
        if (!liveInputEnabled) return false;
        if (side === 'left') return !controllerSlots.left && !state.demoMode;
        return !controllerSlots.right && !state.demoMode && state.mode === 'pvp';
      }

      function maybeQueueHumanInput(side) {
        if (!shouldQueueHumanInput(side)) return;
        queueInput(side, state.tick, resolveHumanAction(side));
      }

function applyTheme(name) {
        const t = themes[name] || themes.neon;
        if (!documentRef) return;
        documentRef.documentElement.style.setProperty('--bg1', t.bgTop);
        documentRef.documentElement.style.setProperty('--bg2', t.bgBottom);
        documentRef.documentElement.style.setProperty('--accent', t.accent);
        documentRef.documentElement.style.setProperty('--accent-2', t.accent2);
      }

      function emitParticles(x, y, count, color, speed = 260) {
        if (!state.trailsEnabled) return;
        for (let i = 0; i < count; i++) {
          const a = rng.next() * Math.PI * 2;
          const s = speed * (0.2 + rng.next() * 0.8);
          world.particles.push({
            x,
            y,
            vx: Math.cos(a) * s,
            vy: Math.sin(a) * s,
            life: 0.45 + rng.next() * 0.35,
            maxLife: 0.45 + rng.next() * 0.35,
            size: 2 + rng.next() * 4,
            color
          });
        }
      }

function spawnPowerup() {
  const roll = rng.next();
  let type;
  if (roll < powerupBalance.spawn.minionChance) {
    type = 'minion';
  } else {
    const pool = powerupBalance.pool;
    type = pool[(rng.next() * pool.length) | 0];
  }
  world.powerups.push({
    type,
    x: W * (powerupBalance.spawn.xStartRatio + rng.next() * powerupBalance.spawn.xSpanRatio),
    y: powerupBalance.spawn.yPadding + rng.next() * (H - powerupBalance.spawn.ySpanPadding),
    r: type === 'minion' ? powerupBalance.spawn.minionRadius : powerupBalance.spawn.standardRadius,
    pulse: rng.next() * Math.PI * 2,
    life: type === 'minion' ? powerupBalance.spawn.minionLifeSeconds : powerupBalance.spawn.standardLifeSeconds
  });
  const def = powerupDefs[type];
  emitRuntimeEvent('powerup-spawned', { type, x: world.powerups[world.powerups.length - 1].x, y: world.powerups[world.powerups.length - 1].y });
  updateStatus('Field pickup spawned. ' + def.label + ' is live.');
  playTone(def.kind === 'minion' ? 860 : 780, 0.06, 'triangle', 0.03);
}


function collectPowerup(item, pickedByLeft, source = 'ball', waveType = null) {
  state.lastPowerType = null;
  const def = powerupDefs[item.type] || powerupDefs.grow;
  emitRuntimeEvent('powerup-collected', { type: item.type, pickedByLeft, source });
  if (pickedByLeft) matchStats.leftPowerups += 1;
  else matchStats.rightPowerups += 1;
  if (source === 'wave' && waveType) {
    const roleMetrics = getRoleMetricsForSide(pickedByLeft ? 'left' : 'right');
    if (waveType === 'blue') roleMetrics.blueWavePowerups += 1;
    else if (waveType === 'pink') roleMetrics.pinkWavePowerups += 1;
    else if (waveType === 'gold') roleMetrics.goldWavePowerups += 1;
  }
  applyPowerup(item.type, pickedByLeft);
  spawnFloatText(item.x, item.y, def.label, def.kind === 'minion' ? 'buff' : def.kind);
  const owner = pickedByLeft ? 'LEFT' : 'RIGHT';
  updateStatus(owner + ' ' + (source === 'wave' ? 'wave' : 'ball') + ' snagged ' + def.label.toUpperCase() + '.');
  emitParticles(item.x, item.y, def.kind === 'minion' ? 26 : 20, def.color, 320);
  playTone(def.kind === 'minion' ? 1180 : 1040, 0.07, 'triangle', 0.04);
}

function applyPowerup(type, scoredByLeft) {
  const left = world.paddles.left;
  const right = world.paddles.right;
  const beneficiary = scoredByLeft ? left : right;
  const victim = scoredByLeft ? right : left;
  const def = powerupDefs[type] || powerupDefs.grow;

  state.lastPowerType = type;
  state.powerDurationTimer = 0;

  if (type === 'grow') {
    beneficiary.h = Math.min(powerupBalance.effects.growMaxHeight, beneficiary.h + powerupBalance.effects.growHeightBonus);
    if (beneficiary.side === 'left') state.leftBoostTimer = powerupBalance.effects.growDurationSeconds; else state.rightBoostTimer = powerupBalance.effects.growDurationSeconds;
    state.powerDurationTimer = Math.max(state.powerDurationTimer, powerupBalance.effects.growDurationSeconds);
  } else if (type === 'overcharge') {
    refreshPaddleChargeState(beneficiary);
    beneficiary.pulseCharge = getPaddleMaxCharge(beneficiary);
    beneficiary.cooldown = Math.min(beneficiary.cooldown, powerupBalance.effects.overchargeCooldownFloor);
  } else if (type === 'capacitor') {
    beneficiary.overcapTimer = Math.max(beneficiary.overcapTimer || 0, powerupBalance.effects.capacitorDurationSeconds);
    beneficiary.maxCharge = OVERCAP_MAX_CHARGE;
    beneficiary.pulseCharge = Math.min(beneficiary.maxCharge, (beneficiary.pulseCharge || 0) + powerupBalance.effects.capacitorChargeBonus);
    state.powerDurationTimer = Math.max(state.powerDurationTimer, powerupBalance.effects.capacitorDurationSeconds);
  } else if (type === 'rapid') {
    beneficiary.chargeBoostTimer = Math.max(beneficiary.chargeBoostTimer || 0, powerupBalance.effects.rapidDurationSeconds);
    beneficiary.pulseCharge = Math.min(getPaddleMaxCharge(beneficiary), (beneficiary.pulseCharge || 0) + powerupBalance.effects.rapidChargeBonus);
    state.powerDurationTimer = Math.max(state.powerDurationTimer, powerupBalance.effects.rapidDurationSeconds);
  } else if (type === 'multi') {
    if (world.balls.length < powerupBalance.effects.multiMaxBalls) {
      const clone = world.balls[0] || createBall(scoredByLeft ? 1 : -1);
      const extra = createBall(scoredByLeft ? 1 : -1, clone.x, clone.y);
      extra.vx = clone.vx * powerupBalance.effects.multiCloneVxScale;
      extra.vy = clone.vy * powerupBalance.effects.multiCloneVyScale;
      extra.trail = [];
      clampBallSpeed(extra, BALL_SPEED_CAP * powerupBalance.effects.multiCloneCapMultiplier);
      world.balls.push(extra);
    }
  } else if (type === 'pulse') {
    adjustWaveXP(beneficiary, PULSE_POWERUP_XP);
  } else if (type === 'minion') {
    adjustWaveXP(beneficiary, MINION_XP);
  } else if (type === 'shrink') {
    victim.h = Math.max(powerupBalance.effects.shrinkMinHeight, victim.h - powerupBalance.effects.shrinkHeightPenalty);
    if (victim.side === 'left') state.leftBoostTimer = powerupBalance.effects.shrinkDurationSeconds; else state.rightBoostTimer = powerupBalance.effects.shrinkDurationSeconds;
    state.powerDurationTimer = Math.max(state.powerDurationTimer, powerupBalance.effects.shrinkDurationSeconds);
  } else if (type === 'slow') {
    victim.slowTimer = Math.max(victim.slowTimer || 0, powerupBalance.effects.slowDurationSeconds);
    state.powerDurationTimer = Math.max(state.powerDurationTimer, powerupBalance.effects.slowDurationSeconds);
  } else if (type === 'jam') {
    victim.jamTimer = Math.max(victim.jamTimer || 0, powerupBalance.effects.jamDurationSeconds);
    state.powerDurationTimer = Math.max(state.powerDurationTimer, powerupBalance.effects.jamDurationSeconds);
  } else if (type === 'drain') {
    victim.pulseCharge = Math.max(0, (victim.pulseCharge || 0) - powerupBalance.effects.drainChargeLoss);
    adjustWaveXP(victim, -DEBUFF_XP_LOSS);
  }

  syncPaddleLevel(left);
  syncPaddleLevel(right);
  updateUI();
  playTone(900, 0.08, 'triangle', 0.045);
  emitParticles(W / 2, H / 2, def.kind === 'minion' ? 18 : 24, def.color, 330);
}

function handleGoal(leftScored, goalMeta = null) {
        const scorer = leftScored ? world.paddles.left : world.paddles.right;
        const scorerName = leftScored
          ? (ui.leftName ? ui.leftName.textContent : 'LEFT')
          : (ui.rightName ? ui.rightName.textContent : 'RIGHT');
        if (goalMeta) {
          spawnGoalFlash(
            goalMeta.side || (leftScored ? 'right' : 'left'),
            goalMeta.y == null ? H / 2 : goalMeta.y,
            goalMeta.color || getBallRenderColor(goalMeta.ball || {}, themes[state.theme])
          );
        }
        const shouldSpawnReplacementBall = matchFlowBalance.alwaysSpawnReplacementAfterGoal || world.balls.length === 0;
        if (leftScored) {
          state.leftScore += 1;
          state.serveDirection = -1;
        } else {
          state.rightScore += 1;
          state.serveDirection = 1;
        }

        adjustWaveXP(scorer, GOAL_XP);
        emitRuntimeEvent('goal', {
          leftScored,
          leftScore: state.leftScore,
          rightScore: state.rightScore
        });

        if (state.rally > state.bestRally) {
          storeBestRally(state.rally);
        }

        state.rally = 0;
        state.roundSeconds = 0;
        state.nextLongRallySpawnAt = rallyBalance.initialSpawnAtSeconds;

        updateUI();
        updateStatus(shouldSpawnReplacementBall ? scorerName + ' scores. New ball deployed immediately.' : scorerName + ' scores. Existing balls stay live.');
        playTone(leftScored ? 510 : 390, 0.09, 'square', 0.05);
        emitParticles(leftScored ? 110 : W - 110, H / 2, 30, leftScored ? themes[state.theme].paddleLeft : themes[state.theme].paddleRight, 370);
        screenShake = Math.max(screenShake, 10);

        if (state.leftScore >= state.scoreLimit || state.rightScore >= state.scoreLimit) {
          endMatch(state.leftScore > state.rightScore);
          return;
        }

        if (shouldSpawnReplacementBall) {
          spawnServe(state.serveDirection);
        }
      }

function updatePaddle(paddle, upPressed, downPressed, dt) {
        const jamFactor = paddle.jamTimer > 0
          ? paddleControlBalance.jamMoveBase + Math.sin(state.simulationTimeMs * paddleControlBalance.jamMoveOscillationSpeed + (paddle.side === 'left' ? 0 : paddleControlBalance.jamMovePhaseOffset)) * paddleControlBalance.jamMoveOscillationAmplitude
          : 1;
        const slowFactor = paddle.slowTimer > 0 ? paddleControlBalance.slowMoveMultiplier : 1;
        let targetV = 0;
        if (upPressed && !downPressed) targetV = -paddle.speed * jamFactor * slowFactor;
        if (downPressed && !upPressed) targetV = paddle.speed * jamFactor * slowFactor;
        paddle.vy += (targetV - paddle.vy) * Math.min(1, dt * paddleControlBalance.velocitySmoothing);
        paddle.y += paddle.vy * dt;
        paddle.y = Math.max(paddleBalance.boundaryInset, Math.min(H - paddleBalance.boundaryInset - paddle.h, paddle.y));
        paddle.flash = Math.max(0, paddle.flash - dt * 3.6);
        paddle.hitScale += (1 - paddle.hitScale) * Math.min(1, dt * 12);
        paddle.cooldown = Math.max(0, paddle.cooldown - dt);
        paddle.jamTimer = Math.max(0, paddle.jamTimer - dt);
        paddle.slowTimer = Math.max(0, paddle.slowTimer - dt);
        paddle.overcapTimer = Math.max(0, (paddle.overcapTimer || 0) - dt);
        paddle.chargeBoostTimer = Math.max(0, (paddle.chargeBoostTimer || 0) - dt);
        syncPaddleLevel(paddle);
        refreshPaddleChargeState(paddle);
        const chargeRate = (chargeBalance.rechargeBasePerSecond + paddle.pulseLevel * chargeBalance.rechargePerLevelPerSecond) * (paddle.chargeBoostTimer > 0 ? chargeBalance.rapidMultiplier : 1);
        paddle.pulseCharge = clamp((paddle.pulseCharge || 0) + dt * chargeRate, 0, getPaddleMaxCharge(paddle));
        updatePaddleAim(paddle, dt);
      }

function updateAI(paddle, dt, isLeft) {
        const diff = getDifficultyConfig(state.difficulty);
        const balls = world.balls;
        let targetY = H / 2;
        let chosen = null;

        for (const ball of balls) {
          const headingToward = isLeft ? ball.vx < 0 : ball.vx > 0;
          if (!headingToward && chosen) continue;
          if (!chosen || Math.abs(ball.x - paddle.x) < Math.abs(chosen.x - paddle.x)) {
            chosen = ball;
          }
        }
        chosen ||= balls[0];

        if (chosen) {
          const distance = Math.abs(chosen.x - paddle.x);
          const lead = Math.min(aiBalance.targetLeadMax, distance / W);
          targetY = chosen.y + chosen.vy * lead * (aiBalance.targetLeadReactionBase + diff.reaction) + (Math.sin(state.simulationTimeMs * aiBalance.jitterSpeed + paddle.aiJitter) * diff.aiError);
        }

        const center = paddle.y + paddle.h / 2;
        const delta = targetY - center;
        const deadband = aiBalance.deadbandBase + diff.aiError * aiBalance.deadbandErrorScale;
        let up = false;
        let down = false;
        if (delta < -deadband) up = true;
        if (delta > deadband) down = true;

        const originalSpeed = paddle.speed;
        paddle.speed = diff.aiSpeed;
        updatePaddle(paddle, up, down, dt);
        paddle.speed = originalSpeed;

        if (chosen && paddle.cooldown <= 0 && paddle.jamTimer <= aiBalance.fireJamThresholdSeconds && (paddle.pulseCharge || 0) >= MIN_FIRE_CHARGE) {
          const origin = getPulseOrigin(paddle);
          const dx = chosen.x - origin.x;
          const dy = chosen.y - origin.y;
          const dist = Math.hypot(dx, dy) || 1;
          const pulseStats = getPulseStats(paddle);
          const diffAngle = Math.abs(angleDiff(Math.atan2(dy, dx), paddle.aimAngle));
          const headingToward = isLeft ? chosen.vx < 0 : chosen.vx > 0;
          const fireWindow = pulseStats.mode === 'push'
            ? W
            : (headingToward ? pulseStats.range * aiBalance.fireWindowTowardMultiplier : pulseStats.range * aiBalance.fireWindowAwayMultiplier);
          const angleWindow = pulseStats.mode === 'push'
            ? aiBalance.pushAngleWindow
            : pulseStats.cone * (pulseStats.mode === 'solid' ? aiBalance.solidAngleWindowMultiplier : aiBalance.waveAngleWindowMultiplier);
          if (dist < fireWindow && diffAngle < angleWindow) {
            const chance = pulseStats.mode === 'push'
              ? (aiBalance.pushFireChanceBase + diff.reaction * aiBalance.pushFireChanceReactionScale)
              : (headingToward ? (aiBalance.towardFireChanceBase + diff.reaction * aiBalance.towardFireChanceReactionScale) : aiBalance.awayFireChance);
            if (rng.next() < chance * dt * aiBalance.fireCheckRate) {
              firePulse(paddle);
            }
          }
        }
      }

      function normalizeAction(action) {
        const moveAxis = action && Number.isFinite(action.moveAxis)
          ? Math.max(-1, Math.min(1, Math.round(action.moveAxis)))
          : 0;
        return {
          moveAxis,
          fire: !!(action && action.fire)
        };
      }

      function queueInput(side, tick, action) {
        const normalized = normalizeAction(action);
        const targetTick = Math.max(state.tick, Math.floor(Number.isFinite(tick) ? tick : state.tick));
        inputQueue[side].set(targetTick, normalized);
        replay.actions.push({ tick: targetTick, side, action: normalized });
      }

      function getQueuedAction(side) {
        const queued = inputQueue[side].get(state.tick);
        if (queued) {
          inputQueue[side].delete(state.tick);
          controllerActionState[side].moveAxis = queued.moveAxis;
          controllerActionState[side].fire = queued.fire;
          controllerActionState[side].lastTick = state.tick;
        } else {
          controllerActionState[side].fire = false;
        }
        return controllerActionState[side];
      }

      function getPaddleBySide(side) {
        return side === 'left' ? world.paddles.left : world.paddles.right;
      }

      function getObservation(side) {
        const self = getPaddleBySide(side);
        const opponent = getPaddleBySide(side === 'left' ? 'right' : 'left');
        const direction = side === 'left' ? 1 : -1;
        const balls = world.balls
          .slice()
          .sort((a, b) => Math.abs(a.x - self.x) - Math.abs(b.x - self.x))
          .slice(0, 4)
          .map((ball) => ({
            x: ((ball.x / W) * 2 - 1) * direction,
            y: (ball.y / H) * 2 - 1,
            vx: ball.vx / BALL_SPEED_CAP,
            vy: ball.vy / BALL_SPEED_CAP,
            towardSelf: side === 'left' ? ball.vx < 0 : ball.vx > 0,
            radius: ball.r / 24
          }));
        const powerups = world.powerups
          .slice()
          .sort((a, b) => Math.abs(a.x - self.x) - Math.abs(b.x - self.x))
          .slice(0, 4)
          .map((item) => ({
            x: ((item.x / W) * 2 - 1) * direction,
            y: (item.y / H) * 2 - 1,
            type: item.type,
            radius: item.r / 48,
            life: item.life / Math.max(powerupBalance.spawn.standardLifeSeconds, powerupBalance.spawn.minionLifeSeconds)
          }));
        return {
          schemaVersion: 1,
          tick: state.tick,
          side,
          self: {
            y: (self.y / H) * 2 - 1,
            vy: self.vy / paddleBalance.speed,
            h: self.h / paddleBalance.height,
            aimAngle: self.aimAngle / Math.PI,
            charge: self.pulseCharge / Math.max(1, getPaddleMaxCharge(self)),
            level: self.pulseLevel / MAX_WAVE_LEVEL,
            cooldown: self.cooldown / Math.max(waveBalance.blue.cooldown, waveBalance.pink.cooldown, waveBalance.gold.cooldown),
            jam: self.jamTimer,
            slow: self.slowTimer
          },
          opponent: {
            y: (opponent.y / H) * 2 - 1,
            vy: opponent.vy / paddleBalance.speed,
            h: opponent.h / paddleBalance.height,
            aimAngle: opponent.aimAngle / Math.PI,
            charge: opponent.pulseCharge / Math.max(1, getPaddleMaxCharge(opponent)),
            level: opponent.pulseLevel / MAX_WAVE_LEVEL,
            jam: opponent.jamTimer,
            slow: opponent.slowTimer
          },
          score: {
            self: side === 'left' ? state.leftScore : state.rightScore,
            opponent: side === 'left' ? state.rightScore : state.leftScore,
            limit: state.scoreLimit
          },
          meta: {
            rally: state.rally,
            ballsInPlay: world.balls.length,
            powerupsInPlay: world.powerups.length,
            countdownActive: state.countdownActive,
            simulationTimeMs: state.simulationTimeMs
          },
          balls,
          powerups
        };
      }

      function maybeRunController(side) {
        const controller = controllerSlots[side];
        if (!controller || state.tick % decisionIntervalTicks !== 0) return;
        const observation = getObservation(side);
        const action = controller.decide
          ? controller.decide(observation, {
              tick: state.tick,
              side,
              config,
              random() {
                return rng.next();
              },
              queueInput(nextTick, nextAction) {
                queueInput(side, nextTick, nextAction);
              }
            })
          : null;
        const params = (controller && controller.controllerParams) || {};
        const delay = Math.max(0, Number(params.reactionDelayTicks) || 0);
        queueInput(side, state.tick + delay, action || { moveAxis: 0, fire: false });
      }

      function hashSimulationState() {
        return hashString(stableSerialize({
          tick: state.tick,
          rng: rng.getState(),
          state,
          world,
          matchStats
        }));
      }

      function cloneSimulation() {
        return deepClone({
          nextBallId,
          rngState: rng.getState(),
          state,
          world,
          matchStats,
          history,
          replay,
          controllerActionState: deepClone(controllerActionState)
        });
      }

      function restoreSimulation(snapshot) {
        nextBallId = snapshot.nextBallId;
        rng.setState(snapshot.rngState);
        history = deepClone(snapshot.history);
        matchStats = deepClone(snapshot.matchStats);
        Object.assign(state, deepClone(snapshot.state));
        Object.assign(world, deepClone(snapshot.world));
        controllerActionState.left = deepClone(snapshot.controllerActionState.left);
        controllerActionState.right = deepClone(snapshot.controllerActionState.right);
        replay.actions = deepClone(snapshot.replay.actions);
        replay.events = deepClone(snapshot.replay.events);
        replay.stateHashes = deepClone(snapshot.replay.stateHashes);
      }

      function serializeReplay() {
        return deepClone({
          version: replay.version,
          seed: replay.seed,
          configHash: replay.configHash,
          actions: replay.actions,
          events: replay.events,
          stateHashes: replay.stateHashes
        });
      }

      function loadReplay(serialized) {
        replay.version = serialized.version || 1;
        replay.seed = normalizeSeed(serialized.seed);
        replay.configHash = serialized.configHash || replay.configHash;
        replay.actions = deepClone(serialized.actions || []);
        replay.events = deepClone(serialized.events || []);
        replay.stateHashes = deepClone(serialized.stateHashes || []);
      }

      function collideBallWithPaddle(ball, paddle) {

        if (
          ball.x + ball.r >= paddle.x &&
          ball.x - ball.r <= paddle.x + paddle.w &&
          ball.y + ball.r >= paddle.y &&
          ball.y - ball.r <= paddle.y + paddle.h
        ) {
          const offset = ((ball.y - (paddle.y + paddle.h / 2)) / (paddle.h / 2));
          const direction = paddle.side === 'left' ? 1 : -1;
          let speed = Math.min(BALL_SPEED_CAP, Math.hypot(ball.vx, ball.vy) * paddleHitBalance.speedScale + paddleHitBalance.speedBonus);
          const angle = offset * paddleHitBalance.angleScale;
          ball.vx = Math.cos(angle) * speed * direction;
          ball.vy = Math.sin(angle) * speed + paddle.vy * paddleHitBalance.carryVyScale;
          ball.x = paddle.side === 'left' ? paddle.x + paddle.w + ball.r : paddle.x - ball.r;

          if ((paddle.pulseCharge || 0) >= SOLID_CHARGE_THRESHOLD) {
            const fullChargeHit = (paddle.pulseCharge || 0) >= FULL_CHARGE_THRESHOLD;
            const forceColor = fullChargeHit ? '#ffd34d' : '#ff7cd7';
            if (fullChargeHit) {
              const forceSpeed = Math.min(BALL_SPEED_CAP * paddleHitBalance.fullChargeCapMultiplier, Math.max(speed * paddleHitBalance.fullChargeSpeedScale, paddleHitBalance.fullChargeBaseSpeed + paddle.pulseLevel * paddleHitBalance.fullChargeSpeedPerLevel));
              const forceAngle = clamp(offset * paddleHitBalance.fullChargeOffsetScale + Math.sin(paddle.aimAngle) * paddleHitBalance.fullChargeAimInfluence, -paddleHitBalance.fullChargeClamp, paddleHitBalance.fullChargeClamp);
              ball.vx = Math.cos(forceAngle) * forceSpeed * direction;
              ball.vy = Math.sin(forceAngle) * forceSpeed + paddle.vy * paddleHitBalance.fullChargeCarryVyScale + Math.sin(paddle.aimAngle) * paddleHitBalance.fullChargeAimKick;
            } else {
              const defensiveSpeed = Math.min(BALL_SPEED_CAP * paddleHitBalance.defensiveCapMultiplier, Math.max(paddleHitBalance.defensiveBaseSpeed + paddle.pulseLevel * paddleHitBalance.defensiveSpeedPerLevel, speed * paddleHitBalance.defensiveSpeedScale));
              const defensiveAngle = clamp(offset * paddleHitBalance.defensiveOffsetScale + Math.sin(paddle.aimAngle) * paddleHitBalance.defensiveAimInfluence, -paddleHitBalance.defensiveClamp, paddleHitBalance.defensiveClamp);
              ball.vx = Math.cos(defensiveAngle) * defensiveSpeed * direction;
              ball.vy = Math.sin(defensiveAngle) * defensiveSpeed + paddle.vy * paddleHitBalance.defensiveCarryVyScale;
            }
            emitParticles(ball.x, ball.y, 20 + paddle.pulseLevel * 2, forceColor, 340);
            playTone(340 + paddle.pulseLevel * 38, 0.06, 'triangle', 0.05);
            screenShake = Math.max(screenShake, fullChargeHit ? 6 : 4);
          }

          ball.lastHitSide = paddle.side;
          state.rally += 1;
          state.impacts += 1;
          if (paddle.side === 'left') matchStats.leftBallHits += 1;
          else matchStats.rightBallHits += 1;
          paddle.flash = 1;
          paddle.hitScale = 1.16;
          state.comboFlash = 0.22;
          matchStats.longestRally = Math.max(matchStats.longestRally, state.rally);
          if (state.rally > state.bestRally) {
            storeBestRally(state.rally);
          }
          updateUI();
          playTone(180 + Math.min(700, state.rally * 14), 0.045, 'square', 0.04);
          emitParticles(ball.x, ball.y, 14, paddle.side === 'left' ? themes[state.theme].paddleLeft : themes[state.theme].paddleRight, 300);
          screenShake = Math.max(screenShake, 4);
        }
      }

function updateBalls(dt) {
  const slowFactor = state.slowmoTimer > 0 ? 0.7 : 1;
  for (let i = world.balls.length - 1; i >= 0; i--) {
    const ball = world.balls[i];
    ball.flash = Math.max(0, ball.flash - dt * 2.5);
    ball.hueShift += dt * 4;
    ball.boostTimer = Math.max(0, (ball.boostTimer || 0) - dt);
    ball.boostIntensity = Math.max(0, (ball.boostIntensity || 0) - dt * 1.8);
    if (ball.boostTimer <= 0) {
      ball.boostAcceleration = 0;
      ball.boostMaxSpeed = BALL_SPEED_CAP;
    }
    ball.blueResistTimer = Math.max(0, (ball.blueResistTimer || 0) - dt);
    if (ball.blueResistTimer <= 0) ball.blueResistStrength = 0;

    const hadStun = (ball.stunTimer || 0) > 0;
    if (hadStun) {
      ball.stunTimer = Math.max(0, ball.stunTimer - dt);
      if (ball.stunTimer <= 0) {
        ball.vx = ball.storedVx || ball.vx;
        ball.vy = ball.storedVy || ball.vy;
        ball.storedVx = 0;
        ball.storedVy = 0;
      }
    }

    if (!hadStun || ball.stunTimer <= 0) {
      const speed = Math.hypot(ball.vx, ball.vy);
      if ((ball.boostTimer || 0) > 0 && (ball.boostAcceleration || 0) > 0 && speed > 0) {
        const boostedSpeed = Math.min(ball.boostMaxSpeed || BALL_SPEED_CAP, speed + ball.boostAcceleration * dt);
        if (boostedSpeed > speed) {
          const boostScale = boostedSpeed / speed;
          ball.vx *= boostScale;
          ball.vy *= boostScale;
        }
      } else if (speed > BALL_SPEED_CAP && ballBoostBalance.overCapDecayPerSecond > 0) {
        const settledSpeed = Math.max(BALL_SPEED_CAP, speed - ballBoostBalance.overCapDecayPerSecond * dt);
        if (settledSpeed < speed) {
          const settleScale = settledSpeed / speed;
          ball.vx *= settleScale;
          ball.vy *= settleScale;
        }
      }

      ball.x += ball.vx * dt * slowFactor;
      ball.y += ball.vy * dt * slowFactor;
    } else {
      ball.flash = Math.max(ball.flash, 0.82);
      ball.hueShift += dt * 8;
    }

    if ((ball.serveHoldTimer || 0) > 0) {
      ball.x = W / 2;
      ball.y = H / 2;
      ball.vx = 0;
      ball.vy = 0;
      ball.flash = Math.max(ball.flash, 0.9);
      ball.trail.length = 0;
      continue;
    }

    if (state.trailsEnabled) {
      ball.trail.push({
        x: ball.x,
        y: ball.y,
        life: 0.35,
        boost: ball.boostTimer > 0 ? ball.boostColor : null,
        boostIntensity: ball.boostTimer > 0 ? (ball.boostIntensity || 0) : 0
      });
      if (ball.trail.length > 16) ball.trail.shift();
      for (let t = ball.trail.length - 1; t >= 0; t--) {
        ball.trail[t].life -= dt;
        if (ball.trail[t].life <= 0) ball.trail.splice(t, 1);
      }
    } else {
      ball.trail.length = 0;
    }

    if (ball.stunTimer > 0) {
      continue;
    }

    if (ball.y - ball.r <= 12) {
      ball.y = 12 + ball.r;
      ball.vy = Math.abs(ball.vy);
      clampBallSpeed(ball);
      playTone(270, 0.04, 'sine', 0.02);
      emitParticles(ball.x, ball.y, 10, themes[state.theme].ball, 200);
    }
    if (ball.y + ball.r >= H - 12) {
      ball.y = H - 12 - ball.r;
      ball.vy = -Math.abs(ball.vy);
      clampBallSpeed(ball);
      playTone(270, 0.04, 'sine', 0.02);
      emitParticles(ball.x, ball.y, 10, themes[state.theme].ball, 200);
    }

    collideBallWithPaddle(ball, world.paddles.left);
    collideBallWithPaddle(ball, world.paddles.right);

    for (let p = world.powerups.length - 1; p >= 0; p--) {
      const item = world.powerups[p];
      const dx = ball.x - item.x;
      const dy = ball.y - item.y;
      if (dx * dx + dy * dy <= (ball.r + item.r) * (ball.r + item.r)) {
        const pickedByLeft = ball.vx > 0;
        world.powerups.splice(p, 1);
        collectPowerup(item, pickedByLeft, 'ball');
      }
    }

    clampBallSpeed(ball);

    if (ball.x + ball.r < 0) {
      const goalMeta = {
        side: 'left',
        y: ball.y,
        color: getBallRenderColor(ball, themes[state.theme]),
        ball
      };
      world.balls.splice(i, 1);
      handleGoal(false, goalMeta);
      if (state.gameOver) return;
      continue;
    }
    if (ball.x - ball.r > W) {
      const goalMeta = {
        side: 'right',
        y: ball.y,
        color: getBallRenderColor(ball, themes[state.theme]),
        ball
      };
      world.balls.splice(i, 1);
      handleGoal(true, goalMeta);
      if (state.gameOver) return;
      continue;
    }
  }
}

function updatePulses(dt) {
        for (let i = world.pulses.length - 1; i >= 0; i--) {
          const pulse = world.pulses[i];

          if (pulse.mode === 'push') {
            pulse.life -= dt;
            pulse.prevX = pulse.x;
            pulse.prevY = pulse.y;
            pulse.x += pulse.vx * dt;
            pulse.y += pulse.vy * dt;
            pulse.trailSpawnTimer = (pulse.trailSpawnTimer || 0) - dt;
            const trailInterval = state.lowPerfEffects ? 0.055 : 0.02;
            if (pulse.trailSpawnTimer <= 0) {
              pulse.trailSpawnTimer = trailInterval;
              pulse.trail.push({ x: pulse.x, y: pulse.y, angle: pulse.angle, life: state.lowPerfEffects ? 0.16 : 0.24 });
            }
            const maxTrail = state.lowPerfEffects ? 4 : 10;
            if (pulse.trail.length > maxTrail) pulse.trail.splice(0, pulse.trail.length - maxTrail);
            for (let t = pulse.trail.length - 1; t >= 0; t--) {
              pulse.trail[t].life -= dt;
              if (pulse.trail[t].life <= 0) pulse.trail.splice(t, 1);
            }
            for (let d = pulse.diffraction.length - 1; d >= 0; d--) {
              pulse.diffraction[d].life -= dt;
              pulse.diffraction[d].phase += dt * (state.lowPerfEffects ? 5.2 : 7.5);
              if (pulse.diffraction[d].life <= 0) pulse.diffraction.splice(d, 1);
            }

            const extents = getPulseArcVerticalExtents(pulse);
            const clipAllowance = Math.min(54, 12 + getPulseHalfThickness(pulse) * 0.56);
            const topContact = extents.top <= 24 - clipAllowance;
            const bottomContact = extents.bottom >= H - 24 + clipAllowance;
            if (topContact || bottomContact) {
              if (topContact) pulse.y += (24 - clipAllowance) - extents.top;
              if (bottomContact) pulse.y += (H - 24 + clipAllowance) - extents.bottom;
              const normal = topContact ? 1 : -1;
              pulse.vy *= -1;
              pulse.angle = Math.atan2(pulse.vy, pulse.vx);
              pulse.diffraction.push({ x: pulse.x, y: clamp(pulse.y + normal * pulse.arcRadius, 24, H - 24), normal, life: state.lowPerfEffects ? 0.34 : 0.64, phase: 0 });
              const maxDiffraction = state.lowPerfEffects ? 1 : 4;
              if (pulse.diffraction.length > maxDiffraction) pulse.diffraction.splice(0, pulse.diffraction.length - maxDiffraction);
              emitParticles(pulse.x, pulse.y, state.lowPerfEffects ? 4 : 8, pulse.color, 180);
            }

            const goalMargin = (pulse.arcRadius || 0) + getPulseHalfThickness(pulse) + 24;
            if (pulse.x < -goalMargin || pulse.x > W + goalMargin) {
              world.pulses.splice(i, 1);
              continue;
            }

            const owner = pulse.side === 'left' ? world.paddles.left : world.paddles.right;
            const opponent = pulse.side === 'left' ? world.paddles.right : world.paddles.left;
            if (!pulse.hitPaddleIds.has(opponent.side) && pulseArcHitsPaddle(pulse, opponent)) {
              pulse.hitPaddleIds.add(opponent.side);
              const cx = opponent.x + opponent.w / 2;
              const cy = opponent.y + opponent.h / 2;
              const nudge = clamp(
                Math.sin(pulse.angle) * goldWaveInteractionBalance.paddleHit.nudgeMax,
                -goldWaveInteractionBalance.paddleHit.nudgeMax,
                goldWaveInteractionBalance.paddleHit.nudgeMax
              );
              opponent.y = clamp(opponent.y + nudge, paddleBalance.boundaryInset, H - paddleBalance.boundaryInset - opponent.h);
              opponent.vy += nudge * goldWaveInteractionBalance.paddleHit.velocityScale;
              opponent.flash = 1;
              opponent.hitScale = goldWaveInteractionBalance.paddleHit.hitScale;
              opponent.slowTimer = Math.max(opponent.slowTimer || 0, goldWaveInteractionBalance.paddleHit.slowDurationSeconds);
              opponent.pulseCharge = Math.min(opponent.pulseCharge || 0, SOLID_CHARGE_THRESHOLD - goldWaveInteractionBalance.paddleHit.chargeCeilingOffset);
              adjustWaveXP(owner, OPPONENT_HIT_XP);
              adjustWaveXP(opponent, -YELLOW_HIT_XP_LOSS);
              getRoleMetricsForSide(pulse.side).goldPaddleHits += 1;
              emitParticles(cx, cy, 30, pulse.color, 340);
              playTone(520, 0.05, 'triangle', 0.04);
            }

            for (let j = world.pulses.length - 1; j >= 0; j--) {
              const otherPulse = world.pulses[j];
              if (otherPulse === pulse || otherPulse.side === pulse.side || otherPulse.mode !== 'solid') continue;
              if (!pulseArcIntersectsPulse(pulse, otherPulse)) continue;
              const burstRadius = getPulseRenderRadius(otherPulse);
              emitParticles(otherPulse.x + Math.cos(otherPulse.angle) * burstRadius, otherPulse.y + Math.sin(otherPulse.angle) * burstRadius, 18, pulse.color, 260);
              world.pulses.splice(j, 1);
              if (j < i) i -= 1;
            }

            for (let p = world.powerups.length - 1; p >= 0; p--) {
              const item = world.powerups[p];
              if (!pulseArcHitsPoint(item.x, item.y, pulse)) continue;
              world.powerups.splice(p, 1);
              collectPowerup(item, pulse.side === 'left', 'wave', pulse.waveType || null);
            }

            for (const ball of world.balls) {
              if (pulse.hitBallIds.has(ball.id)) continue;
              if (!pushPulseHitsBall(pulse, ball)) continue;
              pulse.hitBallIds.add(ball.id);

              const incomingSpeed = Math.hypot(ball.vx, ball.vy);
              const offset = clamp((ball.y - pulse.y) / Math.max(44, pulse.arcRadius * 0.72), -1, 1);
              const impactAngle = Math.atan2(ball.y - pulse.y, ball.x - pulse.x);
              const angularFactor = clamp(1 - Math.abs(angleDiff(impactAngle, pulse.angle)) / Math.max(0.001, pulse.cone), 0, 1);
              const sweetFactor = Math.pow(angularFactor, goldWaveInteractionBalance.ballHit.sweetSpotExponent);
              const yellowInfluence = ball.blueResistTimer > 0
                ? clamp(
                  blueWaveInteractionBalance.resistVsGold.influenceBase + (1 - (ball.blueResistStrength || blueWaveInteractionBalance.resistVsGold.defaultStrength)) * blueWaveInteractionBalance.resistVsGold.missingStrengthScale,
                  blueWaveInteractionBalance.resistVsGold.minInfluence,
                  blueWaveInteractionBalance.resistVsGold.maxInfluence
                )
                : 1;

              if (sweetFactor > goldWaveInteractionBalance.ballHit.centerSweetThreshold) {
                const targetSpeed = Math.min(
                  BALL_SPEED_CAP * goldWaveInteractionBalance.ballHit.center.speedCapMultiplier,
                  Math.max(
                    incomingSpeed * goldWaveInteractionBalance.ballHit.center.incomingSpeedScale,
                    goldWaveInteractionBalance.ballHit.center.baseSpeed + pulse.level * goldWaveInteractionBalance.ballHit.center.speedPerLevel + sweetFactor * goldWaveInteractionBalance.ballHit.center.speedSweetScale
                  )
                );
                const targetAngle = pulse.angle + offset * goldWaveInteractionBalance.ballHit.center.angleOffsetScale;
                const targetVx = Math.cos(targetAngle) * targetSpeed;
                const targetVy = Math.sin(targetAngle) * targetSpeed;
                const boostIntensity = goldWaveInteractionBalance.ballHit.center.boostIntensity;
                ball.vx += (targetVx - ball.vx) * yellowInfluence;
                ball.vy += (targetVy - ball.vy) * yellowInfluence;
                setBallBoost(
                  ball,
                  goldWaveInteractionBalance.ballHit.center.boostDurationBase + yellowInfluence * goldWaveInteractionBalance.ballHit.center.boostDurationInfluenceScale,
                  boostIntensity,
                  waveBalance.gold.color,
                  Math.log2(1 + Math.max(0, boostIntensity)) * ballBoostBalance.accelerationPerLog2Unit,
                  BALL_SPEED_CAP * goldWaveInteractionBalance.ballHit.center.boostMaxSpeedCapMultiplier
                );
              } else if (incomingSpeed <= BALL_SPEED_CAP * goldWaveInteractionBalance.ballHit.glancing.speedGateCapMultiplier) {
                const direction = pulse.side === 'left' ? 1 : -1;
                const targetSpeed = Math.min(
                  BALL_SPEED_CAP * goldWaveInteractionBalance.ballHit.glancing.speedCapMultiplier,
                  Math.max(
                    goldWaveInteractionBalance.ballHit.glancing.baseSpeed + pulse.level * goldWaveInteractionBalance.ballHit.glancing.speedPerLevel,
                    incomingSpeed * goldWaveInteractionBalance.ballHit.glancing.incomingSpeedScale + goldWaveInteractionBalance.ballHit.glancing.incomingSpeedFlatBonus + sweetFactor * goldWaveInteractionBalance.ballHit.glancing.speedSweetScale
                  )
                );
                const angle = clamp(
                  offset * (goldWaveInteractionBalance.ballHit.glancing.angleOffsetBase - sweetFactor * goldWaveInteractionBalance.ballHit.glancing.angleOffsetSweetReduction) + Math.sin(pulse.angle) * (goldWaveInteractionBalance.ballHit.glancing.aimInfluenceBase + sweetFactor * goldWaveInteractionBalance.ballHit.glancing.aimInfluenceSweetScale),
                  -goldWaveInteractionBalance.ballHit.glancing.angleClamp,
                  goldWaveInteractionBalance.ballHit.glancing.angleClamp
                );
                const targetVx = Math.cos(angle) * targetSpeed * direction;
                const targetVy = Math.sin(angle) * targetSpeed + Math.sin(pulse.angle) * (goldWaveInteractionBalance.ballHit.glancing.vyAimBase + sweetFactor * goldWaveInteractionBalance.ballHit.glancing.vyAimSweetScale) + offset * (goldWaveInteractionBalance.ballHit.glancing.vyOffsetBase - sweetFactor * goldWaveInteractionBalance.ballHit.glancing.vyOffsetSweetReduction);
                ball.vx += (targetVx - ball.vx) * yellowInfluence;
                ball.vy += (targetVy - ball.vy) * yellowInfluence;
              } else {
                const nudge = (
                  goldWaveInteractionBalance.ballHit.nudge.base +
                  pulse.level * goldWaveInteractionBalance.ballHit.nudge.perLevel +
                  sweetFactor * goldWaveInteractionBalance.ballHit.nudge.sweetScale
                ) * yellowInfluence;
                ball.vx += Math.cos(pulse.angle) * nudge;
                ball.vy += Math.sin(pulse.angle) * (nudge * goldWaveInteractionBalance.ballHit.nudge.yScale) + offset * goldWaveInteractionBalance.ballHit.nudge.offsetScale * yellowInfluence;
                clampBallSpeed(ball, BALL_SPEED_CAP);
              }

              pulse.arcRadius += goldWaveInteractionBalance.ballHit.growth.arcRadiusPerHit;
              pulse.renderThickness = Math.min(goldWaveInteractionBalance.ballHit.growth.maxThickness, getPulseThickness(pulse) + goldWaveInteractionBalance.ballHit.growth.thicknessPerHit);
              pulse.waveThickness = pulse.renderThickness;
              const goldRoleMetrics = getRoleMetricsForSide(pulse.side);
              goldRoleMetrics.goldBallHits += 1;
              if (sweetFactor > goldWaveInteractionBalance.ballHit.centerSweetThreshold) {
                goldRoleMetrics.goldCenterHits += 1;
              }

              if (pulse.side === 'left') matchStats.leftWaveHits += 1;
              else matchStats.rightWaveHits += 1;

              clampBallSpeed(ball, BALL_SPEED_CAP);
              ball.lastHitSide = pulse.side;
              ball.flash = 1;
              screenShake = Math.max(screenShake, 6 + pulse.level);
              emitParticles(ball.x, ball.y, 18 + pulse.level * 2, pulse.color, 280 + pulse.level * 20);
              playTone(680 + pulse.level * 18, 0.045, 'triangle', 0.03);
            }
          } else {
            const prevRadius = pulse.radius || 0;
            if (pulse.life > 0) {
              const lifeBeforeUpdate = pulse.life;
              pulse.life = Math.max(0, pulse.life - dt);
              pulse.radius = pulse.life > 0 ? getPulseRenderRadius(pulse) : pulse.range;
              if (pulse.life <= 0 && pulse.mode === 'solid' && (pulse.endLingerTimer || 0) > 0) {
                pulse.endLingerTimer = Math.max(0, pulse.endLingerTimer - Math.max(0, dt - lifeBeforeUpdate));
              }
            } else if (pulse.mode === 'solid' && (pulse.endLingerTimer || 0) > 0) {
              pulse.endLingerTimer = Math.max(0, pulse.endLingerTimer - dt);
              pulse.radius = pulse.range;
            } else {
              pulse.radius = pulse.range;
            }
            const radius = pulse.radius;

            for (const ball of world.balls) {
              if (pulse.hitBallIds.has(ball.id)) continue;
              if (!pulseArcSweepHitsBall(pulse, ball, prevRadius, radius)) continue;
              pulse.hitBallIds.add(ball.id);

              if (pulse.mode === 'solid') {
                const movingToward = isBallMovingTowardPaddle(ball, pulse.side);
                const ownerPaddle = pulse.side === 'left' ? world.paddles.left : world.paddles.right;
                const emergencyDistance = Math.abs(ball.x - (ownerPaddle.x + ownerPaddle.w / 2));
                const direction = pulse.side === 'left' ? 1 : -1;
                const offset = clamp((ball.y - pulse.y) / Math.max(pinkWaveInteractionBalance.ballHit.offsetRangeMin, radius * pinkWaveInteractionBalance.ballHit.offsetRangeRadiusScale), -1, 1);
                const speed = Math.min(
                  BALL_SPEED_CAP * pinkWaveInteractionBalance.ballHit.speedCapMultiplier,
                  Math.max(
                    pinkWaveInteractionBalance.ballHit.baseSpeed + pulse.level * pinkWaveInteractionBalance.ballHit.speedPerLevel,
                    Math.hypot(ball.vx, ball.vy) * pinkWaveInteractionBalance.ballHit.incomingSpeedScale + pinkWaveInteractionBalance.ballHit.incomingSpeedFlatBonus
                  )
                );
                const angle = clamp(
                  offset * pinkWaveInteractionBalance.ballHit.angleOffsetScale + Math.sin(pulse.angle) * pinkWaveInteractionBalance.ballHit.aimInfluence,
                  -pinkWaveInteractionBalance.ballHit.angleClamp,
                  pinkWaveInteractionBalance.ballHit.angleClamp
                );
                ball.vx = Math.cos(angle) * speed * direction;
                ball.vy = Math.sin(angle) * speed + Math.sin(pulse.angle) * pinkWaveInteractionBalance.ballHit.aimVerticalKick;
                const pinkRoleMetrics = getRoleMetricsForSide(pulse.side);
                pinkRoleMetrics.pinkBallHits += 1;
                if (movingToward) pinkRoleMetrics.pinkThreatHits += 1;
                if (movingToward && emergencyDistance <= W * 0.18) pinkRoleMetrics.pinkEmergencyHits += 1;
              } else {
                const dx = ball.x - pulse.x;
                const dy = ball.y - pulse.y;
                const dist = Math.hypot(dx, dy) || 1;
                const awayX = dx / dist;
                const awayY = dy / dist;
                const impactAngle = Math.atan2(dy, dx);
                const sweetFactor = Math.pow(
                  clamp(1 - Math.abs(angleDiff(impactAngle, pulse.angle)) / Math.max(0.001, pulse.cone), 0, 1),
                  blueWaveInteractionBalance.sweetSpotExponent
                );
                const movingToward = isBallMovingTowardPaddle(ball, pulse.side);
                const movingAway = isBallMovingAwayFromPaddle(ball, pulse.side);
                const aimBlend = blueWaveInteractionBalance.aimBlendBase + sweetFactor * blueWaveInteractionBalance.aimBlendSweetScale;
                const force = pulse.strength * (blueWaveInteractionBalance.forceMultiplierBase + sweetFactor * blueWaveInteractionBalance.forceMultiplierSweetScale);
                let outVx = ball.vx + (awayX * (1 - aimBlend) + Math.cos(pulse.angle) * aimBlend) * force;
                let outVy = ball.vy + (awayY * (1 - aimBlend) + Math.sin(pulse.angle) * aimBlend) * force;
                const blueRoleMetrics = getRoleMetricsForSide(pulse.side);
                blueRoleMetrics.blueBallHits += 1;

                if (movingAway) {
                  blueRoleMetrics.blueAwayHits += 1;
                  const speed = Math.hypot(outVx, outVy) || 1;
                  const targetSpeed = Math.min(
                    BALL_SPEED_CAP * blueWaveInteractionBalance.away.speedCapMultiplier,
                    Math.max(
                      speed * (blueWaveInteractionBalance.away.speedScaleBase + sweetFactor * blueWaveInteractionBalance.away.speedScaleSweetScale),
                      blueWaveInteractionBalance.away.baseSpeed + pulse.level * blueWaveInteractionBalance.away.speedPerLevel + sweetFactor * blueWaveInteractionBalance.away.speedSweetScale
                    )
                  );
                  const dirX = (outVx / speed) * (blueWaveInteractionBalance.away.directionCarryBase - sweetFactor * blueWaveInteractionBalance.away.directionCarrySweetScale) + Math.cos(pulse.angle) * (blueWaveInteractionBalance.away.aimInfluenceBase + sweetFactor * blueWaveInteractionBalance.away.aimInfluenceSweetScale);
                  const dirY = (outVy / speed) * (blueWaveInteractionBalance.away.directionCarryBase - sweetFactor * blueWaveInteractionBalance.away.directionCarrySweetScale) + Math.sin(pulse.angle) * (blueWaveInteractionBalance.away.aimInfluenceBase + sweetFactor * blueWaveInteractionBalance.away.aimInfluenceSweetScale);
                  const dirLen = Math.hypot(dirX, dirY) || 1;
                  const boostIntensity = blueWaveInteractionBalance.away.boostIntensityBase + sweetFactor * blueWaveInteractionBalance.away.boostIntensitySweetScale;
                  outVx = dirX / dirLen * targetSpeed;
                  outVy = dirY / dirLen * targetSpeed;
                  setBallBoost(
                    ball,
                    blueWaveInteractionBalance.away.boostDurationBase + sweetFactor * blueWaveInteractionBalance.away.boostDurationSweetScale,
                    boostIntensity,
                    waveBalance.blue.color,
                    Math.log2(1 + Math.max(0, boostIntensity)) * ballBoostBalance.accelerationPerLog2Unit,
                    BALL_SPEED_CAP * blueWaveInteractionBalance.away.boostMaxSpeedCapMultiplier
                  );
                  if (sweetFactor > blueWaveInteractionBalance.away.resistSweetThreshold) {
                    ball.blueResistTimer = Math.max(ball.blueResistTimer || 0, blueWaveInteractionBalance.away.resistDurationBase + sweetFactor * blueWaveInteractionBalance.away.resistDurationSweetScale);
                    ball.blueResistStrength = Math.max(ball.blueResistStrength || 0, blueWaveInteractionBalance.away.resistStrengthBase + sweetFactor * blueWaveInteractionBalance.away.resistStrengthSweetScale);
                    blueRoleMetrics.blueResistGrants += 1;
                  }
                }

                if (movingToward) {
                  blueRoleMetrics.blueTowardHits += 1;
                  const stunDuration = blueWaveInteractionBalance.toward.stunDurationBase + sweetFactor * blueWaveInteractionBalance.toward.stunDurationSweetScale;
                  applyBallStun(ball, stunDuration, outVx, outVy, waveBalance.blue.color);
                } else {
                  ball.vx = outVx;
                  ball.vy = outVy;
                }
              }

              if (pulse.side === 'left') matchStats.leftWaveHits += 1;
              else matchStats.rightWaveHits += 1;

              clampBallSpeed(ball, BALL_SPEED_CAP);
              ball.lastHitSide = pulse.side;
              ball.flash = 1;
              screenShake = Math.max(screenShake, 5 + pulse.level * 0.7);
              emitParticles(ball.x, ball.y, 12 + pulse.level * 2, pulse.color, 280 + pulse.level * 20);
              playTone(620 + pulse.level * 28, 0.04, 'triangle', 0.03);
            }
          }

          if (pulse.life <= 0 && (pulse.endLingerTimer || 0) <= 0) world.pulses.splice(i, 1);
        }
      }

function updateParticles(dt) {

        for (let i = world.particles.length - 1; i >= 0; i--) {
          const p = world.particles[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.98;
          p.vy *= 0.98;
          p.life -= dt;
          if (p.life <= 0) world.particles.splice(i, 1);
        }
      }

      function updateGoalFlashes(dt) {
        for (let i = world.goalFlashes.length - 1; i >= 0; i--) {
          const flash = world.goalFlashes[i];
          flash.life -= dt;
          if (flash.life <= 0) world.goalFlashes.splice(i, 1);
        }
      }

      function updateServeHolds(dt) {
        for (const ball of world.balls) {
          if ((ball.serveHoldTimer || 0) <= 0) continue;
          ball.serveHoldTimer = Math.max(0, ball.serveHoldTimer - dt);
          ball.x = W / 2;
          ball.y = H / 2;
          ball.vx = 0;
          ball.vy = 0;
          ball.flash = Math.max(ball.flash, 0.92);
          if (ball.serveHoldTimer <= 0) {
            ball.vx = ball.serveReleaseVx || ball.vx;
            ball.vy = ball.serveReleaseVy || ball.vy;
            ball.serveReleaseVx = 0;
            ball.serveReleaseVy = 0;
            ball.flash = Math.max(ball.flash, 1);
          }
        }
      }

      function updatePowerups(dt) {
        for (let i = world.powerups.length - 1; i >= 0; i--) {
          const p = world.powerups[i];
          p.life -= dt;
          p.pulse += dt * 4;
          if (p.life <= 0) world.powerups.splice(i, 1);
        }

        if (!state.powerupsEnabled || state.gameOver || state.menuOpen) return;
        state.powerSpawnTimer -= dt;
        if (state.powerSpawnTimer <= 0 && world.powerups.length < powerupBalance.spawn.maxOnField) {
          state.powerSpawnTimer = powerupBalance.spawn.repeatDelayBaseSeconds + rng.next() * powerupBalance.spawn.repeatDelayRandomSeconds;
          spawnPowerup();
        }
      }

      function updateTimers(dt) {
        state.roundSeconds += dt;
        state.leftBoostTimer = Math.max(0, state.leftBoostTimer - dt);
        state.rightBoostTimer = Math.max(0, state.rightBoostTimer - dt);
        state.slowmoTimer = Math.max(0, state.slowmoTimer - dt);
        state.comboFlash = Math.max(0, state.comboFlash - dt);
        screenShake = Math.max(0, screenShake - dt * 22);
        if (state.powerDurationTimer > 0) {
          state.powerDurationTimer -= dt;
          if (state.powerDurationTimer <= 0) {
            world.paddles.left.h += (world.paddles.left.baseH - world.paddles.left.h);
            world.paddles.right.h += (world.paddles.right.baseH - world.paddles.right.h);
            updateUI();
          }
        }
        const left = world.paddles.left;
        const right = world.paddles.right;
        adjustWaveXP(left, PASSIVE_XP_PER_SEC * dt, { silent: true });
        adjustWaveXP(right, PASSIVE_XP_PER_SEC * dt, { silent: true });
        if (state.leftBoostTimer <= 0) left.h += (left.baseH - left.h) * Math.min(1, dt * paddleControlBalance.sizeRecoveryRate);
        if (state.rightBoostTimer <= 0) right.h += (right.baseH - right.h) * Math.min(1, dt * paddleControlBalance.sizeRecoveryRate);
        left.y = Math.max(paddleBalance.boundaryInset, Math.min(H - paddleBalance.boundaryInset - left.h, left.y));
        right.y = Math.max(paddleBalance.boundaryInset, Math.min(H - paddleBalance.boundaryInset - right.h, right.y));
      }

function update(dt) {
        if (!state.running || state.menuOpen) return;

        updateGoalFlashes(dt);
        if (state.paused || state.gameOver) return;

        updatePlayCountdown(dt);
        updateServeHolds(dt);
        if (state.countdownActive) {
          updateUI();
          return;
        }

        updateTimers(dt);

        maybeRunController('left');
        maybeRunController('right');
        maybeQueueHumanInput('left');
        maybeQueueHumanInput('right');

        const leftQueued = (controllerSlots.left || shouldQueueHumanInput('left') || inputQueue.left.has(state.tick)) ? getQueuedAction('left') : null;
        const rightQueued = (controllerSlots.right || shouldQueueHumanInput('right') || inputQueue.right.has(state.tick)) ? getQueuedAction('right') : null;

        if (leftQueued) {
          updatePaddle(world.paddles.left, leftQueued.moveAxis < 0, leftQueued.moveAxis > 0, dt);
          if (leftQueued.fire) firePulse(world.paddles.left);
        } else if (state.demoMode) {
          updateAI(world.paddles.left, dt, true);
        } else {
          updatePaddle(world.paddles.left, false, false, dt);
        }

        if (rightQueued) {
          updatePaddle(world.paddles.right, rightQueued.moveAxis < 0, rightQueued.moveAxis > 0, dt);
          if (rightQueued.fire) firePulse(world.paddles.right);
        } else if (state.demoMode) {
          updateAI(world.paddles.right, dt, false);
        } else if (state.mode === 'pvp') {
          updatePaddle(world.paddles.right, false, false, dt);
        } else {
          updateAI(world.paddles.right, dt, false);
        }

        updateBalls(dt);
        maybeTriggerLongRallyMultiball();
        updatePulses(dt);
        updateParticles(dt);
        updateFloatTexts(dt);
        updatePowerups(dt);
        updateUI();
      }

      function roundedRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      }

      function drawGlowLine(x1, y1, x2, y2, color, width) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.shadowColor = color;
        ctx.shadowBlur = width * 2.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
      }

      function colorWithAlpha(color, alpha) {
        const safeAlpha = clamp(alpha, 0, 1);
        if (typeof color === 'string' && color[0] === '#') {
          let hex = color.slice(1);
          if (hex.length === 3) {
            hex = hex.split('').map((char) => char + char).join('');
          }
          if (hex.length === 6) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
          }
        }
        return `rgba(255, 255, 255, ${safeAlpha})`;
      }

      function renderBackground() {
        const t = themes[state.theme];
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, t.bgTop);
        g.addColorStop(1, t.bgBottom);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        const pulse = 0.5 + Math.sin(performance.now() * 0.0013) * 0.1;
        const rg1 = ctx.createRadialGradient(W * 0.18, H * 0.2, 10, W * 0.18, H * 0.2, 320);
        rg1.addColorStop(0, `rgba(${t.glowA}, ${0.18 * pulse})`);
        rg1.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg1;
        ctx.fillRect(0, 0, W, H);

        const rg2 = ctx.createRadialGradient(W * 0.82, H * 0.8, 10, W * 0.82, H * 0.8, 340);
        rg2.addColorStop(0, `rgba(${t.glowB}, ${0.16 * pulse})`);
        rg2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg2;
        ctx.fillRect(0, 0, W, H);

        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 2;
        ctx.setLineDash([12, 18]);
        ctx.beginPath();
        ctx.moveTo(W / 2, 24);
        ctx.lineTo(W / 2, H - 24);
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 3;
        roundedRect(14, 14, W - 28, H - 28, 24);
        ctx.stroke();
      }

      function renderGoalFlashes() {
        for (const flash of world.goalFlashes) {
          const lifeAlpha = clamp(flash.life / flash.maxLife, 0, 1);
          const progress = 1 - lifeAlpha;
          const beamLength = flash.length * (0.7 + progress * 0.3);
          const direction = flash.side === 'left' ? 1 : -1;
          const originX = flash.side === 'left' ? flash.originInset : W - flash.originInset;
          const endX = originX + direction * beamLength;
          const glowAlpha = lifeAlpha * lifeAlpha;
          const glowGradient = ctx.createLinearGradient(originX, flash.y, endX, flash.y);
          glowGradient.addColorStop(0, colorWithAlpha(flash.color, 0.7 * glowAlpha));
          glowGradient.addColorStop(0.35, colorWithAlpha(flash.color, 0.3 * glowAlpha));
          glowGradient.addColorStop(1, colorWithAlpha(flash.color, 0));
          const coreGradient = ctx.createLinearGradient(originX, flash.y, endX, flash.y);
          coreGradient.addColorStop(0, `rgba(255,255,255,${0.92 * glowAlpha})`);
          coreGradient.addColorStop(0.28, colorWithAlpha(flash.color, 0.45 * glowAlpha));
          coreGradient.addColorStop(1, 'rgba(255,255,255,0)');

          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';
          ctx.strokeStyle = glowGradient;
          ctx.lineWidth = flash.thickness;
          ctx.shadowColor = flash.color;
          ctx.shadowBlur = flash.thickness * 1.35;
          ctx.beginPath();
          ctx.moveTo(originX, flash.y);
          ctx.lineTo(endX, flash.y);
          ctx.stroke();

          ctx.strokeStyle = coreGradient;
          ctx.lineWidth = Math.max(4, flash.thickness * 0.32);
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 16 + glowAlpha * 12;
          ctx.beginPath();
          ctx.moveTo(originX, flash.y);
          ctx.lineTo(endX, flash.y);
          ctx.stroke();

          ctx.fillStyle = `rgba(255,255,255,${0.72 * glowAlpha})`;
          ctx.beginPath();
          ctx.arc(originX, flash.y, Math.max(5, flash.thickness * 0.18), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      function renderAimer(paddle) {
        const origin = getPulseOrigin(paddle);
        const stats = getPulseStats(paddle);
        const readiness = paddle.cooldown > 0 ? clamp(1 - paddle.cooldown / stats.cooldown, 0.15, 1) : 1;
        const len = stats.mode === 'push' ? W * 0.64 : stats.range * (0.34 + (paddle.pulseCharge || 0) * 0.38);
        const coreColor = stats.mode === 'push' ? '255, 189, 89' : (stats.mode === 'solid' ? '255, 124, 215' : '123, 210, 255');
        const accentColor = stats.mode === 'push' ? '255, 232, 174' : (stats.mode === 'solid' ? '255, 204, 242' : '170, 225, 255');
        const beamX = origin.x + Math.cos(paddle.aimAngle) * len;
        const beamY = origin.y + Math.sin(paddle.aimAngle) * len;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(${coreColor}, ${0.22 + readiness * 0.48})`;
        ctx.lineWidth = stats.mode === 'push' ? 4.4 : (stats.mode === 'solid' ? 3.6 : 3);
        ctx.shadowColor = stats.glow;
        ctx.shadowBlur = stats.mode === 'push' ? 26 : 18;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(beamX, beamY);
        ctx.stroke();

        ctx.strokeStyle = `rgba(${accentColor}, ${0.16 + readiness * 0.22})`;
        ctx.lineWidth = 1.6;
        const sideA = paddle.aimAngle + (stats.mode === 'push' ? 0.05 : 0.08);
        const sideB = paddle.aimAngle - (stats.mode === 'push' ? 0.05 : 0.08);
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(origin.x + Math.cos(sideA) * (len * 0.78), origin.y + Math.sin(sideA) * (len * 0.78));
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(origin.x + Math.cos(sideB) * (len * 0.78), origin.y + Math.sin(sideB) * (len * 0.78));
        ctx.stroke();
        ctx.restore();
      }

      function drawMiniStatusToken(x, y, token) {
        const styles = {
          buff: ['rgba(134,255,177,0.16)', 'rgba(134,255,177,0.38)', '#dcffe8'],
          debuff: ['rgba(255,106,139,0.16)', 'rgba(255,106,139,0.38)', '#ffe3ea'],
          neutral: ['rgba(255,255,255,0.1)', 'rgba(255,255,255,0.2)', '#f3f7ff']
        };
        const [bg, line, fg] = styles[token.tone] || styles.neutral;
        ctx.save();
        ctx.fillStyle = bg;
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        roundedRect(x, y, 18, 18, 6);
        ctx.fill();
        roundedRect(x, y, 18, 18, 6);
        ctx.stroke();
        ctx.fillStyle = fg;
        ctx.font = '800 10px Inter, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(token.symbol, x + 9, y + 9.5);
        ctx.restore();
      }

      function renderPulseMeters(paddle) {
        refreshPaddleChargeState(paddle);
        const maxCharge = getPaddleMaxCharge(paddle);
        const barWidth = 74 * maxCharge;
        const baseX = paddle.side === 'left' ? paddle.x + 2 : paddle.x - (barWidth - 16);
        const baseY = paddle.y - 24;
        const charge = clamp(paddle.pulseCharge || 0, 0, maxCharge);
        const meterColor = charge >= FULL_CHARGE_THRESHOLD ? '#ffbd59' : (charge >= SOLID_CHARGE_THRESHOLD ? '#ff7cd7' : '#7bd2ff');
        const xpProgress = getLevelProgress(paddle);
        const xpColor = paddle.pulseLevel >= MAX_WAVE_LEVEL ? '#ffd34d' : '#a66bff';
        const pulseLight = (paddle.overcapTimer > 0 || paddle.chargeBoostTimer > 0)
          ? (0.14 + 0.18 * (0.5 + 0.5 * Math.sin(performance.now() * 0.016 + paddle.chargeGlowPhase)))
          : 0;
        const fillWidth = charge <= 0 ? 0 : Math.max(8, barWidth * (charge / maxCharge));
        const effectTokens = getPaddleEffectTokens(paddle).slice(0, 3);

        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        roundedRect(baseX, baseY, barWidth, 7, 4);
        ctx.fill();
        if (maxCharge > BASE_MAX_CHARGE) {
          ctx.fillStyle = 'rgba(120, 240, 255, 0.08)';
          roundedRect(baseX + 74, baseY, barWidth - 74, 7, 4);
          ctx.fill();
          ctx.strokeStyle = 'rgba(120, 240, 255, 0.32)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(baseX + 74, baseY - 1);
          ctx.lineTo(baseX + 74, baseY + 8);
          ctx.stroke();
        }
        if (fillWidth > 0) {
          ctx.fillStyle = meterColor;
          ctx.shadowColor = meterColor;
          ctx.shadowBlur = 14;
          roundedRect(baseX, baseY, fillWidth, 7, 4);
          ctx.fill();
          if (pulseLight > 0) {
            ctx.globalAlpha = pulseLight;
            ctx.fillStyle = '#fffef5';
            roundedRect(baseX + 1.4, baseY + 1.1, Math.max(0, fillWidth - 2.8), 2.4, 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }

        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        roundedRect(baseX, baseY + 11, 74, 5, 3);
        ctx.fill();
        ctx.fillStyle = xpColor;
        ctx.shadowColor = xpColor;
        ctx.shadowBlur = 10;
        roundedRect(baseX, baseY + 11, Math.max(6, 74 * xpProgress), 5, 3);
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '800 11px Inter, Segoe UI, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('L' + paddle.pulseLevel + (paddle.pulseLevel >= MAX_WAVE_LEVEL ? ' MAX' : ''), baseX, baseY - 2);
        let iconX = baseX + 28;
        for (const token of effectTokens) {
          drawMiniStatusToken(iconX, baseY - 20, token);
          iconX += 22;
        }
        ctx.restore();
      }

function renderPowerups() {
        for (const p of world.powerups) {
          const def = powerupDefs[p.type] || powerupDefs.grow;
          const pulse = 1 + Math.sin(p.pulse) * 0.14;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.shadowColor = def.color;
          ctx.shadowBlur = def.kind === 'minion' ? 28 : 22;

          if (def.kind === 'debuff') {
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = def.fill;
            roundedRect(-p.r * pulse, -p.r * pulse, p.r * 2 * pulse, p.r * 2 * pulse, 8);
            ctx.fill();
            ctx.strokeStyle = def.outline;
            ctx.lineWidth = 3;
            roundedRect(-p.r * pulse, -p.r * pulse, p.r * 2 * pulse, p.r * 2 * pulse, 8);
            ctx.stroke();
            ctx.rotate(-Math.PI / 4);
          } else if (def.kind === 'minion') {
            const spikes = 8;
            const outer = p.r * 1.15 * pulse;
            const inner = p.r * 0.58 * pulse;
            ctx.beginPath();
            for (let i = 0; i < spikes * 2; i++) {
              const r = i % 2 === 0 ? outer : inner;
              const a = -Math.PI / 2 + i * Math.PI / spikes;
              const x = Math.cos(a) * r;
              const y = Math.sin(a) * r;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fillStyle = def.fill;
            ctx.fill();
            ctx.strokeStyle = def.outline;
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, p.r * 0.42 * pulse, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(235,255,236,0.9)';
            ctx.fill();
          } else {
            ctx.fillStyle = def.fill;
            ctx.beginPath();
            ctx.arc(0, 0, p.r * pulse, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = def.outline;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, p.r * pulse, 0, Math.PI * 2);
            ctx.stroke();
          }

          ctx.fillStyle = def.kind === 'minion' ? '#06210d' : '#091018';
          ctx.font = def.kind === 'minion' ? 'bold 17px Inter, Segoe UI, sans-serif' : 'bold 18px Inter, Segoe UI, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(def.icon, 0, def.kind === 'minion' ? 0 : 1);
          ctx.restore();
        }
      }

function renderPaddle(paddle) {
        const t = themes[state.theme];
        const color = paddle.side === 'left' ? t.paddleLeft : t.paddleRight;
        renderAimer(paddle);
        ctx.save();
        const boost = paddle.side === 'left' ? state.leftBoostTimer : state.rightBoostTimer;
        ctx.translate(0, 0);
        ctx.shadowBlur = 28 + boost * 10;
        ctx.shadowColor = color;
        ctx.fillStyle = color;
        const wobble = paddle.jamTimer > 0 ? Math.sin(performance.now() * 0.08 + (paddle.side === 'left' ? 0 : 1.4)) * 3.5 * Math.min(1, paddle.jamTimer + 0.15) : 0;
        const w = paddle.w * paddle.hitScale;
        const x = paddle.x - (w - paddle.w) / 2 + wobble;
        const h = paddle.h * (1 + paddle.flash * 0.04);
        const y = paddle.y - (h - paddle.h) / 2;
        roundedRect(x, y, w, h, 12);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        roundedRect(x + 3, y + 4, Math.max(4, w * 0.28), h - 8, 10);
        ctx.fill();
        if (paddle.jamTimer > 0) {
          ctx.strokeStyle = 'rgba(180, 230, 255, 0.8)';
          ctx.lineWidth = 2;
          for (let i = 0; i < 4; i++) {
            const yy = y + 10 + i * (h - 20) / 3;
            ctx.beginPath();
            ctx.moveTo(x - 4, yy + Math.sin(performance.now() * 0.03 + i) * 2);
            ctx.lineTo(x + w + 4, yy + Math.cos(performance.now() * 0.035 + i * 1.7) * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
        renderPulseMeters(paddle);
      }

      function renderBalls() {

        const t = themes[state.theme];
        for (const ball of world.balls) {
          const hitColor = getBallRenderColor(ball, t);
          const holdAlpha = (ball.serveHoldTimer || 0) > 0 && (ball.serveHoldDuration || 0) > 0
            ? clamp(ball.serveHoldTimer / ball.serveHoldDuration, 0, 1)
            : 0;
          if (state.trailsEnabled) {
            for (let i = 0; i < ball.trail.length; i++) {
              const trail = ball.trail[i];
              const trailBoostStrength = Math.log2(1 + Math.max(0, trail.boostIntensity || 0));
              const alpha = clamp(Math.max(0, trail.life / 0.35) * (i / Math.max(1, ball.trail.length)) * (1 + trailBoostStrength * 0.14), 0, 1);
              ctx.save();
              ctx.globalAlpha = alpha * 0.55;
              ctx.fillStyle = trail.boost || hitColor;
              ctx.beginPath();
              ctx.arc(trail.x, trail.y, ball.r * (0.35 + alpha * 0.5 + trailBoostStrength * 0.08), 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }
          ctx.save();
          if (holdAlpha > 0) {
            const pulse = 0.5 + Math.sin((state.presentationTimeMs || 0) * 0.001 * Math.PI * 2 * matchFlowBalance.serveHoldPulseHz + ball.id * 0.55) * 0.5;
            const haloRadius = ball.r + matchFlowBalance.serveHoldGlowRadius * (0.72 + pulse * 0.48);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.2 + pulse * 0.22 + holdAlpha * 0.12;
            ctx.fillStyle = hitColor;
            ctx.shadowColor = hitColor;
            ctx.shadowBlur = 20 + pulse * 18;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, haloRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.34 + pulse * 0.18;
            ctx.strokeStyle = 'rgba(255,255,255,0.92)';
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, haloRadius + 5 + pulse * 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          const boostStrength = Math.log2(1 + Math.max(0, ball.boostIntensity || 0));
          const boostAlpha = clamp(ball.boostTimer || 0, 0, 0.55) / 0.55;
          const boostOpacity = clamp(boostAlpha * (0.46 + boostStrength * 0.18), 0, 1);
          if (boostOpacity > 0) {
            const speed = Math.hypot(ball.vx, ball.vy) || 1;
            const nx = ball.vx / speed;
            const ny = ball.vy / speed;
            const boostColor = ball.boostColor || '#7bd2ff';
            ctx.strokeStyle = boostColor;
            ctx.shadowColor = boostColor;
            ctx.shadowBlur = 16 + boostOpacity * 12 + boostStrength * 4;
            ctx.lineCap = 'round';
            for (let lane = -1; lane <= 1; lane++) {
              const sideOffset = 4.5 + boostStrength * 0.6;
              const sideX = -ny * lane * sideOffset;
              const sideY = nx * lane * sideOffset;
              ctx.globalAlpha = boostOpacity * (lane === 0 ? 0.5 : 0.28);
              ctx.lineWidth = (lane === 0 ? 4.4 : 2.3) + boostStrength * (lane === 0 ? 0.9 : 0.4);
              ctx.beginPath();
              ctx.moveTo(ball.x + sideX, ball.y + sideY);
              ctx.lineTo(ball.x - nx * (20 + boostOpacity * 16 + boostStrength * 8) + sideX, ball.y - ny * (20 + boostOpacity * 16 + boostStrength * 8) + sideY);
              ctx.stroke();
            }
          }

          ctx.globalAlpha = 1;
          ctx.shadowColor = boostOpacity > 0 ? (ball.boostColor || hitColor) : hitColor;
          ctx.shadowBlur = 20 + ball.flash * 12 + boostOpacity * 10 + boostStrength * 2;
          ctx.fillStyle = hitColor;
          ctx.beginPath();
          ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = boostOpacity > 0 ? 'rgba(255,250,228,0.96)' : 'rgba(255,255,255,0.92)';
          ctx.beginPath();
          ctx.arc(ball.x, ball.y, ball.r * 0.52, 0, Math.PI * 2);
          ctx.fill();

          if (ball.lastHitSide) {
            ctx.strokeStyle = boostOpacity > 0 ? (ball.boostColor || 'rgba(255,255,255,0.8)') : 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 1.6 + boostOpacity * 1.2 + boostStrength * 0.2;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.r - 1.2, 0, Math.PI * 2);
            ctx.stroke();
          }

          const resistAlpha = clamp(ball.blueResistTimer || 0, 0, 1.5) / 1.5;
          if (resistAlpha > 0) {
            ctx.strokeStyle = `rgba(123, 210, 255, ${0.2 + resistAlpha * 0.45})`;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.r + 3.8, 0, Math.PI * 2);
            ctx.stroke();
          }

          const stunAlpha = clamp(ball.stunTimer || 0, 0, 0.16) / 0.16;
          if (stunAlpha > 0) {
            ctx.strokeStyle = `rgba(123, 210, 255, ${0.2 + stunAlpha * 0.5})`;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, ball.r + 7.5, Math.sin(ball.hueShift * 2) * 0.4, Math.sin(ball.hueShift * 2) * 0.4 + Math.PI * 1.3);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      function renderStoppedPlayGhostArrows() {
        if ((!state.countdownActive && !state.paused) || !world.balls.length) return;

        for (const ball of world.balls) {
          const speed = Math.hypot(ball.vx, ball.vy);
          if (speed < 1) continue;

          const dirX = ball.vx / speed;
          const dirY = ball.vy / speed;
          const t = themes[state.theme];
          const color = ball.lastHitSide === 'left' ? t.paddleLeft : (ball.lastHitSide === 'right' ? t.paddleRight : t.ball);
          const length = clamp(
            matchFlowBalance.preview.arrowMinLength + (speed / BALL_SPEED_CAP) * (matchFlowBalance.preview.arrowMaxLength - matchFlowBalance.preview.arrowMinLength),
            matchFlowBalance.preview.arrowMinLength,
            matchFlowBalance.preview.arrowMaxLength
          );
          const head = matchFlowBalance.preview.arrowHeadLength;
          const wingX = -dirY;
          const wingY = dirX;
          const startX = ball.x + dirX * (ball.r + 8);
          const startY = ball.y + dirY * (ball.r + 8);
          const endX = startX + dirX * length;
          const endY = startY + dirY * length;

          ctx.save();
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.globalAlpha = matchFlowBalance.preview.alpha;
          ctx.lineCap = 'round';
          ctx.lineWidth = 2.4;
          ctx.setLineDash([8, 8]);
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(endX - dirX * head + wingX * (head * 0.55), endY - dirY * head + wingY * (head * 0.55));
          ctx.lineTo(endX - dirX * head - wingX * (head * 0.55), endY - dirY * head - wingY * (head * 0.55));
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      function renderCountdownOverlay() {
        if (!state.countdownActive) return;

        const secondsLeft = Math.max(1, Math.ceil(state.countdownTimer));
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.strokeStyle = 'rgba(2, 6, 12, 0.78)';
        ctx.lineWidth = 8;
        ctx.font = '900 124px Inter, Segoe UI, sans-serif';
        ctx.strokeText(String(secondsLeft), W / 2, H / 2 - 10);
        ctx.fillText(String(secondsLeft), W / 2, H / 2 - 10);
        ctx.font = '700 22px Inter, Segoe UI, sans-serif';
        ctx.lineWidth = 5;
        ctx.fillStyle = 'rgba(223, 240, 255, 0.92)';
        ctx.strokeText('Press fire to skip', W / 2, H / 2 + 66);
        ctx.fillText('Press fire to skip', W / 2, H / 2 + 66);
        ctx.restore();
      }

function renderParticles() {
        for (const p of world.particles) {
          const alpha = Math.max(0, p.life / p.maxLife);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

function renderPulses() {
        for (const pulse of world.pulses) {
          const alpha = getPulseRenderAlpha(pulse);

          if (pulse.mode === 'push') {
            const thickness = getPulseThickness(pulse);
            const reduced = state.lowPerfEffects;

            if (!reduced) {
              for (const t of pulse.trail) {
                ctx.save();
                ctx.globalAlpha = clamp(t.life / 0.24, 0, 1) * 0.34;
                ctx.strokeStyle = pulse.color;
                ctx.lineWidth = thickness * 0.66;
                ctx.shadowColor = pulse.glow;
                ctx.shadowBlur = 16;
                ctx.beginPath();
                ctx.arc(t.x, t.y, pulse.arcRadius, t.angle - pulse.cone, t.angle + pulse.cone);
                ctx.stroke();
                ctx.restore();
              }
            } else {
              const t = pulse.trail[pulse.trail.length - 1];
              if (t) {
                ctx.save();
                ctx.globalAlpha = clamp(t.life / 0.16, 0, 1) * 0.18;
                ctx.strokeStyle = pulse.color;
                ctx.lineWidth = Math.max(10, thickness * 0.44);
                ctx.beginPath();
                ctx.arc(t.x, t.y, pulse.arcRadius, t.angle - pulse.cone, t.angle + pulse.cone);
                ctx.stroke();
                ctx.restore();
              }
            }

            if (!reduced) {
              for (const d of pulse.diffraction) {
                const lifeAlpha = clamp(d.life / 0.6, 0, 1);
                const spread = 58 + (1 - lifeAlpha) * 120;
                const amp = 16 + lifeAlpha * 14;
                for (let band = 0; band < 3; band++) {
                  ctx.save();
                  ctx.globalAlpha = lifeAlpha * (0.24 - band * 0.05);
                  ctx.strokeStyle = band === 0 ? 'rgba(255, 248, 188, 1)' : (band === 1 ? 'rgba(255, 225, 108, 1)' : 'rgba(255, 211, 77, 1)');
                  ctx.lineWidth = Math.max(2, 6 - band * 1.4);
                  ctx.shadowColor = pulse.glow;
                  ctx.shadowBlur = 14;
                  ctx.beginPath();
                  let started = false;
                  for (let ox = -spread; ox <= spread; ox += 8) {
                    const envelope = Math.exp(-(ox * ox) / (2 * spread * spread));
                    const wave = Math.sin(ox * 0.08 + d.phase * 3.1 + band * 0.95);
                    const interference = Math.sin(ox * 0.17 - d.phase * 1.8 + band * 0.55);
                    const y = d.y + d.normal * ((band + 1) * 10 + (wave + 0.55 * interference) * amp * envelope);
                    const x = d.x + ox;
                    if (!started) {
                      ctx.moveTo(x, y);
                      started = true;
                    } else {
                      ctx.lineTo(x, y);
                    }
                  }
                  ctx.stroke();
                  ctx.restore();
                }
              }
            }

            ctx.save();
            ctx.strokeStyle = `rgba(255, 211, 77, ${0.42 + alpha * 0.44})`;
            ctx.lineWidth = thickness;
            ctx.shadowColor = pulse.glow;
            ctx.shadowBlur = reduced ? 10 : 30;
            ctx.beginPath();
            ctx.arc(pulse.x, pulse.y, pulse.arcRadius, pulse.angle - pulse.cone, pulse.angle + pulse.cone);
            ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.strokeStyle = `rgba(255, 248, 198, ${reduced ? (0.16 + alpha * 0.18) : (0.28 + alpha * 0.34)})`;
            ctx.lineWidth = reduced ? Math.max(6, thickness * 0.18) : Math.max(10, thickness * 0.3);
            ctx.beginPath();
            ctx.arc(pulse.x, pulse.y, pulse.arcRadius, pulse.angle - pulse.cone * 0.42, pulse.angle + pulse.cone * 0.42);
            ctx.stroke();
            ctx.restore();
            continue;
          }

          const radius = pulse.radius != null ? pulse.radius : getPulseRenderRadius(pulse);
          const thickness = getPulseThickness(pulse);
          ctx.save();
          ctx.strokeStyle = pulse.mode === 'solid'
            ? `rgba(255, 124, 215, ${0.34 + alpha * 0.56})`
            : `rgba(123, 210, 255, ${0.3 + alpha * 0.5})`;
          ctx.lineWidth = thickness;
          ctx.shadowColor = pulse.glow;
          ctx.shadowBlur = pulse.mode === 'solid' ? 30 : 24;
          ctx.beginPath();
          ctx.arc(pulse.x, pulse.y, radius, pulse.angle - pulse.cone, pulse.angle + pulse.cone);
          ctx.stroke();
          ctx.restore();

          ctx.save();
          ctx.fillStyle = pulse.fill;
          ctx.beginPath();
          ctx.moveTo(pulse.x, pulse.y);
          ctx.arc(pulse.x, pulse.y, radius, pulse.angle - pulse.cone, pulse.angle + pulse.cone);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

function renderOverlayFX() {

        const alpha = Math.min(0.22, state.comboFlash * 0.9);
        if (alpha > 0) {
          ctx.save();
          ctx.fillStyle = `rgba(255,255,255,${alpha})`;
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }

        if (state.slowmoTimer > 0) {
          ctx.save();
          ctx.fillStyle = 'rgba(120, 180, 255, 0.06)';
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
          drawGlowLine(50, 50, W - 50, 50, 'rgba(120,180,255,0.45)', 2);
          drawGlowLine(50, H - 50, W - 50, H - 50, 'rgba(120,180,255,0.35)', 2);
        }
      }

      function renderStatsOnCanvas() {
        const t = themes[state.theme];
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';

        ctx.font = '900 62px Inter, Segoe UI, sans-serif';
        ctx.lineWidth = 8;

        ctx.strokeStyle = 'rgba(2, 6, 12, 0.78)';
        ctx.fillStyle = t.paddleLeft;
        ctx.shadowColor = t.paddleLeft;
        ctx.shadowBlur = 22;
        ctx.strokeText(String(state.leftScore), W * 0.23, 72);
        ctx.fillText(String(state.leftScore), W * 0.23, 72);

        ctx.strokeStyle = 'rgba(2, 6, 12, 0.78)';
        ctx.fillStyle = t.paddleRight;
        ctx.shadowColor = t.paddleRight;
        ctx.shadowBlur = 22;
        ctx.strokeText(String(state.rightScore), W * 0.77, 72);
        ctx.fillText(String(state.rightScore), W * 0.77, 72);

        ctx.shadowBlur = 0;
        ctx.font = '800 30px Inter, Segoe UI, sans-serif';
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(2, 6, 12, 0.72)';
        ctx.fillStyle = t.power;
        ctx.strokeText(String(state.scoreLimit), W / 2, 66);
        ctx.fillText(String(state.scoreLimit), W / 2, 66);

        if (!state.menuOpen && !state.gameOver) {
          roundedRect(pauseButtonRect.x, pauseButtonRect.y, pauseButtonRect.width, pauseButtonRect.height, pauseButtonRect.radius);
          ctx.fillStyle = 'rgba(8, 16, 28, 0.84)';
          ctx.strokeStyle = 'rgba(255,255,255,0.16)';
          ctx.lineWidth = 2;
          ctx.shadowBlur = 0;
          ctx.fill();
          ctx.stroke();

          const barWidth = 7;
          const barHeight = 14;
          const barGap = 8;
          const centerX = pauseButtonRect.x + pauseButtonRect.width / 2;
          const centerY = pauseButtonRect.y + pauseButtonRect.height / 2;
          ctx.fillStyle = '#eef6ff';
          ctx.fillRect(centerX - barGap - barWidth / 2, centerY - barHeight / 2, barWidth, barHeight);
          ctx.fillRect(centerX + barGap - barWidth / 2, centerY - barHeight / 2, barWidth, barHeight);
        }
        ctx.restore();
      }

      function getCanvasWorldPoint(event) {
        if (!canvas || !windowRef) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const offsetX = (windowRef.innerWidth - W * scale) / 2;
        const offsetY = (windowRef.innerHeight - H * scale) / 2;
        const x = (event.clientX - rect.left - offsetX) / scale;
        const y = (event.clientY - rect.top - offsetY) / scale;
        return { x, y };
      }

      function isPauseButtonHit(point) {
        if (!point) return false;
        return point.x >= pauseButtonRect.x &&
          point.x <= pauseButtonRect.x + pauseButtonRect.width &&
          point.y >= pauseButtonRect.y &&
          point.y <= pauseButtonRect.y + pauseButtonRect.height;
      }

      function isPauseButtonPointerEvent(event) {
        if (!event || !canvas || state.menuOpen || state.gameOver || (ui.help && !ui.help.classList.contains('hidden'))) return false;
        return isPauseButtonHit(getCanvasWorldPoint(event));
      }

      function render() {
        if (!ctx || !canvas || !windowRef) return;
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.translate((windowRef.innerWidth - W * scale) / 2, (windowRef.innerHeight - H * scale) / 2);
        ctx.scale(scale, scale);
        if (screenShake > 0) {
          ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
        }

        renderBackground();
        renderGoalFlashes();
        renderPowerups();
        renderPulses();
        renderParticles();
        renderFloatTexts();
        renderPaddle(world.paddles.left);
        renderPaddle(world.paddles.right);
        renderBalls();
        renderStoppedPlayGhostArrows();
        renderOverlayFX();
        renderCountdownOverlay();
        renderStatsOnCanvas();
        ctx.restore();
      }

      function stepSimulation(tickCount = 1) {
        const safeCount = Math.max(1, Math.floor(tickCount));
        for (let i = 0; i < safeCount; i += 1) {
          state.tick += 1;
          state.simulationTimeMs = state.tick * fixedDt * 1000;
          update(fixedDt);
          if (state.tick === 1 || state.tick % fixedTickRate === 0) {
            replay.stateHashes.push({ tick: state.tick, hash: hashSimulationState() });
          }
        }
      }

      function loop(ts) {
        if (!mounted || !windowRef) return;
        const dt = Math.min(0.25, ((ts - lastFrameTime) / 1000) || fixedDt);
        lastFrameTime = ts;
        state.presentationTimeMs = ts;
        fixedAccumulator += dt;
        while (fixedAccumulator >= fixedDt) {
          stepSimulation(1);
          fixedAccumulator -= fixedDt;
        }
        render();
        loopHandle = windowRef.requestAnimationFrame(loop);
      }

      const cleanupFns = [];

      function listen(target, eventName, handler, optionsArg) {
        if (!target || typeof target.addEventListener !== 'function') return;
        target.addEventListener(eventName, handler, optionsArg);
        cleanupFns.push(() => target.removeEventListener(eventName, handler, optionsArg));
      }

      function wireMenuButton(id, handler) {
        if (!documentRef) return;
        const el = documentRef.getElementById(id);
        if (!el) return;
        let lastPointerFire = 0;
        const run = (event) => {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
          handler();
        };
        const onPointerDown = (event) => {
          if (event && event.pointerType === 'touch') return;
          lastPointerFire = windowRef && windowRef.performance ? windowRef.performance.now() : Date.now();
          run(event);
        };
        const onClick = (event) => {
          const now = windowRef && windowRef.performance ? windowRef.performance.now() : Date.now();
          if (now - lastPointerFire < 250) return;
          run(event);
        };
        listen(el, 'pointerdown', onPointerDown);
        listen(el, 'click', onClick);
      }

      function openHelp() {
        state.helpReturnToPause = state.paused && ui.pause && !ui.pause.classList.contains('hidden');
        if (state.helpReturnToPause && ui.pause) ui.pause.classList.add('hidden');
        if (ui.help) ui.help.classList.remove('hidden');
      }

      function closeHelp() {
        if (ui.help) ui.help.classList.add('hidden');
        if (state.helpReturnToPause && state.paused && !state.gameOver && ui.pause) {
          ui.pause.classList.remove('hidden');
        }
        state.helpReturnToPause = false;
      }

      function setControllers(nextControllers = {}) {
        if (Object.prototype.hasOwnProperty.call(nextControllers, 'left')) {
          controllerSlots.left = nextControllers.left;
        }
        if (Object.prototype.hasOwnProperty.call(nextControllers, 'right')) {
          controllerSlots.right = nextControllers.right;
        }
      }

      function setInputProvider(nextInputProvider) {
        inputProvider = typeof nextInputProvider === 'function' ? nextInputProvider : null;
      }

      function setLiveInputEnabled(nextValue) {
        liveInputEnabled = !!nextValue;
      }

      function flushEvents() {
        return eventQueue.splice(0, eventQueue.length);
      }

      function setMuted(nextMuted) {
        muted = !!nextMuted;
      }

      function mountBrowser() {
        if (mounted || !documentRef || !windowRef) return runtimeApi;
        mounted = true;

        listen(documentRef, 'keydown', (e) => {
          const key = e.key.toLowerCase();
          if (key === 'w') input.w = true;
          else if (key === 's') input.s = true;
          else if (e.key === 'ArrowUp') {
            input.up = true;
            if (shouldCaptureGameplayKeys()) e.preventDefault();
          } else if (e.key === 'ArrowDown') {
            input.down = true;
            if (shouldCaptureGameplayKeys()) e.preventDefault();
          } else if (key === 'f' || e.code === 'Space') {
            e.preventDefault();
            if (skipPlayCountdown()) return;
            if (!e.repeat && !state.menuOpen && !state.paused && !state.gameOver) input.leftFireQueued = true;
          } else if (key === '/') {
            if (skipPlayCountdown()) return;
            if (!e.repeat && !state.menuOpen && !state.paused && !state.gameOver && state.mode === 'pvp' && !state.demoMode) input.rightFireQueued = true;
          } else if (key === 'm') {
            muted = !muted;
            updateStatus(muted ? 'Muted. Silent chaos enabled.' : 'Unmuted. The bleeps have returned.');
          } else if (key === 'p') {
            e.preventDefault();
            if (state.menuOpen) return;
            pauseGame();
          } else if (key === 'escape') {
            e.preventDefault();
            if (ui.help && !ui.help.classList.contains('hidden')) {
              closeHelp();
              return;
            }
            if (state.menuOpen) return;
            pauseGame();
          }
        });

        listen(documentRef, 'keyup', (e) => {
          const key = e.key.toLowerCase();
          if (key === 'w') input.w = false;
          else if (key === 's') input.s = false;
          else if (e.key === 'ArrowUp') {
            input.up = false;
            if (shouldCaptureGameplayKeys()) e.preventDefault();
          } else if (e.key === 'ArrowDown') {
            input.down = false;
            if (shouldCaptureGameplayKeys()) e.preventDefault();
          }
        });

        listen(canvas, 'pointerdown', (event) => {
          if (!isPauseButtonPointerEvent(event)) return;
          event.preventDefault();
          event.stopPropagation();
          pauseGame();
        });

        wireMenuButton('startBtn', () => startMatch({ demo: false }));
        wireMenuButton('demoBtn', () => startMatch({ demo: true }));
        wireMenuButton('menuHelpBtn', openHelp);
        wireMenuButton('pauseHelpBtn', openHelp);
        wireMenuButton('closeHelpBtn', closeHelp);
        wireMenuButton('resumeBtn', () => pauseGame(false));
        wireMenuButton('pauseMenuBtn', backToMenu);
        wireMenuButton('rematchBtn', () => startMatch({ demo: state.demoMode }));
        wireMenuButton('gameOverMenuBtn', backToMenu);

        ['change', 'input'].forEach((eventName) => {
          listen(ui.themeSelect, eventName, () => applyTheme(ui.themeSelect.value));
          listen(ui.difficultySelect, eventName, () => {
            const option = getSelectedDifficultyOption();
            if (option) {
              const label = option.dataset && option.dataset.summary ? option.dataset.summary : option.text;
              updateStatus('Opponent selected: ' + label + '.');
            }
          });
          listen(ui.scoreLimitSelect, eventName, () => {
            const value = sanitizeScoreLimit(ui.scoreLimitSelect.value);
            if (String(value) !== ui.scoreLimitSelect.value) ui.scoreLimitSelect.value = value;
            updateStatus('Goal limit set to ' + value + '.');
          });
        });

        listen(windowRef, 'resize', resize);
        listen(windowRef, 'pointerdown', initAudio, { once: true });

        resize();
        applyTheme(state.theme);
        updateMenuStats();
        updateUI();
        render();
        lastFrameTime = 0;
        fixedAccumulator = 0;
        loopHandle = windowRef.requestAnimationFrame(loop);
        return runtimeApi;
      }

      function unmountBrowser() {
        mounted = false;
        while (cleanupFns.length) {
          const cleanup = cleanupFns.pop();
          cleanup();
        }
        if (windowRef && loopHandle) {
          windowRef.cancelAnimationFrame(loopHandle);
          loopHandle = null;
        }
      }

      const runtimeApi = {
        canvas,
        ctx,
        ui,
        config,
        state,
        world,
        get history() {
          return history;
        },
        get matchStats() {
          return matchStats;
        },
        fixedTickRate,
        fixedDt,
        headless,
        startMatch,
        backToMenu,
        pauseGame,
        stepSimulation,
        queueInput,
        getObservation,
        cloneSimulation,
        restoreSimulation,
        serializeReplay,
        loadReplay,
        hashSimulationState,
        flushEvents,
        setControllers,
        setInputProvider,
        setLiveInputEnabled,
        setMuted,
        isPauseButtonPointerEvent,
        mountBrowser,
        unmountBrowser,
        render,
        resize
      };

      return runtimeApi;
  }

  return {
    DEFAULT_TICK_RATE,
    DEFAULT_DECISION_INTERVAL_TICKS,
    createRuntime,
    createSimulation(options = {}) {
      return createRuntime({ ...options, headless: true });
    },
    stepSimulation(runtime, tickCount) {
      return runtime.stepSimulation(tickCount);
    },
    queueInput(runtime, side, tick, action) {
      return runtime.queueInput(side, tick, action);
    },
    getObservation(runtime, side) {
      return runtime.getObservation(side);
    },
    cloneSimulation(runtime) {
      return runtime.cloneSimulation();
    },
    restoreSimulation(runtime, snapshot) {
      return runtime.restoreSimulation(snapshot);
    },
    serializeReplay(runtime) {
      return runtime.serializeReplay();
    },
    loadReplay(runtime, replayData) {
      return runtime.loadReplay(replayData);
    },
    hashSimulationState(runtime) {
      return runtime.hashSimulationState();
    }
  };
});

