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
  const onlinePlaylistSelect = document.getElementById('onlinePlaylistSelect');
  const onlineRegionSelect = document.getElementById('onlineRegionSelect');
  const onlineConnectBtn = document.getElementById('onlineConnectBtn');
  const onlineVerifyBtn = document.getElementById('onlineVerifyBtn');
  const onlineQueueBtn = document.getElementById('onlineQueueBtn');
  const onlineLeaveQueueBtn = document.getElementById('onlineLeaveQueueBtn');
  const onlineStatusText = document.getElementById('onlineStatusText');
  const onlineSessionState = document.getElementById('onlineSessionState');
  const onlineQueueState = document.getElementById('onlineQueueState');
  const onlineMatchState = document.getElementById('onlineMatchState');
  const onlineChatLog = document.getElementById('onlineChatLog');
  const onlineChatInput = document.getElementById('onlineChatInput');
  const onlineChatSendBtn = document.getElementById('onlineChatSendBtn');
  const quickChatRow = document.getElementById('quickChatRow');
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
      return !runtime.state.menuOpen && !runtime.state.paused && !runtime.state.gameOver && !runtime.state.demoMode && !helpOpen;
    }

    function sync() {
      const nextVisible = shouldShow();
      if (nextVisible === state.visible) return;
      state.visible = nextVisible;
      touchControlsRoot.classList.toggle('enabled', nextVisible);
      if (!nextVisible) {
        resetMoveState();
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
      document.addEventListener('pointerdown', (event) => {
        if (!shouldCaptureTapFire(event)) return;
        event.preventDefault();
        state.fireQueued = true;
      }, { passive: false });

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
      button.textContent = label;
    });
  }

  function reportOnlineError(error) {
    if (!onlineStatusText) return;
    onlineStatusText.textContent = error && error.message ? error.message : String(error || 'Online action failed.');
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
    if (mode === 'pvp') {
      runtime.setControllers({ left: null, right: null });
      return;
    }
    runtime.setControllers({
      left: null,
      right: buildCpuController()
    });
  }

  function populateOnlineSelectors() {
    if (!multiplayer) return;
    if (onlinePlaylistSelect) {
      onlinePlaylistSelect.innerHTML = multiplayer.listPlaylists()
        .map((playlist) => `<option value="${playlist.id}">${escapeHtml(playlist.label)}</option>`)
        .join('');
      const defaultPlaylist = multiplayer.getDefaultPlaylist();
      if (defaultPlaylist) onlinePlaylistSelect.value = defaultPlaylist.id;
    }
    if (onlineRegionSelect) {
      onlineRegionSelect.innerHTML = multiplayer.listRegions()
        .map((region) => `<option value="${region.id}">${escapeHtml(region.label)}</option>`)
        .join('');
      const defaultRegion = multiplayer.getDefaultRegion();
      if (defaultRegion) onlineRegionSelect.value = defaultRegion.id;
    }
    if (quickChatRow) {
      quickChatRow.innerHTML = '';
      for (const quickChat of multiplayer.quickChat || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = quickChat.label;
        button.addEventListener('click', () => {
          if (!onlineService) return;
          try {
            onlineService.sendMatchQuickChat(quickChat.id);
          } catch (error) {
            reportOnlineError(error);
          }
        });
        quickChatRow.appendChild(button);
      }
    }
  }

  function renderChatLog(target, entries) {
    if (!target) return;
    if (!entries || !entries.length) {
      target.innerHTML = '<div class="onlineChatEmpty">No messages yet. Queue into a region to populate the lobby feed.</div>';
      return;
    }
    target.innerHTML = entries.map((entry) => {
      const meta = entry.kind === 'quick' ? `quick chat` : (entry.verified ? 'verified' : 'guest');
      const body = entry.kind === 'quick' ? escapeHtml(entry.quickChatId || '') : escapeHtml(entry.text || '');
      return `<div class="onlineChatMessage"><span class="onlineChatMeta">${escapeHtml(entry.displayName || 'player')} · ${escapeHtml(meta)}</span>${body}</div>`;
    }).join('');
    target.scrollTop = target.scrollHeight;
  }

  function renderOnlineState(nextState) {
    const state = nextState || (onlineService ? onlineService.getState() : {
      enabled: !!env.enabled,
      statusText: env.enabled ? 'Online available.' : 'Online disabled. Add runtime env query params to connect.',
      session: null,
      queue: null,
      currentMatch: null,
      lobbyMessages: [],
      matchMessages: []
    });
    if (onlineEnabledPill) {
      onlineEnabledPill.textContent = state.enabled ? (state.controlConnected ? 'Live' : 'Ready') : 'Offline';
      onlineEnabledPill.classList.toggle('live', !!state.controlConnected);
    }
    if (onlineStatusText) onlineStatusText.textContent = state.statusText;
    if (onlineSessionState) {
      onlineSessionState.textContent = state.session && state.session.player
        ? `${state.session.player.displayName}${state.session.player.verified ? ' · verified' : ' · guest'}`
        : 'none';
    }
    if (onlineQueueState) {
      onlineQueueState.textContent = state.queue && state.queue.queued
        ? `${state.queue.playlistId} · ${state.queue.region}`
        : 'idle';
    }
    if (onlineMatchState) {
      onlineMatchState.textContent = state.currentMatch
        ? `${state.currentMatch.playlistId} · ${state.currentMatch.region}`
        : 'offline';
    }
    if (onlineNameInput && state.session && state.session.player && !onlineNameInput.value) {
      onlineNameInput.value = state.session.player.displayName;
    }
    renderChatLog(onlineChatLog, state.lobbyMessages);
  }

  ['change', 'input'].forEach((eventName) => {
    if (runtime.ui.modeSelect) runtime.ui.modeSelect.addEventListener(eventName, syncControllers);
    if (runtime.ui.difficultySelect) runtime.ui.difficultySelect.addEventListener(eventName, syncControllers);
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
  if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);
  if (pauseFullscreenBtn) pauseFullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreenButtons);
  document.addEventListener('webkitfullscreenchange', syncFullscreenButtons);
  if (botInfoOverlay) {
    botInfoOverlay.addEventListener('click', (event) => {
      if (event.target === botInfoOverlay) closeBotInfo();
    });
  }

  if (onlineService) {
    onlineService.on('state', renderOnlineState);

    if (onlineConnectBtn) {
      onlineConnectBtn.addEventListener('click', async () => {
        try {
          await onlineService.ensureConnected(onlineNameInput ? onlineNameInput.value : '');
        } catch (error) {
          reportOnlineError(error);
        }
      });
    }

    if (onlineVerifyBtn) {
      onlineVerifyBtn.addEventListener('click', async () => {
        try {
          await onlineService.upgradeAccount(onlineNameInput ? onlineNameInput.value : '');
        } catch (error) {
          reportOnlineError(error);
        }
      });
    }

    if (onlineQueueBtn) {
      onlineQueueBtn.addEventListener('click', async () => {
        try {
          await onlineService.joinQueue({
            displayName: onlineNameInput ? onlineNameInput.value : '',
            playlistId: onlinePlaylistSelect ? onlinePlaylistSelect.value : 'unranked_standard',
            region: onlineRegionSelect ? onlineRegionSelect.value : 'na'
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

    if (onlineChatSendBtn) {
      onlineChatSendBtn.addEventListener('click', () => {
        if (!onlineChatInput || !onlineChatInput.value.trim()) return;
        try {
          onlineService.sendLobbyChat({
            playlistId: onlinePlaylistSelect ? onlinePlaylistSelect.value : 'unranked_standard',
            region: onlineRegionSelect ? onlineRegionSelect.value : 'na',
            message: {
              kind: 'free',
              text: onlineChatInput.value.trim()
            }
          });
          onlineChatInput.value = '';
        } catch (error) {
          reportOnlineError(error);
        }
      });
    }
  } else {
    [onlineConnectBtn, onlineVerifyBtn, onlineQueueBtn, onlineLeaveQueueBtn, onlineChatSendBtn].forEach((button) => {
      if (button) button.disabled = true;
    });
  }

  populateBotSelect();
  populateOnlineSelectors();
  syncControllers();
  touchController.bind();
  runtime.setInputProvider(({ side, defaultAction }) => (
    side === 'left' ? touchController.getAction(defaultAction) : defaultAction
  ));
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
