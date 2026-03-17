(() => {
  const ns = window.WavePong || {};
  const simCore = ns.SimCore;
  const controllers = ns.Controllers;
  const config = ns.CONFIG;
  const runtimeVersion = ns.VERSION;
  const botRoster = Array.isArray(ns.BOT_ROSTER) ? ns.BOT_ROSTER : [];
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

  const botInfoOverlay = document.getElementById('botInfoOverlay');
  const botInfoTitle = document.getElementById('botInfoTitle');
  const botInfoSubtitle = document.getElementById('botInfoSubtitle');
  const botInfoGrid = document.getElementById('botInfoGrid');
  const botInfoNotes = document.getElementById('botInfoNotes');
  const menuBotInfoBtn = document.getElementById('menuBotInfoBtn');
  const pauseBotInfoBtn = document.getElementById('pauseBotInfoBtn');
  const closeBotInfoBtn = document.getElementById('closeBotInfoBtn');

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
  if (botInfoOverlay) {
    botInfoOverlay.addEventListener('click', (event) => {
      if (event.target === botInfoOverlay) closeBotInfo();
    });
  }

  populateBotSelect();
  syncControllers();
  runtime.mountBrowser();

  ns.RUNTIME = runtime;
})();
