(() => {
  const ns = window.WavePong || {};
  const simCore = ns.SimCore;
  const controllers = ns.Controllers;
  const config = ns.CONFIG;
  const runtimeVersion = ns.VERSION;
  const botRoster = Array.isArray(ns.BOT_ROSTER) ? ns.BOT_ROSTER : [];

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
    return `${bot.name} | ${elo}`;
  }

  function currentSelectedBot() {
    const botId = runtime.ui.difficultySelect ? runtime.ui.difficultySelect.value : '';
    return findBotById(botId) || controllers.selectBotForDifficulty(botRoster, config.defaults.difficulty) || null;
  }

  function syncTrainingContext() {
    if (typeof runtime.setTrainingContext !== 'function') return;
    const bot = currentSelectedBot();
    runtime.setTrainingContext(bot ? {
      selectedBotId: bot.id,
      selectedBotName: bot.name,
      selectedBotDifficultyBand: bot.difficultyBand || null,
      selectedBotElo: Number(bot.elo) || null
    } : null);
  }

  function renderBotMetadata(bot) {
    if (!bot) {
      if (botInfoTitle) botInfoTitle.textContent = 'No bot selected';
      if (botInfoSubtitle) botInfoSubtitle.textContent = 'Select a roster bot to inspect its metadata.';
      if (botInfoGrid) botInfoGrid.innerHTML = '';
      if (botInfoNotes) botInfoNotes.textContent = 'No bot is currently selected.';
      return;
    }

    const metadata = bot.metadata || {};
    const runtimeValidation = bot.runtimeValidation || {};
    const trainingHours = Number(bot.trainingHours != null ? bot.trainingHours : metadata.trainingHours);
    const formattedTrainingHours = Number.isFinite(trainingHours)
      ? `${trainingHours.toFixed(trainingHours >= 10 ? 1 : 3)}h`
      : 'n/a';
    const humanTrainingSummary = bot.humanTrainingSummary || metadata.humanTrainingSummary || null;
    const formattedHumanWinRate = humanTrainingSummary && Number.isFinite(Number(humanTrainingSummary.botWinRate))
      ? `${(Number(humanTrainingSummary.botWinRate) * 100).toFixed(1)}%`
      : 'n/a';
    const formattedHumanChallenge = humanTrainingSummary && Number.isFinite(Number(humanTrainingSummary.challengeScore))
      ? Number(humanTrainingSummary.challengeScore).toFixed(1)
      : 'n/a';
    const rows = [
      ['ID', bot.id],
      ['Name', bot.name],
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
      ['Runtime total goals', runtimeValidation.totalGoals != null ? runtimeValidation.totalGoals : 'n/a'],
      ['Human sessions', humanTrainingSummary && humanTrainingSummary.sessionCount != null ? humanTrainingSummary.sessionCount : 'n/a'],
      ['Human bot win rate', formattedHumanWinRate],
      ['Human challenge', formattedHumanChallenge]
    ];

    if (botInfoTitle) botInfoTitle.textContent = bot.name;
    if (botInfoSubtitle) botInfoSubtitle.textContent = `${bot.id} | ${bot.archetype || 'unknown archetype'} | Elo ${Math.round(Number(bot.elo) || 0)}`;
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

    const sortedRoster = botRoster
      .slice()
      .sort((left, right) => {
        const difficultyOrder = { chill: 0, spicy: 1, absurd: 2 };
        const bandDelta = (difficultyOrder[left.difficultyBand] ?? 99) - (difficultyOrder[right.difficultyBand] ?? 99);
        if (bandDelta !== 0) return bandDelta;
        return (Number(right.elo) || 0) - (Number(left.elo) || 0);
      });

    for (const bot of sortedRoster) {
      const option = document.createElement('option');
      option.value = bot.id;
      option.textContent = formatBotOptionLabel(bot);
      select.appendChild(option);
    }

    const defaultBot = findBotById(previousValue) || controllers.selectBotForDifficulty(botRoster, config.defaults.difficulty) || sortedRoster[0];
    if (defaultBot) {
      select.value = defaultBot.id;
    }
  }

  function buildCpuController(botId) {
    const bot = findBotById(botId) || controllers.selectBotForDifficulty(botRoster, config.defaults.difficulty);
    if (bot) return controllers.createNeuralController(bot);
    return controllers.createScriptedController({ difficulty: config.defaults.difficulty });
  }

  function syncControllers() {
    const mode = runtime.ui.modeSelect ? runtime.ui.modeSelect.value : config.defaults.mode;
    const botId = runtime.ui.difficultySelect ? runtime.ui.difficultySelect.value : '';
    syncTrainingContext();
    if (mode === 'pvp') {
      runtime.setControllers({ left: null, right: null });
      return;
    }
    runtime.setControllers({
      left: null,
      right: buildCpuController(botId)
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
  syncTrainingContext();
  syncControllers();
  runtime.mountBrowser();

  ns.RUNTIME = runtime;
})();
