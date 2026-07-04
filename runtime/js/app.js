(() => {
  const ns = window.WavePong || {};
  const simCore = ns.SimCore;
  const controllers = ns.Controllers;
  const config = ns.CONFIG;
  const runtimeVersion = ns.VERSION;
  const botRoster = Array.isArray(ns.BOT_ROSTER) ? ns.BOT_ROSTER : [];
  const multiplayer = ns.Multiplayer || null;
  const onlineApi = ns.Online || null;
  const env = ns.ENV || {};
  const CLASSIC_DIFFICULTIES = [
    { key: 'chill', label: 'Chill' },
    { key: 'spicy', label: 'Spicy' },
    { key: 'absurd', label: 'Ridiculous' }
  ];
  const DIFFICULTY_ORDER = { chill: 0, spicy: 1, absurd: 2 };

  if (!simCore) throw new Error('Wave Pong sim core missing. Load js/sim-core.js before js/app.js.');
  if (!controllers) throw new Error('Wave Pong controllers missing. Load js/controllers.js before js/app.js.');
  if (!config) throw new Error('Wave Pong config missing. Load js/config.js before js/app.js.');

  const runtime = simCore.createRuntime({
    document,
    window,
    config,
    runtimeVersion
  });

  const botInfoOverlay = document.getElementById('botInfoOverlay');
  const botInfoTitle = document.getElementById('botInfoTitle');
  const botInfoSubtitle = document.getElementById('botInfoSubtitle');
  const botInfoGrid = document.getElementById('botInfoGrid');
  const botInfoNotes = document.getElementById('botInfoNotes');
  const menuBotInfoBtn = document.getElementById('menuBotInfoBtn');
  const pauseBotInfoBtn = document.getElementById('pauseBotInfoBtn');
  const closeBotInfoBtn = document.getElementById('closeBotInfoBtn');

  const onlineEnabledPill = document.getElementById('onlineEnabledPill');
  const onlineNameInput = document.getElementById('onlineNameInput');
  const onlineNameRerollBtn = document.getElementById('onlineNameRerollBtn');
  const onlineQueueBtn = document.getElementById('onlineQueueBtn');
  const onlineLeaveQueueBtn = document.getElementById('onlineLeaveQueueBtn');
  const onlineStatusText = document.getElementById('onlineStatusText');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const pauseFullscreenBtn = document.getElementById('pauseFullscreenBtn');
  const touchControlsRoot = document.getElementById('touchControls');
  const touchMoveZone = document.getElementById('touchMoveZone');
  const touchStick = document.getElementById('touchStick');
  const touchStickKnob = document.getElementById('touchStickKnob');

  function createTouchController() {
    const supported = !!(
      touchControlsRoot &&
      touchMoveZone &&
      touchStick &&
      touchStickKnob &&
      (
        (window.navigator && Number(window.navigator.maxTouchPoints) > 0) ||
        ('ontouchstart' in window) ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
      )
    );

    if (!supported) {
      return {
        bind() {},
        sync() {},
        decorateAction(defaultAction) {
          return defaultAction;
        },
        getAction(defaultAction) {
          return defaultAction;
        }
      };
    }

    const state = {
      movePointerId: null,
      moveAxis: 0,
      moveEngaged: false,
      fireQueued: false,
      originX: 68,
      originY: 68,
      anchorClientX: 0,
      anchorClientY: 0,
      knobX: 0,
      knobY: 0,
      visible: false
    };
    let syncHandle = 0;
    const MAX_RADIUS = 52;
    const HORIZONTAL_SWAY = 16;
    const DEAD_ZONE = 0.16;
    // Fire is a tap gesture, never a press: the first finger that lands on the
    // play area is a steering touch and must NOT fire. Active non-joystick
    // touches are tracked here so we can distinguish a quick tap-release (fire)
    // from a drag-to-steer (no fire), and fire immediately when a second finger
    // lands while one is already steering.
    const firePointers = new Map();
    const TAP_MAX_MS = 250;
    const TAP_MOVE_PX = 14;

    function touchNowMs() {
      return (window.performance && typeof window.performance.now === 'function')
        ? window.performance.now()
        : Date.now();
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function updateStickVisual() {
      touchStick.style.left = `${state.originX}px`;
      touchStick.style.top = `${state.originY}px`;
      touchStickKnob.style.transform = `translate(${state.knobX}px, ${state.knobY}px)`;
      touchStick.classList.toggle('active', state.moveEngaged);
    }

    function resetMoveState() {
      state.movePointerId = null;
      state.moveAxis = 0;
      state.moveEngaged = false;
      state.knobX = 0;
      state.knobY = 0;
      updateStickVisual();
    }

    function updateMoveState(event) {
      const offsetX = clamp(event.clientX - state.anchorClientX, -HORIZONTAL_SWAY, HORIZONTAL_SWAY);
      const offsetY = clamp(event.clientY - state.anchorClientY, -MAX_RADIUS, MAX_RADIUS);
      const normalizedY = clamp(offsetY / MAX_RADIUS, -1, 1);
      state.knobX = offsetX;
      state.knobY = offsetY;
      state.moveAxis = Math.abs(normalizedY) < DEAD_ZONE ? 0 : normalizedY;
      updateStickVisual();
    }

    function beginMove(event) {
      const rect = touchMoveZone.getBoundingClientRect();
      const insetX = Math.min(68, rect.width / 2);
      const insetY = Math.min(68, rect.height / 2);
      state.movePointerId = event.pointerId;
      state.moveEngaged = true;
      state.originX = clamp(event.clientX - rect.left, insetX, rect.width - insetX);
      state.originY = clamp(event.clientY - rect.top, insetY, rect.height - insetY);
      state.anchorClientX = event.clientX;
      state.anchorClientY = event.clientY;
      state.knobX = 0;
      state.knobY = 0;
      state.moveAxis = 0;
      updateMoveState(event);
      if (typeof touchMoveZone.setPointerCapture === 'function') {
        touchMoveZone.setPointerCapture(event.pointerId);
      }
    }

    function shouldShow() {
      const helpOpen = runtime.ui.help && !runtime.ui.help.classList.contains('hidden');
      const settingsOpen = runtime.ui.settings && !runtime.ui.settings.classList.contains('hidden');
      return !runtime.state.menuOpen && !runtime.state.paused && !runtime.state.gameOver && !runtime.state.demoMode && !helpOpen && !settingsOpen;
    }

    function sync() {
      const nextVisible = shouldShow();
      if (nextVisible === state.visible) return;
      state.visible = nextVisible;
      touchControlsRoot.classList.toggle('enabled', nextVisible);
      if (!nextVisible) {
        resetMoveState();
        firePointers.clear();
        state.fireQueued = false;
      }
    }

    function shouldCaptureTapFire(event) {
      if (!state.visible) return false;
      if (!event || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return false;
      if (runtime.state.countdownActive) return false;
      if (touchMoveZone.contains(event.target)) return false;
      if (typeof runtime.isPauseButtonPointerEvent === 'function' && runtime.isPauseButtonPointerEvent(event)) return false;
      return true;
    }

    // A touch that lands while the paddle is already being steered (joystick
    // engaged, or another play-area finger already down) is a deliberate second
    // touch and fires at once. The very first steering touch does not.
    function isSteeringActive() {
      return state.moveEngaged || firePointers.size > 0;
    }

    function onFirePointerDown(event) {
      if (!shouldCaptureTapFire(event)) return;
      event.preventDefault();
      const fireNow = isSteeringActive();
      firePointers.set(event.pointerId, {
        startX: event.clientX,
        startY: event.clientY,
        startMs: touchNowMs(),
        moved: false,
        fired: fireNow
      });
      if (fireNow) state.fireQueued = true;
    }

    function onFirePointerMove(event) {
      const tracked = firePointers.get(event.pointerId);
      if (!tracked) return;
      if (Math.abs(event.clientX - tracked.startX) > TAP_MOVE_PX ||
          Math.abs(event.clientY - tracked.startY) > TAP_MOVE_PX) {
        tracked.moved = true;
      }
    }

    function onFirePointerUp(event) {
      const tracked = firePointers.get(event.pointerId);
      if (!tracked) return;
      firePointers.delete(event.pointerId);
      if (event.type === 'pointercancel') return;
      // A quick, near-stationary tap-and-release fires. A held or dragged touch
      // (steering) does not, and a touch that already fired as a second touch
      // does not fire again on release.
      if (!tracked.fired && !tracked.moved && (touchNowMs() - tracked.startMs) <= TAP_MAX_MS) {
        state.fireQueued = true;
      }
    }

    function bind() {
      if (!syncHandle && window.requestAnimationFrame) {
        const syncLoop = () => {
          sync();
          syncHandle = window.requestAnimationFrame(syncLoop);
        };
        syncHandle = window.requestAnimationFrame(syncLoop);
      }
      touchMoveZone.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        event.preventDefault();
        beginMove(event);
      });
      touchMoveZone.addEventListener('pointermove', (event) => {
        if (event.pointerId !== state.movePointerId) return;
        event.preventDefault();
        updateMoveState(event);
      });
      const releaseMove = (event) => {
        if (event.pointerId !== state.movePointerId) return;
        event.preventDefault();
        resetMoveState();
      };
      touchMoveZone.addEventListener('pointerup', releaseMove);
      touchMoveZone.addEventListener('pointercancel', releaseMove);
      document.addEventListener('pointerdown', onFirePointerDown, { passive: false });
      document.addEventListener('pointermove', onFirePointerMove, { passive: true });
      document.addEventListener('pointerup', onFirePointerUp, { passive: true });
      document.addEventListener('pointercancel', onFirePointerUp, { passive: true });

      updateStickVisual();
      sync();
    }

    return {
      bind,
      sync,
      decorateAction(defaultAction) {
        return this.getAction(defaultAction);
      },
      getAction(defaultAction) {
        sync();
        if (!state.visible) return defaultAction;
        const fire = state.fireQueued;
        state.fireQueued = false;
        return {
          moveAxis: state.moveEngaged ? state.moveAxis : defaultAction.moveAxis,
          fire: defaultAction.fire || fire
        };
      }
    };
  }

  const touchController = createTouchController();
  const onlineService = multiplayer && onlineApi && typeof onlineApi.createOnlineService === 'function'
    ? onlineApi.createOnlineService({
        runtime,
        window,
        decorateLocalAction(defaultAction) {
          return touchController.decorateAction(defaultAction);
        }
      })
    : null;

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  async function toggleFullscreen() {
    const root = document.documentElement;
    if (!root) return;
    try {
      if (getFullscreenElement()) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      } else if (root.requestFullscreen) {
        await root.requestFullscreen();
      } else if (root.webkitRequestFullscreen) {
        root.webkitRequestFullscreen();
      }
    } catch (error) {
      reportOnlineError(error);
    }
    syncFullscreenButtons();
  }

  function syncFullscreenButtons() {
    const label = getFullscreenElement() ? 'Exit Fullscreen' : 'Fullscreen';
    [fullscreenBtn, pauseFullscreenBtn].forEach((button) => {
      if (!button) return;
      // Runs every animation frame; skip the DOM write unless the label changed.
      if (button.textContent !== label) button.textContent = label;
    });
  }

  function reportOnlineError(error) {
    if (!onlineStatusText) return;
    onlineStatusText.textContent = error && error.message ? error.message : String(error || 'Online action failed.');
  }

  function findBotById(botId) {
    return botRoster.find((bot) => bot.id === botId) || null;
  }

  function normalizeDifficultyKey(value) {
    const difficulty = String(value || '').toLowerCase();
    if (difficulty === 'ridiculous' || difficulty === 'absurd') return 'absurd';
    if (difficulty === 'chill' || difficulty === 'spicy') return difficulty;
    return 'spicy';
  }

  function formatDifficultyLabel(value) {
    const difficulty = normalizeDifficultyKey(value);
    const match = CLASSIC_DIFFICULTIES.find((entry) => entry.key === difficulty);
    return match ? match.label : 'Spicy';
  }

  function currentOpponentOption() {
    const select = runtime.ui.difficultySelect;
    return select && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
  }

  function currentSelectedBotId() {
    const option = currentOpponentOption();
    return option && option.dataset ? option.dataset.botId || '' : '';
  }

  function currentSelectedDifficulty() {
    const option = currentOpponentOption();
    return normalizeDifficultyKey(option && option.dataset ? option.dataset.difficulty : config.defaults.difficulty);
  }

  function formatBotOptionLabel(bot) {
    const elo = Number.isFinite(Number(bot.elo)) ? `Elo ${Math.round(bot.elo)}` : 'Elo ?';
    return `${bot.name} | ${formatDifficultyLabel(bot.difficultyBand)} | ${elo}`;
  }

  function currentSelectedBot() {
    const botId = currentSelectedBotId();
    return botId ? findBotById(botId) : null;
  }

  function syncBotInfoButtons() {
    const hasBot = !!currentSelectedBot();
    [menuBotInfoBtn, pauseBotInfoBtn].forEach((button) => {
      if (!button) return;
      button.disabled = !hasBot;
      if (hasBot) {
        button.removeAttribute('title');
      } else {
        button.title = 'Select an ML bot to inspect its details.';
      }
    });
  }

  function renderBotMetadata(bot) {
    if (!bot) {
      if (botInfoTitle) botInfoTitle.textContent = 'No ML bot selected';
      if (botInfoSubtitle) botInfoSubtitle.textContent = 'Choose a machine learning bot from CPU Opponent to inspect its metadata.';
      if (botInfoGrid) botInfoGrid.innerHTML = '';
      if (botInfoNotes) botInfoNotes.textContent = 'Classic Chill, Spicy, and Ridiculous still use the scripted CPU and do not have bot dossiers.';
      return;
    }

    const metadata = bot.metadata || {};
    const runtimeValidation = bot.runtimeValidation || {};
    const trainingHours = Number(bot.trainingHours != null ? bot.trainingHours : metadata.trainingHours);
    const formattedTrainingHours = Number.isFinite(trainingHours)
      ? `${trainingHours.toFixed(trainingHours >= 10 ? 1 : 3)}h`
      : 'n/a';
    const rows = [
      ['ID', bot.id],
      ['Name', bot.name],
      ['Difficulty band', formatDifficultyLabel(bot.difficultyBand)],
      ['Role', metadata.roleName || 'n/a'],
      ['Elo', bot.elo],
      ['Archetype', bot.archetype || 'n/a'],
      ['Personality', bot.personality || 'n/a'],
      ['Lineage', bot.lineageId || 'n/a'],
      ['Generation', bot.generation != null ? bot.generation : 'n/a'],
      ['Training hours', formattedTrainingHours],
      ['Published source', metadata.source || 'n/a'],
      ['Style tags', Array.isArray(metadata.styleTags) && metadata.styleTags.length ? metadata.styleTags.join(', ') : 'n/a'],
      ['Review state', metadata.reviewState || (bot.reviewBlocked ? 'blocked' : 'active')],
      ['Runtime moved ticks', runtimeValidation.totalMovedTicks != null ? runtimeValidation.totalMovedTicks : 'n/a'],
      ['Runtime total goals', runtimeValidation.totalGoals != null ? runtimeValidation.totalGoals : 'n/a']
    ];

    if (botInfoTitle) botInfoTitle.textContent = bot.name;
    if (botInfoSubtitle) botInfoSubtitle.textContent = `${bot.id} | ${formatDifficultyLabel(bot.difficultyBand)} | Elo ${Math.round(Number(bot.elo) || 0)}`;
    if (botInfoGrid) {
      botInfoGrid.innerHTML = rows.map(([label, value]) => (
        `<div class="botInfoRow"><div class="botInfoLabel">${label}</div><div class="botInfoValue">${value}</div></div>`
      )).join('');
    }
    if (botInfoNotes) {
      botInfoNotes.textContent = metadata.designIntent || bot.notes || bot.personality || 'No additional notes for this bot yet.';
    }
  }

  function openBotInfo() {
    if (!botInfoOverlay) return;
    renderBotMetadata(currentSelectedBot());
    botInfoOverlay.classList.remove('hidden');
  }

  function closeBotInfo() {
    if (!botInfoOverlay) return;
    botInfoOverlay.classList.add('hidden');
  }

  function populateBotSelect() {
    const select = runtime.ui.difficultySelect;
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = '';

    const classicGroup = document.createElement('optgroup');
    classicGroup.label = 'Classic CPU';
    for (const difficulty of CLASSIC_DIFFICULTIES) {
      const option = document.createElement('option');
      option.value = `classic:${difficulty.key}`;
      option.textContent = difficulty.label;
      option.dataset.controllerKind = 'scripted';
      option.dataset.difficulty = difficulty.key;
      option.dataset.summary = difficulty.label;
      classicGroup.appendChild(option);
    }
    select.appendChild(classicGroup);

    const sortedRoster = botRoster
      .filter((bot) => !bot.reviewBlocked && !bot.runtimeDisabled)
      .slice()
      .sort((left, right) => {
        const bandDelta = (DIFFICULTY_ORDER[normalizeDifficultyKey(left.difficultyBand)] ?? 99) - (DIFFICULTY_ORDER[normalizeDifficultyKey(right.difficultyBand)] ?? 99);
        if (bandDelta !== 0) return bandDelta;
        return (Number(right.elo) || 0) - (Number(left.elo) || 0);
      });

    if (sortedRoster.length) {
      const botGroup = document.createElement('optgroup');
      botGroup.label = 'ML Bots';
      for (const bot of sortedRoster) {
        const option = document.createElement('option');
        option.value = `bot:${bot.id}`;
        option.textContent = formatBotOptionLabel(bot);
        option.dataset.controllerKind = 'bot';
        option.dataset.botId = bot.id;
        option.dataset.difficulty = normalizeDifficultyKey(bot.difficultyBand);
        option.dataset.summary = bot.name;
        botGroup.appendChild(option);
      }
      select.appendChild(botGroup);
    }

    const defaultValue = `classic:${normalizeDifficultyKey(config.defaults.difficulty)}`;
    const hasPreviousValue = Array.from(select.options).some((option) => option.value === previousValue);
    const preferredValue = hasPreviousValue ? previousValue : defaultValue;
    select.value = preferredValue;
    if (select.value !== preferredValue && select.options.length) {
      select.value = select.options[0].value;
    }
    syncBotInfoButtons();
  }

  function buildCpuController() {
    const bot = currentSelectedBot();
    if (bot) return controllers.createNeuralController(bot);
    return controllers.createScriptedController({ difficulty: currentSelectedDifficulty() });
  }

  function syncControllers() {
    const mode = runtime.ui.modeSelect ? runtime.ui.modeSelect.value : config.defaults.mode;
    syncBotInfoButtons();
    // Only classic single-player runs a CPU controller. Online matches are
    // human-vs-human: leaving a CPU in a slot would silently consume that
    // side's input during networked play.
    if (mode !== 'cpu') {
      runtime.setControllers({ left: null, right: null });
      return;
    }
    runtime.setControllers({
      left: null,
      right: buildCpuController()
    });
  }

  const SETTINGS_KEY = 'gameWavePongSettingsV1';

  function saveMenuSettings() {
    try {
      const ui = runtime.ui;
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        mode: ui.modeSelect ? ui.modeSelect.value : undefined,
        opponent: ui.difficultySelect ? ui.difficultySelect.value : undefined,
        scoreLimit: ui.scoreLimitSelect ? ui.scoreLimitSelect.value : undefined,
        theme: ui.themeSelect ? ui.themeSelect.value : undefined,
        powerups: ui.powerupsToggle ? ui.powerupsToggle.checked : undefined,
        trails: ui.trailToggle ? ui.trailToggle.checked : undefined,
        controlScheme: currentControlScheme()
      }));
    } catch (err) {
      // Storage unavailable (private mode / blocked iframe); settings just won't persist.
    }
  }

  function applySavedMenuSettings() {
    const ui = runtime.ui;
    let saved = null;
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch (err) {
      saved = null;
    }
    if (!saved) {
      // First session: start against the gentlest CPU so the wave system can be
      // learned before the harder opponents and the full score-limit grind.
      const hasChill = ui.difficultySelect && Array.from(ui.difficultySelect.options).some((o) => o.value === 'classic:chill');
      if (hasChill) ui.difficultySelect.value = 'classic:chill';
      if (ui.scoreLimitSelect) ui.scoreLimitSelect.value = 5;
      return;
    }
    const setSelectValue = (el, value) => {
      if (!el || value == null) return;
      const hasOption = Array.from(el.options || []).some((o) => o.value === String(value));
      if (hasOption) el.value = String(value);
    };
    if (ui.modeSelect && saved.mode) setSelectValue(ui.modeSelect, saved.mode);
    setSelectValue(ui.difficultySelect, saved.opponent);
    if (ui.scoreLimitSelect && saved.scoreLimit != null) ui.scoreLimitSelect.value = saved.scoreLimit;
    if (ui.themeSelect && saved.theme) {
      setSelectValue(ui.themeSelect, saved.theme);
      ui.themeSelect.dispatchEvent(new Event('change'));
    }
    if (ui.powerupsToggle && typeof saved.powerups === 'boolean') ui.powerupsToggle.checked = saved.powerups;
    if (ui.trailToggle && typeof saved.trails === 'boolean') ui.trailToggle.checked = saved.trails;
    if (saved.controlScheme) {
      const target = controlSchemeRadios().find((radio) => radio.value === saved.controlScheme);
      if (target) target.checked = true;
    }
  }

  const GUEST_NAME_KEY = 'wavePongGuestNameV1';
  // Kept short so adjective + noun + a 3-digit number always fits the 20-char input cap.
  const GUEST_NAME_ADJECTIVES = [
    'Swift', 'Turbo', 'Neon', 'Cosmic', 'Rapid', 'Blazing', 'Mighty', 'Sneaky',
    'Wavy', 'Radical', 'Zippy', 'Jolly', 'Vivid', 'Frosty', 'Nimble', 'Lunar',
    'Solar', 'Groovy', 'Spicy', 'Bouncy', 'Gnarly', 'Rowdy', 'Bold', 'Wild',
    'Epic', 'Funky', 'Quick', 'Snappy', 'Plucky', 'Electric'
  ];
  const GUEST_NAME_NOUNS = [
    'Paddle', 'Comet', 'Falcon', 'Tiger', 'Volt', 'Rocket', 'Pixel', 'Yeti',
    'Phoenix', 'Otter', 'Hawk', 'Ninja', 'Wizard', 'Rogue', 'Panda', 'Shark',
    'Wave', 'Bolt', 'Dragon', 'Viper', 'Raptor', 'Nova', 'Blitz', 'Puma',
    'Lynx', 'Cobra', 'Gecko', 'Mantis', 'Orbit', 'Legend'
  ];

  function randomFrom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function generateGuestName() {
    const number = Math.floor(100 + Math.random() * 900); // always three digits
    return `${randomFrom(GUEST_NAME_ADJECTIVES)}${randomFrom(GUEST_NAME_NOUNS)}${number}`;
  }

  function storeGuestName(name) {
    try {
      if (name && name.trim()) window.localStorage.setItem(GUEST_NAME_KEY, name.trim());
    } catch (err) {
      // Storage unavailable (private mode / blocked iframe); the name just won't persist.
    }
  }

  function loadStoredGuestName() {
    try {
      const stored = window.localStorage.getItem(GUEST_NAME_KEY);
      return stored && stored.trim() ? stored.trim() : null;
    } catch (err) {
      return null;
    }
  }

  function setGuestName(name, persist) {
    if (!onlineNameInput) return;
    onlineNameInput.value = name;
    if (persist !== false) storeGuestName(name);
  }

  // Give returning players a stable random identity, but generate a fresh one the first time.
  function ensureGuestName() {
    const stored = loadStoredGuestName();
    if (stored) {
      setGuestName(stored, false);
    } else {
      setGuestName(generateGuestName(), true);
    }
  }

  function renderOnlineState(nextState) {
    const state = nextState || (onlineService ? onlineService.getState() : {
      enabled: !!env.enabled,
      statusText: env.enabled ? 'Ready.' : 'Online play is not configured for this build.',
      session: null,
      queue: null,
      currentMatch: null
    });
    if (onlineEnabledPill) {
      onlineEnabledPill.textContent = state.enabled ? (state.controlConnected ? 'Live' : 'Ready') : 'Offline';
      onlineEnabledPill.classList.toggle('live', !!state.controlConnected);
    }
    if (onlineStatusText) onlineStatusText.textContent = state.statusText;
    const searching = !!(state.queue && state.queue.queued);
    if (onlineQueueBtn) {
      onlineQueueBtn.disabled = !state.enabled || searching || !!state.currentMatch;
      onlineQueueBtn.textContent = searching ? 'Searching...' : 'Find Match';
    }
    if (onlineLeaveQueueBtn) onlineLeaveQueueBtn.classList.toggle('hidden', !searching);
    if (onlineNameInput && state.session && state.session.player && !onlineNameInput.value) {
      onlineNameInput.value = state.session.player.displayName;
    }
  }

  const menuOverlay = document.getElementById('menuOverlay');

  function applyModeVisibility() {
    if (!menuOverlay) return;
    const mode = runtime.ui.modeSelect ? runtime.ui.modeSelect.value : config.defaults.mode;
    menuOverlay.querySelectorAll('.modeField').forEach((el) => {
      const modes = (el.getAttribute('data-modes') || '').split(/\s+/).filter(Boolean);
      const show = modes.length === 0 || modes.includes(mode);
      el.classList.toggle('modeHidden', !show);
    });
  }

  // Driven explicitly (rather than a CSS :checked selector) so the highlight also
  // updates when settings are restored programmatically, which sets .checked
  // directly and doesn't dispatch a change event. Covers every segmented control,
  // whether in the main menu (game mode) or the settings screen (wave control).
  function syncModeSegmentStyle() {
    document.querySelectorAll('.segment').forEach((segment) => {
      const input = segment.querySelector('input[type="radio"]');
      segment.classList.toggle('segmentActive', !!(input && input.checked));
    });
  }

  function controlSchemeRadios() {
    return Array.from(document.querySelectorAll('input[name="controlScheme"]'));
  }

  function currentControlScheme() {
    const checked = controlSchemeRadios().find((radio) => radio.checked);
    return checked ? checked.value : ((config.defaults && config.defaults.controlScheme) || 'hold');
  }

  function applyControlScheme() {
    if (typeof runtime.setControlScheme === 'function') runtime.setControlScheme(currentControlScheme());
  }

  ['change', 'input'].forEach((eventName) => {
    if (runtime.ui.modeSelect) runtime.ui.modeSelect.addEventListener(eventName, syncControllers);
    if (runtime.ui.modeSelect) runtime.ui.modeSelect.addEventListener(eventName, applyModeVisibility);
    if (runtime.ui.modeSelect) runtime.ui.modeSelect.addEventListener(eventName, syncModeSegmentStyle);
    if (runtime.ui.difficultySelect) runtime.ui.difficultySelect.addEventListener(eventName, syncControllers);
    controlSchemeRadios().forEach((radio) => {
      radio.addEventListener(eventName, applyControlScheme);
      radio.addEventListener(eventName, syncModeSegmentStyle);
      radio.addEventListener(eventName, saveMenuSettings);
    });
    [
      runtime.ui.modeSelect,
      runtime.ui.difficultySelect,
      runtime.ui.scoreLimitSelect,
      runtime.ui.themeSelect,
      runtime.ui.powerupsToggle,
      runtime.ui.trailToggle
    ].forEach((el) => {
      if (el) el.addEventListener(eventName, saveMenuSettings);
    });
  });

  if (runtime.ui.difficultySelect) {
    ['change', 'input'].forEach((eventName) => {
      runtime.ui.difficultySelect.addEventListener(eventName, () => {
        if (botInfoOverlay && !botInfoOverlay.classList.contains('hidden')) {
          renderBotMetadata(currentSelectedBot());
        }
      });
    });
  }

  if (menuBotInfoBtn) menuBotInfoBtn.addEventListener('click', openBotInfo);
  if (pauseBotInfoBtn) pauseBotInfoBtn.addEventListener('click', openBotInfo);
  if (closeBotInfoBtn) closeBotInfoBtn.addEventListener('click', closeBotInfo);
  if (onlineNameRerollBtn) onlineNameRerollBtn.addEventListener('click', () => setGuestName(generateGuestName(), true));
  if (onlineNameInput) onlineNameInput.addEventListener('change', () => storeGuestName(onlineNameInput.value));
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);
  if (pauseFullscreenBtn) pauseFullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreenButtons);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButtons);
  if (botInfoOverlay) {
    botInfoOverlay.addEventListener('click', (event) => {
      if (event.target === botInfoOverlay) closeBotInfo();
    });
  }

  const offlineInputProvider = ({ side, defaultAction }) => (
    side === 'left' ? touchController.getAction(defaultAction) : defaultAction
  );

  const rematchBtn = document.getElementById('rematchBtn');
  // True between an online match ending and the next match starting; the
  // game-over Rematch button becomes "Find New Opponent" during that window.
  let postOnlineMatch = false;

  function setRematchButtonMode(online) {
    postOnlineMatch = online;
    if (rematchBtn) rematchBtn.textContent = online ? 'Find New Opponent' : 'Rematch';
  }

  if (onlineService) {
    onlineService.on('state', renderOnlineState);
    onlineService.on('match.started', () => {
      setRematchButtonMode(false);
    });
    onlineService.on('match.result', () => {
      // Hand input control back to the offline provider once the match is over.
      runtime.setInputProvider(offlineInputProvider);
      if (typeof runtime.setLocalHumanSide === 'function') runtime.setLocalHumanSide(null);
      // Restore the menu-selected controllers for whatever is played next.
      syncControllers();
      setRematchButtonMode(true);
    });

    if (typeof runtime.setRematchHandler === 'function') {
      runtime.setRematchHandler(() => {
        if (!postOnlineMatch) return false;
        setRematchButtonMode(false);
        runtime.backToMenu();
        onlineService.joinQueue({
          displayName: onlineNameInput ? onlineNameInput.value : ''
        }).catch(reportOnlineError);
        return true;
      });
    }

    if (onlineQueueBtn) {
      onlineQueueBtn.addEventListener('click', async () => {
        try {
          await onlineService.joinQueue({
            displayName: onlineNameInput ? onlineNameInput.value : ''
          });
        } catch (error) {
          reportOnlineError(error);
        }
      });
    }

    if (onlineLeaveQueueBtn) {
      onlineLeaveQueueBtn.addEventListener('click', async () => {
        try {
          await onlineService.leaveQueue();
        } catch (error) {
          reportOnlineError(error);
        }
      });
    }

    ['startBtn', 'demoBtn'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.addEventListener('click', () => setRematchButtonMode(false));
    });

    renderOnlineState(null);
  } else {
    [onlineQueueBtn, onlineLeaveQueueBtn].forEach((button) => {
      if (button) button.disabled = true;
    });
  }

  populateBotSelect();
  applySavedMenuSettings();
  applyModeVisibility();
  syncModeSegmentStyle();
  applyControlScheme();
  ensureGuestName();
  syncControllers();
  touchController.bind();
  runtime.setInputProvider(offlineInputProvider);
  runtime.mountBrowser();
  if (window.requestAnimationFrame) {
    const syncUiLoop = () => {
      syncFullscreenButtons();
      window.requestAnimationFrame(syncUiLoop);
    };
    window.requestAnimationFrame(syncUiLoop);
  }
  renderOnlineState();

  ns.RUNTIME = runtime;
})();
