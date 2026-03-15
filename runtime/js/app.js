(() => {
  const ns = window.WavePong || {};
  const simCore = ns.SimCore;
  const controllers = ns.Controllers;
  const config = ns.CONFIG;
  const humanTraining = ns.HumanTraining;
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
  const trainingRepoStatus = runtime.ui.trainingRepoStatus;
  const connectRepoTrainingBtn = runtime.ui.connectRepoTrainingBtn;
  const disconnectRepoTrainingBtn = runtime.ui.disconnectRepoTrainingBtn;
  const repoTrainingConfig = config.training && config.training.localRepo ? config.training.localRepo : {};
  const repoTrainingFiles = repoTrainingConfig.files || {};
  const repoTrainingMarkers = repoTrainingConfig.repoMarkers || {};
  const repoTrainingDbConfig = repoTrainingConfig.permissionsDb || {};
  const localRepoTraining = {
    enabled: !!repoTrainingConfig.enabled,
    supported: !!(humanTraining && typeof window.showDirectoryPicker === 'function' && window.indexedDB),
    handle: null,
    syncInFlight: false,
    pendingReason: null,
    status: '',
    repoCandidate: /(^|\/)runtime\/(index|wave_pong)\.html$/i.test(String(window.location.pathname || ''))
  };

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function uniqueStrings(values) {
    return Array.from(new Set((values || []).filter((value) => typeof value === 'string' && value.trim())));
  }

  function buildBotRosterScript(bots) {
    const payload = JSON.stringify(bots, null, 2);
    return `(function (root) {\n  const bots = ${payload};\n  if (typeof module === 'object' && module.exports) {\n    module.exports = bots;\n  }\n  if (root) {\n    root.WavePong = root.WavePong || {};\n    root.WavePong.BOT_ROSTER = bots;\n  }\n})(typeof globalThis !== 'undefined' ? globalThis : this);\n`;
  }

  function splitRelativePath(value) {
    return String(value || '').split(/[\\/]+/).filter(Boolean);
  }

  function buildDefaultRepoTrainingStatus() {
    if (!localRepoTraining.enabled) return 'Local repo auto-train is disabled in this build.';
    if (!humanTraining) return 'Local repo auto-train is unavailable because the browser training module did not load.';
    if (!localRepoTraining.supported) return 'Local repo auto-train needs Chromium file access support to write into the repo.';
    if (localRepoTraining.handle) return 'Repo connected. New Player vs CPU matches will auto-write training updates to disk.';
    if (localRepoTraining.repoCandidate) return 'Connect the repo root once to auto-write training data and updated bots to disk.';
    return 'Connect a checked-out repo root to auto-write training data and updated bots to disk.';
  }

  function setRepoTrainingStatus(message) {
    localRepoTraining.status = message || '';
    updateRepoTrainingUi();
  }

  function updateRepoTrainingUi() {
    if (trainingRepoStatus) {
      trainingRepoStatus.textContent = localRepoTraining.status || buildDefaultRepoTrainingStatus();
    }
    if (connectRepoTrainingBtn) {
      connectRepoTrainingBtn.classList.toggle('hidden', !localRepoTraining.enabled || !localRepoTraining.supported);
      connectRepoTrainingBtn.disabled = localRepoTraining.syncInFlight;
      connectRepoTrainingBtn.textContent = localRepoTraining.handle ? 'Reconnect repo auto-train' : 'Connect repo auto-train';
    }
    if (disconnectRepoTrainingBtn) {
      disconnectRepoTrainingBtn.classList.toggle('hidden', !localRepoTraining.handle);
      disconnectRepoTrainingBtn.disabled = localRepoTraining.syncInFlight;
    }
  }

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

  function refreshVisibleBotMetadata() {
    if (botInfoOverlay && !botInfoOverlay.classList.contains('hidden')) {
      renderBotMetadata(currentSelectedBot());
    }
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

  function openRepoPermissionDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is unavailable for storing repo access.'));
        return;
      }
      const request = window.indexedDB.open(repoTrainingDbConfig.name || 'wavePongRepoTrainingV1', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const storeName = repoTrainingDbConfig.storeName || 'handles';
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Unable to open the repo permission database.'));
    });
  }

  async function loadStoredRepoHandle() {
    if (!localRepoTraining.supported) return null;
    const db = await openRepoPermissionDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(repoTrainingDbConfig.storeName || 'handles', 'readonly');
      const request = tx.objectStore(repoTrainingDbConfig.storeName || 'handles').get(repoTrainingDbConfig.handleKey || 'repoRoot');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Unable to read the saved repo access handle.'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error || new Error('Unable to read the saved repo access handle.'));
    });
  }

  async function saveStoredRepoHandle(handle) {
    if (!localRepoTraining.supported) return;
    const db = await openRepoPermissionDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(repoTrainingDbConfig.storeName || 'handles', 'readwrite');
      tx.objectStore(repoTrainingDbConfig.storeName || 'handles').put(handle, repoTrainingDbConfig.handleKey || 'repoRoot');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Unable to save the repo access handle.'));
    });
    db.close();
  }

  async function clearStoredRepoHandle() {
    if (!localRepoTraining.supported) return;
    const db = await openRepoPermissionDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(repoTrainingDbConfig.storeName || 'handles', 'readwrite');
      tx.objectStore(repoTrainingDbConfig.storeName || 'handles').delete(repoTrainingDbConfig.handleKey || 'repoRoot');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Unable to clear the saved repo access handle.'));
    });
    db.close();
  }

  async function ensureRepoWritePermission(handle, requestAccess) {
    if (!handle) return false;
    const options = { mode: 'readwrite' };
    if (typeof handle.queryPermission === 'function') {
      const current = await handle.queryPermission(options);
      if (current === 'granted') return true;
      if (!requestAccess) return false;
    }
    if (requestAccess && typeof handle.requestPermission === 'function') {
      return (await handle.requestPermission(options)) === 'granted';
    }
    return true;
  }

  async function getDirectoryHandleAtPath(rootHandle, relativePath, create) {
    let current = rootHandle;
    for (const segment of splitRelativePath(relativePath)) {
      current = await current.getDirectoryHandle(segment, create ? { create: true } : undefined);
    }
    return current;
  }

  async function getFileHandleAtPath(rootHandle, relativePath, create) {
    const segments = splitRelativePath(relativePath);
    const fileName = segments.pop();
    if (!fileName) throw new Error(`Missing file name for path: ${relativePath}`);
    let current = rootHandle;
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, create ? { create: true } : undefined);
    }
    return current.getFileHandle(fileName, create ? { create: true } : undefined);
  }

  async function pathExists(rootHandle, relativePath, expectedType) {
    try {
      if (expectedType === 'directory') await getDirectoryHandleAtPath(rootHandle, relativePath, false);
      else await getFileHandleAtPath(rootHandle, relativePath, false);
      return true;
    } catch (error) {
      if (error && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) return false;
      throw error;
    }
  }

  async function readJsonFile(rootHandle, relativePath) {
    try {
      const fileHandle = await getFileHandleAtPath(rootHandle, relativePath, false);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return text.trim() ? JSON.parse(text) : null;
    } catch (error) {
      if (error && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) return null;
      throw error;
    }
  }

  async function writeTextFile(rootHandle, relativePath, text) {
    const fileHandle = await getFileHandleAtPath(rootHandle, relativePath, true);
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function validateRepoHandle(handle) {
    if (!handle || handle.kind !== 'directory') {
      return { ok: false, message: 'Choose the Wave Pong repo root directory.' };
    }
    const gitMarker = repoTrainingMarkers.gitDir || '.git';
    const hasGitMarker = await pathExists(handle, gitMarker, 'directory') || await pathExists(handle, gitMarker, 'file');
    if (!hasGitMarker) {
      return { ok: false, message: 'That folder does not look like a git repo root yet.' };
    }
    const requiredChecks = [
      { path: repoTrainingMarkers.versionFile || 'version.json', type: 'file' },
      { path: repoTrainingMarkers.runtimeIndex || 'runtime/index.html', type: 'file' },
      { path: repoTrainingMarkers.rosterFile || 'runtime/js/bot-roster.js', type: 'file' },
      { path: repoTrainingMarkers.reportsDir || 'tools/reports', type: 'directory' }
    ];
    for (const check of requiredChecks) {
      if (!await pathExists(handle, check.path, check.type)) {
        return { ok: false, message: `Repo auto-train could not find ${check.path}. Pick the Wave Pong repo root.` };
      }
    }
    return { ok: true };
  }

  function applyHumanTrainingMetadata(bot, humanTrainingSummary, humanFineTuneSummary) {
    if (!bot) return;
    if (!bot.metadata || typeof bot.metadata !== 'object') bot.metadata = {};
    const metadata = bot.metadata;
    if (humanTrainingSummary) {
      const summary = clone(humanTrainingSummary);
      bot.humanTrainingSummary = summary;
      metadata.humanTrainingSummary = clone(summary);
      metadata.styleTags = uniqueStrings([
        ...(metadata.styleTags || []),
        'human-tested',
        Number(summary.challengeScore) >= 12 ? 'human-hardened' : ''
      ]);
    }
    if (humanFineTuneSummary) {
      const fineTuneSummary = clone(humanFineTuneSummary);
      bot.humanFineTuneSummary = fineTuneSummary;
      metadata.humanFineTuneSummary = clone(fineTuneSummary);
    }
  }

  async function performRepoTrainingSync(reason) {
    if (!localRepoTraining.handle) {
      setRepoTrainingStatus(buildDefaultRepoTrainingStatus());
      return false;
    }

    const hasPermission = await ensureRepoWritePermission(localRepoTraining.handle, reason === 'connect');
    if (!hasPermission) {
      setRepoTrainingStatus('Repo access is saved, but the browser still needs write permission. Click Connect repo auto-train.');
      return false;
    }

    const validation = await validateRepoHandle(localRepoTraining.handle);
    if (!validation.ok) {
      setRepoTrainingStatus(validation.message);
      return false;
    }

    const exportPayload = typeof runtime.buildTrainingExport === 'function' ? runtime.buildTrainingExport() : null;
    const incoming = humanTraining.normalizeExportPayload(exportPayload);
    if (!incoming.sessions.length) {
      setRepoTrainingStatus('Repo connected. Play a Player vs CPU match to write training data and updated bots to disk.');
      return false;
    }

    const existingDatasetRaw = await readJsonFile(localRepoTraining.handle, repoTrainingFiles.dataset || 'tools/reports/human-training-data.json');
    const existingDataset = humanTraining.normalizeDatasetPayload(existingDatasetRaw);
    const existingSessionIds = new Set(existingDataset.sessions.map((session) => session.sessionId));
    const newSessions = incoming.sessions.filter((session) => !existingSessionIds.has(session.sessionId));

    if (!newSessions.length) {
      setRepoTrainingStatus('Repo connected. The cached browser training sessions are already merged into the repo dataset.');
      return false;
    }

    setRepoTrainingStatus(`Writing ${newSessions.length} new training session${newSessions.length === 1 ? '' : 's'} into the repo...`);

    const merged = humanTraining.mergeSessions(existingDataset.sessions, incoming.sessions);
    const datasetBuild = humanTraining.buildImitationDatasetByBot(merged.sessions, {
      maxSamplesPerBot: Number(repoTrainingConfig.maxSamplesPerBot) || 4000
    });
    const summary = humanTraining.buildDatasetSummary(merged.sessions, datasetBuild.sampleCounts);
    const summariesByBot = humanTraining.summarizeSessionsByBot(merged.sessions, datasetBuild.sampleCounts);
    const touchedBotIds = new Set(newSessions.map((session) => session.bot && session.bot.id).filter(Boolean));
    const now = new Date().toISOString();
    const fineTuneResults = [];
    const unmatchedBotIds = [];

    for (const botId of touchedBotIds) {
      const samples = datasetBuild.byBot.get(botId) || [];
      if (!samples.length) continue;
      const bot = findBotById(botId);
      if (!bot) {
        unmatchedBotIds.push(botId);
        continue;
      }
      const fineTuneSummary = humanTraining.fineTuneBotWithSamples(bot, samples, {
        batchSize: Number(repoTrainingConfig.fineTune && repoTrainingConfig.fineTune.batchSize) || 64,
        epochs: Number(repoTrainingConfig.fineTune && repoTrainingConfig.fineTune.epochs) || 3,
        learningRate: Number(repoTrainingConfig.fineTune && repoTrainingConfig.fineTune.learningRate) || 0.01
      });
      const enrichedFineTuneSummary = {
        ...fineTuneSummary,
        source: 'browser-local-auto-train',
        updatedAt: now,
        newSessionCount: newSessions.filter((session) => session.bot.id === botId).length
      };
      applyHumanTrainingMetadata(bot, summariesByBot.get(botId) || null, enrichedFineTuneSummary);
      fineTuneResults.push({
        botId,
        botName: bot.name,
        ...enrichedFineTuneSummary
      });
    }

    for (const [botId, botSummary] of summariesByBot.entries()) {
      const bot = findBotById(botId);
      if (!bot) continue;
      applyHumanTrainingMetadata(bot, botSummary, bot.humanFineTuneSummary || null);
    }

    const datasetPayload = {
      schema: humanTraining.DATASET_SCHEMA,
      importedAt: now,
      sourceSchema: incoming.schema,
      sourceFile: 'browser-local-runtime',
      sessions: merged.sessions,
      summary
    };
    const reportPayload = {
      importedAt: now,
      inputFile: 'browser-local-runtime',
      outputFile: repoTrainingFiles.dataset || 'tools/reports/human-training-data.json',
      rosterFile: repoTrainingFiles.roster || 'runtime/js/bot-roster.js',
      incomingSessionCount: incoming.sessions.length,
      newSessionCount: newSessions.length,
      duplicateSessionCount: incoming.sessions.length - newSessions.length,
      totalSessionCount: merged.sessions.length,
      totalSampleCount: summary.totalSamples,
      byBot: summary.byBot,
      validations: datasetBuild.validations,
      fineTuneResults,
      unmatchedBotIds
    };

    await writeTextFile(localRepoTraining.handle, repoTrainingFiles.dataset || 'tools/reports/human-training-data.json', JSON.stringify(datasetPayload, null, 2));
    await writeTextFile(localRepoTraining.handle, repoTrainingFiles.report || 'tools/reports/human-training-import-report.json', JSON.stringify(reportPayload, null, 2));
    await writeTextFile(localRepoTraining.handle, repoTrainingFiles.roster || 'runtime/js/bot-roster.js', buildBotRosterScript(botRoster));

    refreshVisibleBotMetadata();
    syncTrainingContext();
    syncControllers();

    const trainedBotNames = fineTuneResults.map((entry) => entry.botName);
    if (trainedBotNames.length) {
      setRepoTrainingStatus(
        `Auto-trained ${trainedBotNames.join(', ')} from ${newSessions.length} new session${newSessions.length === 1 ? '' : 's'} and wrote the updated roster to disk.`
      );
    } else if (unmatchedBotIds.length) {
      setRepoTrainingStatus(
        `Saved ${newSessions.length} new training session${newSessions.length === 1 ? '' : 's'} to disk, but no matching loaded roster bot was found for ${unmatchedBotIds.join(', ')}.`
      );
    } else {
      setRepoTrainingStatus(
        `Saved ${newSessions.length} new training session${newSessions.length === 1 ? '' : 's'} to disk and refreshed the repo dataset.`
      );
    }

    return true;
  }

  async function queueRepoTrainingSync(reason) {
    if (!localRepoTraining.enabled || !localRepoTraining.supported) return false;
    if (localRepoTraining.syncInFlight) {
      localRepoTraining.pendingReason = reason;
      return false;
    }

    localRepoTraining.syncInFlight = true;
    updateRepoTrainingUi();

    try {
      return await performRepoTrainingSync(reason);
    } catch (error) {
      setRepoTrainingStatus(`Repo auto-train hit an error: ${error && error.message ? error.message : error}`);
      return false;
    } finally {
      localRepoTraining.syncInFlight = false;
      updateRepoTrainingUi();
      if (localRepoTraining.pendingReason) {
        const nextReason = localRepoTraining.pendingReason;
        localRepoTraining.pendingReason = null;
        window.setTimeout(() => {
          void queueRepoTrainingSync(nextReason);
        }, 0);
      }
    }
  }

  async function connectRepoAutoTraining() {
    try {
      if (!localRepoTraining.enabled) {
        setRepoTrainingStatus('Local repo auto-train is disabled in this build.');
        return false;
      }
      if (!localRepoTraining.supported) {
        setRepoTrainingStatus('Local repo auto-train needs Chromium file access support to write into the repo.');
        return false;
      }

      const handle = await window.showDirectoryPicker({
        id: 'wave-pong-repo',
        mode: 'readwrite'
      });
      const validation = await validateRepoHandle(handle);
      if (!validation.ok) {
        setRepoTrainingStatus(validation.message);
        return false;
      }
      const hasPermission = await ensureRepoWritePermission(handle, true);
      if (!hasPermission) {
        setRepoTrainingStatus('Repo access was selected, but the browser did not grant write permission.');
        return false;
      }

      localRepoTraining.handle = handle;
      await saveStoredRepoHandle(handle);
      setRepoTrainingStatus('Repo connected. Writing cached training sessions into the checkout...');
      updateRepoTrainingUi();
      return queueRepoTrainingSync('connect');
    } catch (error) {
      if (error && error.name === 'AbortError') {
        setRepoTrainingStatus('Repo auto-train connection was canceled. Browser capture will stay local until you reconnect.');
        return false;
      }
      throw error;
    }
  }

  async function disconnectRepoAutoTraining() {
    localRepoTraining.handle = null;
    await clearStoredRepoHandle();
    setRepoTrainingStatus('Disconnected repo auto-train. Browser capture will stay local until you reconnect the repo.');
    updateRepoTrainingUi();
  }

  async function initializeRepoAutoTraining() {
    updateRepoTrainingUi();
    if (!localRepoTraining.enabled || !localRepoTraining.supported) {
      setRepoTrainingStatus(buildDefaultRepoTrainingStatus());
      return;
    }
    try {
      const savedHandle = await loadStoredRepoHandle();
      if (!savedHandle) {
        setRepoTrainingStatus(buildDefaultRepoTrainingStatus());
        return;
      }
      const validation = await validateRepoHandle(savedHandle);
      if (!validation.ok) {
        await clearStoredRepoHandle();
        setRepoTrainingStatus('Saved repo access no longer points at the Wave Pong checkout. Connect the repo again.');
        return;
      }
      localRepoTraining.handle = savedHandle;
      const hasPermission = await ensureRepoWritePermission(savedHandle, false);
      if (!hasPermission) {
        setRepoTrainingStatus('Repo access is saved, but the browser needs permission again before it can write to disk.');
        updateRepoTrainingUi();
        return;
      }
      setRepoTrainingStatus('Repo connected. Cached Player vs CPU sessions will be written to disk automatically.');
      updateRepoTrainingUi();
      void queueRepoTrainingSync('startup');
    } catch (error) {
      setRepoTrainingStatus(`Repo auto-train could not restore saved access: ${error && error.message ? error.message : error}`);
    }
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
  if (connectRepoTrainingBtn) {
    connectRepoTrainingBtn.addEventListener('click', () => {
      void connectRepoAutoTraining();
    });
  }
  if (disconnectRepoTrainingBtn) {
    disconnectRepoTrainingBtn.addEventListener('click', () => {
      void disconnectRepoAutoTraining();
    });
  }
  if (botInfoOverlay) {
    botInfoOverlay.addEventListener('click', (event) => {
      if (event.target === botInfoOverlay) closeBotInfo();
    });
  }

  if (typeof runtime.onTrainingSessionCaptured === 'function') {
    runtime.onTrainingSessionCaptured((session) => {
      if (!localRepoTraining.handle) {
        setRepoTrainingStatus(
          `Saved browser training for ${session.bot.name}. Connect repo auto-train to write it into the checkout automatically.`
        );
        return;
      }
      void queueRepoTrainingSync('captured-session');
    });
  }

  populateBotSelect();
  syncTrainingContext();
  syncControllers();
  void initializeRepoAutoTraining();
  runtime.mountBrowser();

  ns.RUNTIME = runtime;
})();
