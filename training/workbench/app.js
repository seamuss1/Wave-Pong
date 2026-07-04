(function () {
  const STORAGE_KEY = 'wave-pong-training-workbench-ratings-v4';
  const STATE_POLL_MS = 3000;
  const ACTIVE_REPLAY_POLL_MS = 4000;
  const IDLE_REPLAY_POLL_MS = 12000;
  const simCore = (window.WavePong || {}).SimCore;
  const config = (window.WavePong || {}).CONFIG;
  const runtimeVersion = (window.WavePong || {}).VERSION;
  const $ = (id) => document.getElementById(id);

  const elements = {
    settingsButton: $('settingsButton'),
    settingsPanel: $('settingsPanel'),
    autoRefreshInput: $('autoRefreshInput'),
    refreshButton: $('refreshButton'),
    settingsNote: $('settingsNote'),
    serverStatus: $('serverStatus'),
    runStatus: $('runStatus'),
    ratingsStatus: $('ratingsStatus'),
    replayStatus: $('replayStatus'),
    generationsRange: $('generationsRange'),
    generationsInput: $('generationsInput'),
    populationRange: $('populationRange'),
    populationInput: $('populationInput'),
    seedInput: $('seedInput'),
    scoreLimitInput: $('scoreLimitInput'),
    maxTicksInput: $('maxTicksInput'),
    checkpointEveryInput: $('checkpointEveryInput'),
    autoPromoteEveryInput: $('autoPromoteEveryInput'),
    progressEveryInput: $('progressEveryInput'),
    updateAllRosterInput: $('updateAllRosterInput'),
    publishRuntimeInput: $('publishRuntimeInput'),
    parameterSummary: $('parameterSummary'),
    startTrainingButton: $('startTrainingButton'),
    stopTrainingButton: $('stopTrainingButton'),
    runsCount: $('runsCount'),
    runList: $('runList'),
    overviewTitle: $('overviewTitle'),
    overviewSubtitle: $('overviewSubtitle'),
    overviewStats: $('overviewStats'),
    chartHint: $('chartHint'),
    progressChart: $('progressChart'),
    topCandidates: $('topCandidates'),
    tuningDiagnostics: $('tuningDiagnostics'),
    runArtifacts: $('runArtifacts'),
    logConsole: $('logConsole'),
    studioSubtitle: $('studioSubtitle'),
    queueCount: $('queueCount'),
    reviewTotals: $('reviewTotals'),
    searchInput: $('searchInput'),
    decisionFilter: $('decisionFilter'),
    replayList: $('replayList'),
    liveReplayTab: $('liveReplayTab'),
    clipReplayTab: $('clipReplayTab'),
    canvasStage: $('canvasStage'),
    replayCanvas: $('replayCanvas'),
    replayEmpty: $('replayEmpty'),
    videoStage: $('videoStage'),
    clipPlayer: $('clipPlayer'),
    clipEmpty: $('clipEmpty'),
    replayPlayPauseButton: $('replayPlayPauseButton'),
    replayRestartButton: $('replayRestartButton'),
    renderClipButton: $('renderClipButton'),
    replaySpeedInput: $('replaySpeedInput'),
    replayScrubber: $('replayScrubber'),
    replayTickLabel: $('replayTickLabel'),
    replayMeta: $('replayMeta'),
    reviewHeading: $('reviewHeading'),
    reviewSubtitle: $('reviewSubtitle'),
    decisionInput: $('decisionInput'),
    notesInput: $('notesInput'),
    saveReplayRatingButton: $('saveReplayRatingButton'),
    clearReplayRatingButton: $('clearReplayRatingButton'),
    errorDialog: $('errorDialog'),
    errorDialogBody: $('errorDialogBody'),
    copyErrorButton: $('copyErrorButton'),
    closeErrorButton: $('closeErrorButton')
  };

  const scoreKeys = ['fun', 'fairness', 'skillExpression', 'pace', 'exploitRisk'];
  const scoreInputs = scoreKeys.reduce((map, key) => {
    map[key] = {
      input: $(`${key}Input`),
      output: $(`${key}Value`)
    };
    return map;
  }, {});

  const state = {
    online: false,
    autoRefresh: true,
    lastSyncedAt: null,
    runs: [],
    runsById: new Map(),
    selectedRunId: null,
    replays: [],
    filteredReplays: [],
    selectedReplayId: null,
    bundle: null,
    bundleKey: null,
    replayListForRunId: null,
    replayListFetchedAt: 0,
    ratings: loadRatings(),
    mode: 'live',
    renderingClip: false,
    playback: {
      runtime: null,
      bundle: null,
      playing: false,
      speed: 1,
      lastAt: 0,
      pending: 0,
      raf: 0
    }
  };

  function n(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmt(value) {
    return n(value).toLocaleString();
  }

  function dec(value, digits) {
    return n(value).toFixed(digits == null ? 1 : digits);
  }

  function dur(ms) {
    const totalSeconds = Math.max(0, Math.floor(n(ms) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function formatClock(value) {
    if (!value) return 'never';
    try {
      return new Intl.DateTimeFormat([], {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      }).format(value);
    } catch (error) {
      return new Date(value).toLocaleTimeString();
    }
  }

  function selectedRun() {
    return state.runsById.get(state.selectedRunId) || null;
  }

  function selectedReplay() {
    return state.replays.find((entry) => entry.replayId === state.selectedReplayId) || null;
  }

  function errorText(value) {
    return String((value && value.message) || value || 'Unknown error');
  }

  function normalizeRating(item) {
    if (!item || !item.replayId) return null;
    const scores = item.scores || {};
    return {
      replayId: item.replayId,
      botIds: Array.isArray(item.botIds) ? item.botIds.filter(Boolean) : [],
      decision: ['accept', 'watch', 'reject'].includes(item.decision) ? item.decision : 'watch',
      scores: {
        fun: clamp(Math.round(n(item.fun != null ? item.fun : scores.fun) || 3), 1, 5),
        fairness: clamp(Math.round(n(item.fairness != null ? item.fairness : scores.fairness) || 3), 1, 5),
        skillExpression: clamp(Math.round(n(item.skillExpression != null ? item.skillExpression : scores.skillExpression) || 3), 1, 5),
        pace: clamp(Math.round(n(item.pace != null ? item.pace : scores.pace) || 3), 1, 5),
        exploitRisk: clamp(Math.round(n(item.exploitRisk != null ? item.exploitRisk : scores.exploitRisk) || 1), 0, 5)
      },
      notes: typeof item.notes === 'string' ? item.notes : '',
      updatedAt: item.updatedAt || new Date().toISOString()
    };
  }

  function loadRatings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"items":[]}');
      const items = Array.isArray(parsed) ? parsed : parsed.items || [];
      return new Map(items.map(normalizeRating).filter(Boolean).map((rating) => [rating.replayId, rating]));
    } catch (error) {
      return new Map();
    }
  }

  function persistRatings(statusMessage) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      items: Array.from(state.ratings.values())
    }));
    if (statusMessage) {
      elements.ratingsStatus.textContent = statusMessage;
      return;
    }
    elements.ratingsStatus.textContent = state.ratings.size
      ? `${state.ratings.size} saved reviews`
      : 'No saved reviews';
  }

  function buildRatingsExport() {
    return {
      schemaVersion: 1,
      source: 'training-workbench',
      updatedAt: new Date().toISOString(),
      items: Array.from(state.ratings.values())
    };
  }

  function ratingOf(entry) {
    return state.ratings.get(entry.replayId) || {
      replayId: entry.replayId,
      botIds: entry.botIds || [],
      decision: 'watch',
      scores: {
        fun: 3,
        fairness: 3,
        skillExpression: 3,
        pace: 3,
        exploitRisk: 1
      },
      notes: '',
      updatedAt: null
    };
  }

  function closeErrorDialog() {
    elements.errorDialog.classList.add('hidden');
  }

  function showErrorDialog(title, error) {
    const titleElement = document.getElementById('errorDialogTitle');
    const subtitleElement = document.getElementById('errorDialogSubtitle');
    if (titleElement) titleElement.textContent = title;
    if (subtitleElement) subtitleElement.textContent = 'The full message below can be selected and copied.';
    elements.errorDialogBody.value = `${title}\n\n${errorText(error)}`;
    elements.errorDialog.classList.remove('hidden');
    elements.errorDialogBody.focus();
    elements.errorDialogBody.select();
  }

  async function copyErrorDialogText() {
    const text = elements.errorDialogBody.value;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        elements.errorDialogBody.focus();
        elements.errorDialogBody.select();
        document.execCommand('copy');
      }
      elements.serverStatus.textContent = 'Error message copied';
    } catch (error) {
      elements.errorDialogBody.focus();
      elements.errorDialogBody.select();
    }
  }

  async function getJson(url) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      throw new Error(`${detail}. If the workbench server is running, check training/reports/_workbench/server.log.`);
    }
  }

  async function postJson(url, payload) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      });
      const text = await response.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch (error) {
        parsed = null;
      }
      if (!response.ok) {
        const message = parsed && parsed.error ? parsed.error : (text || `${response.status} ${response.statusText}`);
        const logFile = parsed && parsed.logFile
          ? ` Log: ${parsed.logFile}`
          : ' Log: training/reports/_workbench/server.log';
        throw new Error(`${message}${logFile}`);
      }
      return parsed;
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      throw new Error(`${detail}. If the server did not receive the request, check that \`npm --prefix training run workbench\` is still running.`);
    }
  }

  function formConfig() {
    return {
      generations: n(elements.generationsInput.value) || 400,
      population: n(elements.populationInput.value) || 16,
      seed: n(elements.seedInput.value) || 1337,
      scoreLimit: n(elements.scoreLimitInput.value) || 5,
      maxTicks: n(elements.maxTicksInput.value) || 10800,
      checkpointEvery: n(elements.checkpointEveryInput.value) || 25,
      autoPromoteEvery: n(elements.autoPromoteEveryInput.value) || 0,
      progressEvery: n(elements.progressEveryInput.value) || 0,
      updateAllRoster: !!elements.updateAllRosterInput.checked,
      publishRuntime: !!elements.publishRuntimeInput.checked
    };
  }

  function applyConfig(nextConfig) {
    const configValue = { ...formConfig(), ...(nextConfig || {}) };
    elements.generationsInput.value = configValue.generations;
    elements.generationsRange.value = clamp(configValue.generations, n(elements.generationsRange.min), n(elements.generationsRange.max));
    elements.populationInput.value = configValue.population;
    elements.populationRange.value = clamp(configValue.population, n(elements.populationRange.min), n(elements.populationRange.max));
    elements.seedInput.value = configValue.seed;
    elements.scoreLimitInput.value = configValue.scoreLimit;
    elements.maxTicksInput.value = configValue.maxTicks;
    elements.checkpointEveryInput.value = configValue.checkpointEvery;
    elements.autoPromoteEveryInput.value = configValue.autoPromoteEvery;
    elements.progressEveryInput.value = configValue.progressEvery;
    elements.updateAllRosterInput.checked = !!configValue.updateAllRoster;
    elements.publishRuntimeInput.checked = !!configValue.publishRuntime;
    renderParameterSummary();
  }

  function renderParameterSummary() {
    const configValue = formConfig();
    const chips = [
      ['Generations', fmt(configValue.generations)],
      ['Population', fmt(configValue.population)],
      ['Seed', fmt(configValue.seed)],
      ['Score limit', fmt(configValue.scoreLimit)],
      ['Max ticks', fmt(configValue.maxTicks)],
      ['Checkpoint', `every ${fmt(configValue.checkpointEvery)}`],
      ['Auto-promote', configValue.autoPromoteEvery ? `every ${fmt(configValue.autoPromoteEvery)}` : 'off'],
      ['Publish', configValue.publishRuntime ? 'yes' : 'no']
    ];
    elements.parameterSummary.innerHTML = chips
      .map(([label, value]) => `<div class="parameterChip"><span class="muted">${esc(label)}</span><strong>${esc(value)}</strong></div>`)
      .join('');
  }

  function resetClipPlayer(message) {
    elements.clipPlayer.pause();
    if (elements.clipPlayer.getAttribute('src')) {
      elements.clipPlayer.removeAttribute('src');
      elements.clipPlayer.load();
    }
    elements.clipEmpty.textContent = message;
    elements.clipEmpty.classList.remove('hidden');
  }

  function resetReplaySelection() {
    state.replays = [];
    state.filteredReplays = [];
    state.selectedReplayId = null;
    state.bundle = null;
    state.bundleKey = null;
    state.replayListForRunId = null;
    state.replayListFetchedAt = 0;
    stopReplay();
    resetClipPlayer('Rendered clips show up here after you create one.');
  }

  function mergeRatings(payload) {
    const items = (payload && payload.items) || [];
    items.map(normalizeRating).filter(Boolean).forEach((rating) => {
      state.ratings.set(rating.replayId, rating);
    });
    persistRatings();
  }

  async function refreshState(options) {
    const settings = {
      resetSelection: false,
      forceReplays: false,
      ...(options || {})
    };

    try {
      const payload = await getJson('/api/state');
      state.online = true;
      state.lastSyncedAt = new Date();
      mergeRatings(payload.ratings || { items: [] });

      const previousRunId = state.selectedRunId;
      state.runs = Array.isArray(payload.recentRuns) ? payload.recentRuns : [];
      state.runsById = new Map(state.runs.map((run) => [run.runId, run]));

      if (settings.resetSelection || !state.selectedRunId || !state.runsById.has(state.selectedRunId)) {
        state.selectedRunId = state.runs[0] ? state.runs[0].runId : null;
      }

      const runChanged = previousRunId !== state.selectedRunId;
      await refreshReplayData({ force: settings.forceReplays || runChanged });
      render();
    } catch (error) {
      state.online = false;
      console.warn(error);
      render();
    }
  }

  async function refreshReplayData(options) {
    const settings = { force: false, ...(options || {}) };
    const run = selectedRun();
    if (!run) {
      resetReplaySelection();
      return;
    }

    const now = Date.now();
    const refreshWindow = run.active ? ACTIVE_REPLAY_POLL_MS : IDLE_REPLAY_POLL_MS;
    const shouldFetchList =
      settings.force ||
      state.replayListForRunId !== run.runId ||
      (now - state.replayListFetchedAt) >= refreshWindow;

    if (shouldFetchList) {
      const payload = await getJson(`/api/runs/${encodeURIComponent(run.runId)}/replays`);
      state.replays = Array.isArray(payload.items) ? payload.items : [];
      state.replayListFetchedAt = now;
      state.replayListForRunId = run.runId;
    }

    if (!state.replays.some((entry) => entry.replayId === state.selectedReplayId)) {
      state.selectedReplayId = state.replays[0] ? state.replays[0].replayId : null;
    }

    await refreshSelectedReplayBundle({ force: settings.force });
  }

  async function refreshSelectedReplayBundle(options) {
    const settings = { force: false, ...(options || {}) };
    const run = selectedRun();
    const replay = selectedReplay();

    if (!run || !replay) {
      state.bundle = null;
      state.bundleKey = null;
      stopReplay();
      resetClipPlayer('Rendered clips show up here after you create one.');
      return;
    }

    const bundleKey = `${run.runId}:${replay.replayId}`;
    if (!settings.force && state.bundleKey === bundleKey && state.bundle) {
      return;
    }

    const payload = await getJson(`/api/runs/${encodeURIComponent(run.runId)}/replays/${encodeURIComponent(replay.replayId)}`);
    state.bundle = payload.bundle || null;
    state.bundleKey = state.bundle ? bundleKey : null;
    if (state.bundle) {
      loadReplayBundle(state.bundle);
    } else {
      stopReplay();
    }
  }

  async function startTraining() {
    try {
      const payload = await postJson('/api/training/start', formConfig());
      state.selectedRunId = payload.run.runId;
      state.replayListForRunId = null;
      await refreshState({ forceReplays: true });
    } catch (error) {
      showErrorDialog('Unable to start training.', error);
    }
  }

  async function stopTraining() {
    if (!state.selectedRunId) return;
    try {
      await postJson('/api/training/stop', { runId: state.selectedRunId });
      await refreshState({ forceReplays: true });
    } catch (error) {
      showErrorDialog('Unable to stop training.', error);
    }
  }

  async function renderSelectedClip() {
    const run = selectedRun();
    const replay = selectedReplay();
    if (!run || !replay) return;

    state.renderingClip = true;
    renderStatusStrip();
    renderReplayStudio();

    try {
      await postJson(`/api/runs/${encodeURIComponent(run.runId)}/replays/${encodeURIComponent(replay.replayId)}/render-clip`, {});
      await refreshReplayData({ force: true });
      state.mode = 'clip';
      stopReplay();
      render();
    } catch (error) {
      showErrorDialog('Unable to render clip.', error);
    } finally {
      state.renderingClip = false;
      renderStatusStrip();
      renderReplayStudio();
    }
  }

  function renderStatusStrip() {
    if (!state.online) {
      elements.serverStatus.textContent = window.location.protocol === 'file:'
        ? 'Local file mode. Run `npm --prefix training run workbench` for live controls.'
        : 'Server offline. Run `npm --prefix training run workbench`.';
    } else if (state.autoRefresh) {
      elements.serverStatus.textContent = `Live sync • ${formatClock(state.lastSyncedAt)}`;
    } else {
      elements.serverStatus.textContent = `Connected • sync paused at ${formatClock(state.lastSyncedAt)}`;
    }

    const run = selectedRun();
    elements.runStatus.textContent = !run
      ? 'No active run'
      : run.active
        ? `Active run • ${run.title}`
        : `Selected run • ${run.title}`;

    const replay = selectedReplay();
    if (state.renderingClip && replay) {
      elements.replayStatus.textContent = `Rendering clip • ${replay.replayId}`;
    } else if (!replay) {
      elements.replayStatus.textContent = 'Replay studio idle';
    } else if (state.mode === 'clip' && replay.clipExists) {
      elements.replayStatus.textContent = `Rendered clip • ${replay.replayId}`;
    } else {
      elements.replayStatus.textContent = `Loaded replay • ${replay.replayId}`;
    }

    elements.settingsNote.textContent = state.autoRefresh
      ? `Auto-refresh is on. Last successful sync: ${formatClock(state.lastSyncedAt)}.`
      : 'Auto-refresh is paused. Use Refresh now to pull the latest run and replay data.';
  }

  function renderRuns() {
    elements.runsCount.textContent = `${state.runs.length} runs`;
    if (!state.runs.length) {
      elements.runList.innerHTML = '<div class="emptyState">No runs yet. Start a training run to populate the dashboard.</div>';
      return;
    }

    elements.runList.innerHTML = state.runs.map((run) => {
      const progressLabel = `${fmt(run.generationCompleted || 0)}/${fmt(run.generationsPlanned || 0)} gen`;
      const replayLabel = `${fmt(run.replayCount || 0)} replays`;
      const stateTag = run.active ? '<span class="tag live">active</span>' : '<span class="tag">idle</span>';
      return `
        <button type="button" data-run-id="${esc(run.runId)}" class="${run.runId === state.selectedRunId ? 'is-active' : ''}">
          <div class="runTitle">${esc(run.title)}</div>
          <div class="runMeta">
            ${stateTag}
            <span class="tag">${esc(progressLabel)}</span>
            <span class="tag">${esc(replayLabel)}</span>
          </div>
        </button>
      `;
    }).join('');

    elements.runList.querySelectorAll('button[data-run-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const runId = button.getAttribute('data-run-id');
        if (!runId || runId === state.selectedRunId) return;
        state.selectedRunId = runId;
        resetReplaySelection();
        render();
        try {
          await refreshReplayData({ force: true });
        } catch (error) {
          console.warn(error);
        }
        render();
      });
    });
  }

  function renderChart(run) {
    const reports = Array.isArray(run && run.generationReports) ? run.generationReports : [];
    if (!reports.length) {
      elements.progressChart.innerHTML = '';
      elements.chartHint.textContent = 'Waiting for generation reports';
      return;
    }

    const fitnessPoints = reports.map((entry, index) => ({
      x: index,
      y: n(entry.summary && entry.summary[0] ? entry.summary[0].topFitness : 0)
    }));
    const secondsPoints = reports.map((entry, index) => ({
      x: index,
      y: n(entry.elapsedMs) / 1000
    }));
    const width = 900;
    const height = 220;
    const padding = 24;
    const maxX = Math.max(1, fitnessPoints.length - 1);
    const maxY = Math.max(1, ...fitnessPoints.map((point) => point.y), ...secondsPoints.map((point) => point.y));

    const pathOf = (points) => points.map((point, index) => {
      const x = padding + ((width - padding * 2) * (point.x / maxX));
      const y = height - padding - ((height - padding * 2) * (point.y / maxY));
      return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    elements.progressChart.innerHTML = [
      `<path d="${pathOf(fitnessPoints)}" fill="none" stroke="#84d8ff" stroke-width="4" stroke-linecap="round" />`,
      `<path d="${pathOf(secondsPoints)}" fill="none" stroke="#d7ff71" stroke-width="3" stroke-dasharray="8 6" stroke-linecap="round" />`
    ].join('');
    elements.chartHint.textContent = 'Blue = top fitness, lime = generation seconds';
  }

  function renderOverview() {
    const run = selectedRun();
    elements.stopTrainingButton.disabled = !run || !run.active;

    if (!run) {
      elements.overviewTitle.textContent = 'Selected Run';
      elements.overviewSubtitle.textContent = 'Choose a run to inspect progress, diagnostics, logs, and replays.';
      elements.overviewStats.innerHTML = '<div class="emptyState">Run-level metrics will appear here.</div>';
      elements.progressChart.innerHTML = '';
      elements.chartHint.textContent = 'Waiting for run data';
      elements.topCandidates.innerHTML = '<div class="emptyState">Top candidates appear here after checkpoints.</div>';
      elements.tuningDiagnostics.innerHTML = '<div class="emptyState">Lineage diagnostics appear here after the first saved report.</div>';
      elements.runArtifacts.innerHTML = '<div class="emptyState">Artifact paths appear here after a run is selected.</div>';
      elements.logConsole.textContent = 'No run selected.';
      return;
    }

    elements.overviewTitle.textContent = run.title;
    elements.overviewSubtitle.textContent = run.active
      ? `${fmt(run.generationCompleted || 0)} of ${fmt(run.generationsPlanned || 0)} generations complete.`
      : `Run complete or idle at ${fmt(run.generationCompleted || 0)} of ${fmt(run.generationsPlanned || 0)} generations.`;

    const stats = [
      ['Progress', `${dec((run.progress || 0) * 100, 1)}%`],
      ['Elapsed', dur(run.elapsedMs)],
      ['Population', fmt(run.population)],
      ['Matches/gen', fmt(run.matchesPerGeneration)]
    ];

    elements.overviewStats.innerHTML = stats.map(([label, value]) => `
      <div class="statCard">
        <span class="muted">${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>
    `).join('');

    renderChart(run);

    elements.topCandidates.innerHTML = (run.topCandidates || []).length
      ? `<div class="listStack">${run.topCandidates.map((candidate) => `
          <div class="parameterChip">
            <span>${esc(candidate.name || candidate.id || 'candidate')}</span>
            <strong>Elo ${esc(Math.round(n(candidate.elo)))}</strong>
          </div>
        `).join('')}</div>`
      : '<div class="emptyState">No checkpoint candidates recorded yet.</div>';

    elements.tuningDiagnostics.innerHTML = (run.tuningDiagnostics || []).length
      ? `<div class="listStack">${run.tuningDiagnostics.map((line) => `
          <div class="parameterChip"><span class="mono">${esc(line)}</span></div>
        `).join('')}</div>`
      : '<div class="emptyState">No lineage diagnostics were captured for the latest generation.</div>';

    const artifacts = [
      ['Reports dir', run.reportsDir || 'n/a'],
      ['Checkpoint', run.checkpointPath || 'n/a'],
      ['Latest report', run.reportPath || 'n/a'],
      ['Run log', run.runLogFile || 'n/a'],
      ['Replay bundles', fmt(run.replayCount || 0)],
      ['Planned matches', fmt(run.totalPlannedMatches || 0)]
    ];
    elements.runArtifacts.innerHTML = artifacts.map(([label, value]) => `
      <div>
        <dt>${esc(label)}</dt>
        <dd>${esc(value)}</dd>
      </div>
    `).join('');

    elements.logConsole.textContent = (run.recentLogs || []).length
      ? run.recentLogs.join('\n')
      : 'No log lines available yet.';
  }

  function filterReplays() {
    const query = elements.searchInput.value.trim().toLowerCase();
    const decisionFilter = elements.decisionFilter.value;
    state.filteredReplays = state.replays.filter((entry) => {
      const rating = state.ratings.get(entry.replayId) || null;
      const haystack = [entry.replayId].concat(entry.botIds || []).join(' ').toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (decisionFilter === 'unrated') return !rating;
      if (decisionFilter !== 'all') return !!rating && rating.decision === decisionFilter;
      return true;
    });

    if (!state.filteredReplays.some((entry) => entry.replayId === state.selectedReplayId)) {
      state.selectedReplayId = state.filteredReplays[0] ? state.filteredReplays[0].replayId : null;
    }
  }

  function renderReviewTotals() {
    const totals = {
      total: state.replays.length,
      accept: 0,
      watch: 0,
      reject: 0,
      unrated: 0
    };

    state.replays.forEach((entry) => {
      const rating = state.ratings.get(entry.replayId);
      if (!rating) {
        totals.unrated += 1;
        return;
      }
      if (rating.decision === 'accept') totals.accept += 1;
      else if (rating.decision === 'reject') totals.reject += 1;
      else totals.watch += 1;
    });

    const pills = [
      ['Queue', totals.total],
      ['Accept', totals.accept],
      ['Watch', totals.watch],
      ['Reject', totals.reject],
      ['Unrated', totals.unrated]
    ];

    elements.reviewTotals.innerHTML = pills.map(([label, value]) => `
      <div class="summaryPill">
        <span>${esc(label)}</span>
        <strong>${esc(value)}</strong>
      </div>
    `).join('');
  }

  function renderReplayList() {
    filterReplays();
    elements.queueCount.textContent = `${state.filteredReplays.length} replays`;
    renderReviewTotals();

    if (!state.filteredReplays.length) {
      elements.replayList.innerHTML = '<div class="emptyState">No replay bundles match the current filter.</div>';
      return;
    }

    elements.replayList.innerHTML = state.filteredReplays.map((entry) => {
      const rating = state.ratings.get(entry.replayId) || null;
      const decision = rating ? rating.decision.toUpperCase() : 'UNRATED';
      const clipTag = entry.clipExists
        ? '<span class="tag good">clip ready</span>'
        : '<span class="tag warn">clip missing</span>';
      return `
        <button type="button" data-replay-id="${esc(entry.replayId)}" class="${entry.replayId === state.selectedReplayId ? 'is-active' : ''}">
          <div class="replayTitle">${esc(entry.replayId)}</div>
          <div class="tagRow">
            <span class="tag">${esc(entry.score || '?')}</span>
            <span class="tag">${esc(`speed ${dec(entry.maxBallSpeed, 2)}`)}</span>
            ${clipTag}
            <span class="tag">${esc(decision)}</span>
          </div>
        </button>
      `;
    }).join('');

    elements.replayList.querySelectorAll('button[data-replay-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const replayId = button.getAttribute('data-replay-id');
        if (!replayId || replayId === state.selectedReplayId) return;
        state.selectedReplayId = replayId;
        try {
          await refreshSelectedReplayBundle({ force: true });
        } catch (error) {
          console.warn(error);
        }
        render();
      });
    });
  }

  function ensureRuntime() {
    if (!simCore || !config || !runtimeVersion) return null;
    if (!state.playback.runtime) {
      state.playback.runtime = simCore.createRuntime({
        document,
        window,
        config,
        runtimeVersion,
        canvas: elements.replayCanvas
      });
      state.playback.runtime.setMuted(true);
      state.playback.runtime.resize();
    }
    return state.playback.runtime;
  }

  function updateTickLabel() {
    const runtime = state.playback.runtime;
    const total = state.playback.bundle ? state.playback.bundle.durationTicks || 0 : 0;
    const tick = runtime ? runtime.state.tick : 0;
    elements.replayTickLabel.textContent = `tick ${fmt(tick)} / ${fmt(total)}`;
    elements.replayScrubber.value = String(tick);
  }

  function drawReplay() {
    if (!state.playback.runtime) return;
    state.playback.runtime.render();
    updateTickLabel();
  }

  function stopReplay() {
    state.playback.playing = false;
    state.playback.lastAt = 0;
    state.playback.pending = 0;
    if (state.playback.raf) window.cancelAnimationFrame(state.playback.raf);
    state.playback.raf = 0;
    elements.replayPlayPauseButton.textContent = 'Play';
  }

  function resetReplay(bundle) {
    const runtime = ensureRuntime();
    if (!runtime || !bundle) return null;

    runtime.startMatch({
      ...(bundle.matchOptions || {}),
      skipCountdown: true,
      leftController: null,
      rightController: null
    });
    runtime.setControllers({ left: null, right: null });
    ((bundle.replay && bundle.replay.actions) || []).forEach((action) => {
      runtime.queueInput(action.side, action.tick, action.action);
    });

    state.playback.bundle = bundle;
    elements.replayScrubber.max = String(Math.max(1, bundle.durationTicks || 1));
    elements.replayScrubber.value = '0';
    drawReplay();
    return runtime;
  }

  function replayLoop(timestamp) {
    if (!state.playback.playing || !state.playback.bundle || !state.playback.runtime) return;
    if (!state.playback.lastAt) state.playback.lastAt = timestamp;

    state.playback.pending += ((timestamp - state.playback.lastAt) / 1000)
      * state.playback.runtime.fixedTickRate
      * state.playback.speed;
    state.playback.lastAt = timestamp;

    while (state.playback.pending >= 1) {
      state.playback.runtime.stepSimulation(1);
      state.playback.pending -= 1;
      if (state.playback.runtime.state.tick >= state.playback.bundle.durationTicks) {
        stopReplay();
        break;
      }
    }

    drawReplay();
    if (state.playback.playing) {
      state.playback.raf = window.requestAnimationFrame(replayLoop);
    }
  }

  function loadReplayBundle(bundle) {
    stopReplay();
    resetReplay(bundle);
    elements.replayEmpty.classList.add('hidden');
  }

  function replayClipSource(runId, replayId) {
    return `/training/reports/${encodeURIComponent(runId)}/clips/${encodeURIComponent(replayId)}.webm`;
  }

  function renderReplayStudio() {
    const run = selectedRun();
    const replay = selectedReplay();
    const clipReady = !!(replay && replay.clipExists);
    const clipMessage = replay
      ? (clipReady ? 'Loading rendered clip...' : 'Rendered clip not ready yet. Click Render clip to create one.')
      : 'Rendered clips show up here after you create one.';

    elements.renderClipButton.disabled = !replay || state.renderingClip;
    elements.renderClipButton.textContent = state.renderingClip
      ? 'Rendering...'
      : (replay && replay.clipExists ? 'Re-render clip' : 'Render clip');

    elements.liveReplayTab.classList.toggle('is-active', state.mode === 'live');
    elements.clipReplayTab.classList.toggle('is-active', state.mode === 'clip');
    elements.canvasStage.classList.toggle('hidden', state.mode !== 'live');
    elements.videoStage.classList.toggle('hidden', state.mode !== 'clip');

    if (!replay || !state.bundle) {
      elements.studioSubtitle.textContent = 'Inspect recent matches, replay them live, render clips, and capture review notes.';
      elements.replayMeta.innerHTML = '<div class="emptyState">Replay metadata appears here after you select a replay.</div>';
      elements.replayEmpty.classList.remove('hidden');
      resetClipPlayer('Rendered clips show up here after you create one.');
      return;
    }

    elements.studioSubtitle.textContent = `${(replay.botIds || []).join(' vs ') || 'Unknown matchup'} • seed ${replay.seed}`;
    const meta = [
      ['Replay id', replay.replayId],
      ['Score', replay.score || '?'],
      ['Duration ticks', fmt(state.bundle.durationTicks)],
      ['Max ball speed', dec(replay.maxBallSpeed, 2)],
      ['Bots', (replay.botIds || []).join(' vs ') || 'Unknown'],
      ['Clip', clipReady ? 'Available' : 'Missing']
    ];
    elements.replayMeta.innerHTML = meta.map(([label, value]) => `
      <div>
        <dt>${esc(label)}</dt>
        <dd>${esc(value)}</dd>
      </div>
    `).join('');

    elements.replayEmpty.classList.add('hidden');
    elements.clipEmpty.textContent = clipMessage;

    if (!clipReady || !run) {
      resetClipPlayer(clipMessage);
      return;
    }

    const source = replayClipSource(run.runId, replay.replayId);
    if (elements.clipPlayer.getAttribute('src') !== source) {
      elements.clipPlayer.src = source;
      elements.clipPlayer.load();
    }
  }

  function setRatingInputsDisabled(disabled) {
    scoreKeys.forEach((key) => {
      scoreInputs[key].input.disabled = disabled;
    });
    elements.decisionInput.disabled = disabled;
    elements.notesInput.disabled = disabled;
    elements.saveReplayRatingButton.disabled = disabled;
    elements.clearReplayRatingButton.disabled = disabled;
  }

  function renderRatingForm() {
    const replay = selectedReplay();
    if (!replay) {
      elements.reviewHeading.textContent = 'Selected Replay Review';
      elements.reviewSubtitle.textContent = 'Choose a replay from the queue to save a review.';
      scoreKeys.forEach((key) => {
        scoreInputs[key].input.value = key === 'exploitRisk' ? '1' : '3';
        scoreInputs[key].output.value = scoreInputs[key].input.value;
      });
      elements.decisionInput.value = 'watch';
      elements.notesInput.value = '';
      setRatingInputsDisabled(true);
      return;
    }

    const rating = ratingOf(replay);
    elements.reviewHeading.textContent = replay.replayId;
    elements.reviewSubtitle.textContent = `${(replay.botIds || []).join(' vs ') || 'Unknown matchup'} • ${replay.score || '?'}`;
    scoreKeys.forEach((key) => {
      scoreInputs[key].input.value = String(rating.scores[key]);
      scoreInputs[key].output.value = String(rating.scores[key]);
    });
    elements.decisionInput.value = rating.decision;
    elements.notesInput.value = rating.notes || '';
    setRatingInputsDisabled(false);
  }

  async function saveCurrentRating() {
    const replay = selectedReplay();
    if (!replay) return;

    state.ratings.set(replay.replayId, {
      replayId: replay.replayId,
      botIds: Array.isArray(replay.botIds) ? replay.botIds.slice() : [],
      decision: ['accept', 'watch', 'reject'].includes(elements.decisionInput.value)
        ? elements.decisionInput.value
        : 'watch',
      scores: {
        fun: clamp(Math.round(n(scoreInputs.fun.input.value) || 3), 1, 5),
        fairness: clamp(Math.round(n(scoreInputs.fairness.input.value) || 3), 1, 5),
        skillExpression: clamp(Math.round(n(scoreInputs.skillExpression.input.value) || 3), 1, 5),
        pace: clamp(Math.round(n(scoreInputs.pace.input.value) || 3), 1, 5),
        exploitRisk: clamp(Math.round(n(scoreInputs.exploitRisk.input.value) || 1), 0, 5)
      },
      notes: elements.notesInput.value.trim(),
      updatedAt: new Date().toISOString()
    });

    persistRatings('Saving review...');
    renderReplayList();

    try {
      await postJson('/api/review/ratings', buildRatingsExport());
      persistRatings('Reviews saved to training/reports/review-ratings.json');
    } catch (error) {
      persistRatings('Server save failed; review is still cached locally');
      console.warn(error);
    }
    render();
  }

  function clearCurrentRating() {
    const replay = selectedReplay();
    if (!replay) return;
    state.ratings.delete(replay.replayId);
    persistRatings();
    render();
  }

  function render() {
    renderStatusStrip();
    renderRuns();
    renderOverview();
    renderReplayList();
    renderReplayStudio();
    renderRatingForm();
  }

  async function syncReplaySelectionAfterFilter() {
    const previousReplayId = state.selectedReplayId;
    renderReplayList();
    if (state.selectedReplayId && state.selectedReplayId !== previousReplayId) {
      try {
        await refreshSelectedReplayBundle({ force: true });
      } catch (error) {
        console.warn(error);
      }
    }
    render();
  }

  function toggleSettingsPanel() {
    elements.settingsPanel.classList.toggle('hidden');
  }

  function bindPair(range, input) {
    range.addEventListener('input', () => {
      input.value = range.value;
      renderParameterSummary();
    });
    input.addEventListener('input', () => {
      range.value = input.value;
      renderParameterSummary();
    });
  }

  bindPair(elements.generationsRange, elements.generationsInput);
  bindPair(elements.populationRange, elements.populationInput);

  [
    elements.seedInput,
    elements.scoreLimitInput,
    elements.maxTicksInput,
    elements.checkpointEveryInput,
    elements.autoPromoteEveryInput,
    elements.progressEveryInput,
    elements.updateAllRosterInput,
    elements.publishRuntimeInput
  ].forEach((input) => input.addEventListener('input', renderParameterSummary));

  document.querySelectorAll('button[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const presets = {
        smoke: {
          generations: 80,
          population: 10,
          checkpointEvery: 10,
          autoPromoteEvery: 0,
          publishRuntime: false
        },
        tune: {
          generations: 600,
          population: 20,
          checkpointEvery: 25,
          autoPromoteEvery: 0,
          publishRuntime: false
        },
        overnight: {
          generations: 2400,
          population: 24,
          checkpointEvery: 50,
          autoPromoteEvery: 100,
          publishRuntime: true
        }
      };
      applyConfig(presets[button.getAttribute('data-preset')] || {});
    });
  });

  elements.settingsButton.addEventListener('click', toggleSettingsPanel);
  elements.autoRefreshInput.addEventListener('change', () => {
    state.autoRefresh = !!elements.autoRefreshInput.checked;
    renderStatusStrip();
  });
  elements.refreshButton.addEventListener('click', () => refreshState({ forceReplays: true }));
  elements.startTrainingButton.addEventListener('click', startTraining);
  elements.stopTrainingButton.addEventListener('click', stopTraining);
  elements.searchInput.addEventListener('input', syncReplaySelectionAfterFilter);
  elements.decisionFilter.addEventListener('change', syncReplaySelectionAfterFilter);
  elements.liveReplayTab.addEventListener('click', () => {
    state.mode = 'live';
    elements.clipPlayer.pause();
    renderReplayStudio();
    renderStatusStrip();
  });
  elements.clipReplayTab.addEventListener('click', () => {
    state.mode = 'clip';
    stopReplay();
    renderReplayStudio();
    renderStatusStrip();
  });
  elements.replayPlayPauseButton.addEventListener('click', () => {
    if (!state.bundle) return;
    state.mode = 'live';
    elements.liveReplayTab.classList.add('is-active');
    elements.clipReplayTab.classList.remove('is-active');
    if (state.playback.playing) {
      stopReplay();
      return;
    }
    state.playback.playing = true;
    elements.replayPlayPauseButton.textContent = 'Pause';
    state.playback.raf = window.requestAnimationFrame(replayLoop);
  });
  elements.replayRestartButton.addEventListener('click', () => {
    if (state.bundle) loadReplayBundle(state.bundle);
  });
  elements.renderClipButton.addEventListener('click', renderSelectedClip);
  elements.replaySpeedInput.addEventListener('change', () => {
    state.playback.speed = Math.max(0.25, n(elements.replaySpeedInput.value) || 1);
  });
  elements.replayScrubber.addEventListener('input', () => {
    if (!state.bundle) return;
    stopReplay();
    const runtime = resetReplay(state.bundle);
    const targetTick = clamp(n(elements.replayScrubber.value), 0, state.bundle.durationTicks || 0);
    while (runtime.state.tick < targetTick) {
      runtime.stepSimulation(Math.min(4, targetTick - runtime.state.tick));
    }
    drawReplay();
  });
  elements.saveReplayRatingButton.addEventListener('click', saveCurrentRating);
  elements.clearReplayRatingButton.addEventListener('click', clearCurrentRating);
  elements.copyErrorButton.addEventListener('click', copyErrorDialogText);
  elements.closeErrorButton.addEventListener('click', closeErrorDialog);
  elements.errorDialog.addEventListener('click', (event) => {
    if (event.target === elements.errorDialog) closeErrorDialog();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.errorDialog.classList.contains('hidden')) {
      closeErrorDialog();
    }
  });

  elements.clipPlayer.addEventListener('loadeddata', () => {
    elements.clipEmpty.classList.add('hidden');
  });
  elements.clipPlayer.addEventListener('error', () => {
    elements.clipEmpty.classList.remove('hidden');
    elements.clipEmpty.textContent = 'Unable to load the rendered clip. Use the live replay tab or render the clip again.';
  });

  scoreKeys.forEach((key) => {
    scoreInputs[key].input.addEventListener('input', () => {
      scoreInputs[key].output.value = scoreInputs[key].input.value;
    });
  });

  applyConfig({
    generations: 400,
    population: 16,
    seed: 1337,
    scoreLimit: 5,
    maxTicks: 10800,
    checkpointEvery: 25,
    autoPromoteEvery: 0,
    progressEvery: 0,
    updateAllRoster: true,
    publishRuntime: false
  });
  elements.autoRefreshInput.checked = true;
  persistRatings();
  render();
  refreshState({ resetSelection: true });
  window.setInterval(() => {
    if (!state.autoRefresh) return;
    refreshState();
  }, STATE_POLL_MS);
})();
