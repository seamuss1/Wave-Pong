(function () {
  const STORAGE_KEY = 'wave-pong-training-workbench-ratings-v3';
  const POLL_MS = 2500;
  const simCore = (window.WavePong || {}).SimCore;
  const config = (window.WavePong || {}).CONFIG;
  const runtimeVersion = (window.WavePong || {}).VERSION;
  const $ = (id) => document.getElementById(id);
  const elements = {
    refreshButton: $('refreshButton'), saveRatingsButton: $('saveRatingsButton'), downloadRatingsButton: $('downloadRatingsButton'),
    ratingsInput: $('ratingsInput'), clipsInput: $('clipsInput'), serverStatus: $('serverStatus'), runStatus: $('runStatus'),
    ratingsStatus: $('ratingsStatus'), replayStatus: $('replayStatus'), generationsRange: $('generationsRange'),
    generationsInput: $('generationsInput'), populationRange: $('populationRange'), populationInput: $('populationInput'),
    seedInput: $('seedInput'), scoreLimitInput: $('scoreLimitInput'), maxTicksInput: $('maxTicksInput'),
    checkpointEveryInput: $('checkpointEveryInput'), autoPromoteEveryInput: $('autoPromoteEveryInput'),
    progressEveryInput: $('progressEveryInput'), updateAllRosterInput: $('updateAllRosterInput'),
    publishRuntimeInput: $('publishRuntimeInput'), parameterSummary: $('parameterSummary'),
    startTrainingButton: $('startTrainingButton'), stopTrainingButton: $('stopTrainingButton'),
    runsCount: $('runsCount'), runList: $('runList'), overviewTitle: $('overviewTitle'),
    overviewSubtitle: $('overviewSubtitle'), overviewStats: $('overviewStats'), chartHint: $('chartHint'),
    progressChart: $('progressChart'), topCandidates: $('topCandidates'), tuningDiagnostics: $('tuningDiagnostics'),
    logConsole: $('logConsole'), studioSubtitle: $('studioSubtitle'), liveReplayTab: $('liveReplayTab'),
    clipReplayTab: $('clipReplayTab'), canvasStage: $('canvasStage'), replayCanvas: $('replayCanvas'),
    replayEmpty: $('replayEmpty'), videoStage: $('videoStage'), clipPlayer: $('clipPlayer'), clipEmpty: $('clipEmpty'),
    replayPlayPauseButton: $('replayPlayPauseButton'), replayRestartButton: $('replayRestartButton'),
    replaySpeedInput: $('replaySpeedInput'), replayScrubber: $('replayScrubber'), replayTickLabel: $('replayTickLabel'),
    replayMeta: $('replayMeta'), searchInput: $('searchInput'), decisionFilter: $('decisionFilter'),
    queueCount: $('queueCount'), replayList: $('replayList'), runDetails: $('runDetails'),
    decisionInput: $('decisionInput'), notesInput: $('notesInput'), saveReplayRatingButton: $('saveReplayRatingButton'),
    clearReplayRatingButton: $('clearReplayRatingButton'), botSummary: $('botSummary'),
    errorDialog: $('errorDialog'), errorDialogBody: $('errorDialogBody'),
    copyErrorButton: $('copyErrorButton'), closeErrorButton: $('closeErrorButton')
  };
  const scoreInputs = ['fun', 'fairness', 'skillExpression', 'pace', 'exploitRisk'].reduce((a, k) => ((a[k] = { input: $(`${k}Input`), output: $(`${k}Value`) }), a), {});
  const state = { online: false, runs: [], runsById: new Map(), selectedRunId: null, replays: [], filteredReplays: [], selectedReplayId: null, bundle: null, ratings: loadRatings(), mode: 'live', clipOverrides: new Map(), clipUrls: [], playback: { runtime: null, bundle: null, playing: false, speed: 1, lastAt: 0, pending: 0, raf: 0 } };
  function n(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function esc(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function fmt(v) { return n(v).toLocaleString(); }
  function dec(v, d = 1) { return n(v).toFixed(d); }
  function dur(ms) { const s = Math.max(0, Math.floor(n(ms) / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s % 60}s`; }
  function ratingOf(entry) { return state.ratings.get(entry.replayId) || { replayId: entry.replayId, botIds: entry.botIds || [], decision: 'watch', scores: { fun: 3, fairness: 3, skillExpression: 3, pace: 3, exploitRisk: 1 }, notes: '', updatedAt: null }; }
  function normalizeRating(item) {
    if (!item || !item.replayId) return null;
    const s = item.scores || {};
    return { replayId: item.replayId, botIds: Array.isArray(item.botIds) ? item.botIds.filter(Boolean) : [], decision: ['accept', 'watch', 'reject'].includes(item.decision) ? item.decision : 'watch', scores: { fun: clamp(Math.round(n(item.fun != null ? item.fun : s.fun) || 3), 1, 5), fairness: clamp(Math.round(n(item.fairness != null ? item.fairness : s.fairness) || 3), 1, 5), skillExpression: clamp(Math.round(n(item.skillExpression != null ? item.skillExpression : s.skillExpression) || 3), 1, 5), pace: clamp(Math.round(n(item.pace != null ? item.pace : s.pace) || 3), 1, 5), exploitRisk: clamp(Math.round(n(item.exploitRisk != null ? item.exploitRisk : s.exploitRisk) || 1), 0, 5) }, notes: typeof item.notes === 'string' ? item.notes : '', updatedAt: item.updatedAt || new Date().toISOString() };
  }
  function loadRatings() {
    try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"items":[]}'); return new Map((parsed.items || parsed || []).map(normalizeRating).filter(Boolean).map((r) => [r.replayId, r])); } catch (e) { return new Map(); }
  }
  function persistRatings(msg) { localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), items: Array.from(state.ratings.values()) })); elements.ratingsStatus.textContent = msg || (state.ratings.size ? `${state.ratings.size} ratings cached` : 'Ratings ready'); }
  function buildRatingsExport() { return { schemaVersion: 1, source: 'training-workbench', updatedAt: new Date().toISOString(), items: Array.from(state.ratings.values()) }; }
  function errorText(value) { return String((value && value.message) || value || 'Unknown error'); }
  function closeErrorDialog() { elements.errorDialog.classList.add('hidden'); }
  function showErrorDialog(title, error) {
    elements.errorDialogTitle = elements.errorDialogTitle || document.getElementById('errorDialogTitle');
    elements.errorDialogSubtitle = elements.errorDialogSubtitle || document.getElementById('errorDialogSubtitle');
    if (elements.errorDialogTitle) elements.errorDialogTitle.textContent = title;
    if (elements.errorDialogSubtitle) elements.errorDialogSubtitle.textContent = 'The full message below can be selected and copied.';
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
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      throw new Error(`${detail}. If the workbench server is running, check training/reports/_workbench/server.log.`);
    }
  }
  async function postJson(url, payload) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
      const text = await r.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch (error) {}
      if (!r.ok) {
        const message = parsed && parsed.error ? parsed.error : (text || `${r.status} ${r.statusText}`);
        const logFile = parsed && parsed.logFile ? ` Log: ${parsed.logFile}` : ' Log: training/reports/_workbench/server.log';
        throw new Error(`${message}${logFile}`);
      }
      return parsed;
    } catch (error) {
      const detail = error && error.message ? error.message : String(error);
      throw new Error(`${detail}. If the server did not receive the request, check that \`npm --prefix training run workbench\` is still running.`);
    }
  }
  function formConfig() { return { generations: n(elements.generationsInput.value) || 400, population: n(elements.populationInput.value) || 16, seed: n(elements.seedInput.value) || 1337, scoreLimit: n(elements.scoreLimitInput.value) || 5, maxTicks: n(elements.maxTicksInput.value) || 10800, checkpointEvery: n(elements.checkpointEveryInput.value) || 25, autoPromoteEvery: n(elements.autoPromoteEveryInput.value) || 0, progressEvery: n(elements.progressEveryInput.value) || 0, updateAllRoster: !!elements.updateAllRosterInput.checked, publishRuntime: !!elements.publishRuntimeInput.checked }; }
  function applyConfig(next) {
    const c = { ...formConfig(), ...(next || {}) };
    elements.generationsInput.value = c.generations; elements.generationsRange.value = clamp(c.generations, n(elements.generationsRange.min), n(elements.generationsRange.max));
    elements.populationInput.value = c.population; elements.populationRange.value = clamp(c.population, n(elements.populationRange.min), n(elements.populationRange.max));
    elements.seedInput.value = c.seed; elements.scoreLimitInput.value = c.scoreLimit; elements.maxTicksInput.value = c.maxTicks; elements.checkpointEveryInput.value = c.checkpointEvery; elements.autoPromoteEveryInput.value = c.autoPromoteEvery; elements.progressEveryInput.value = c.progressEvery; elements.updateAllRosterInput.checked = !!c.updateAllRoster; elements.publishRuntimeInput.checked = !!c.publishRuntime;
    renderParameterSummary();
  }
  function renderParameterSummary() {
    const c = formConfig();
    const chips = [['Generations', fmt(c.generations)], ['Population', fmt(c.population)], ['Seed', fmt(c.seed)], ['Score limit', fmt(c.scoreLimit)], ['Max ticks', fmt(c.maxTicks)], ['Checkpoint', `every ${fmt(c.checkpointEvery)}`], ['Auto-promote', c.autoPromoteEvery ? `every ${fmt(c.autoPromoteEvery)}` : 'off'], ['Publish', c.publishRuntime ? 'yes' : 'no']];
    elements.parameterSummary.innerHTML = chips.map(([l, v]) => `<div class="parameterChip"><span class="muted">${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('');
  }
  function selectedRun() { return state.runsById.get(state.selectedRunId) || null; }
  function selectedReplay() { return state.replays.find((r) => r.replayId === state.selectedReplayId) || null; }
  async function refreshState(resetSelection) {
    try {
      const payload = await getJson('/api/state');
      state.online = true;
      (payload.ratings && payload.ratings.items || []).map(normalizeRating).filter(Boolean).forEach((r) => state.ratings.set(r.replayId, r));
      persistRatings();
      state.runs = Array.isArray(payload.recentRuns) ? payload.recentRuns : [];
      state.runsById = new Map(state.runs.map((r) => [r.runId, r]));
      if (resetSelection || !state.selectedRunId || !state.runsById.has(state.selectedRunId)) state.selectedRunId = state.runs[0] ? state.runs[0].runId : null;
      await refreshRun();
    } catch (error) {
      state.online = false;
      elements.serverStatus.textContent = window.location.protocol === 'file:'
        ? 'Local file mode. Run `npm --prefix training run workbench` for live controls.'
        : 'Server offline. Run `npm --prefix training run workbench`.';
      console.warn(error);
      render();
    }
  }
  async function refreshRun() {
    const run = selectedRun();
    if (!run) { state.replays = []; state.selectedReplayId = null; state.bundle = null; stopReplay(); render(); return; }
    const runPayload = await getJson(`/api/runs/${encodeURIComponent(run.runId)}`);
    const replayPayload = await getJson(`/api/runs/${encodeURIComponent(run.runId)}/replays`);
    state.runsById.set(run.runId, runPayload.run);
    state.runs = state.runs.map((item) => item.runId === run.runId ? runPayload.run : item);
    state.replays = Array.isArray(replayPayload.items) ? replayPayload.items : [];
    if (!state.replays.some((r) => r.replayId === state.selectedReplayId)) state.selectedReplayId = state.replays[0] ? state.replays[0].replayId : null;
    if (state.selectedReplayId) { const payload = await getJson(`/api/runs/${encodeURIComponent(run.runId)}/replays/${encodeURIComponent(state.selectedReplayId)}`); state.bundle = payload.bundle || null; if (state.bundle) loadReplayBundle(state.bundle); } else { state.bundle = null; stopReplay(); }
    render();
  }
  async function startTraining() { try { const payload = await postJson('/api/training/start', formConfig()); state.selectedRunId = payload.run.runId; await refreshState(false); } catch (error) { showErrorDialog('Unable to start training.', error); } }
  async function stopTraining() { if (!state.selectedRunId) return; try { await postJson('/api/training/stop', { runId: state.selectedRunId }); await refreshState(false); } catch (error) { showErrorDialog('Unable to stop training.', error); } }
  function renderRuns() {
    elements.runsCount.textContent = `${state.runs.length} runs`;
    elements.runList.innerHTML = state.runs.length ? state.runs.map((run) => `<button type="button" data-run-id="${esc(run.runId)}" class="${run.runId === state.selectedRunId ? 'is-active' : ''}"><div class="runTitle">${esc(run.title)}</div><div class="runMeta"><span class="tag ${run.active ? 'good' : ''}">${esc(run.active ? 'active' : 'idle')}</span><span class="tag">${esc(`${run.generationCompleted || 0}/${run.generationsPlanned || 0} gen`)}</span><span class="tag">${esc(`${run.replayCount || 0} replays`)}</span></div></button>`).join('') : '<div class="emptyState">No runs yet.</div>';
    elements.runList.querySelectorAll('button[data-run-id]').forEach((button) => button.addEventListener('click', async () => { state.selectedRunId = button.getAttribute('data-run-id'); await refreshRun(); }));
  }
  function renderChart(run) {
    const reports = Array.isArray(run.generationReports) ? run.generationReports : [];
    if (!reports.length) { elements.progressChart.innerHTML = ''; elements.chartHint.textContent = 'Waiting for generation reports'; return; }
    const fit = reports.map((entry, i) => ({ x: i, y: n(entry.summary && entry.summary[0] ? entry.summary[0].topFitness : 0) }));
    const sec = reports.map((entry, i) => ({ x: i, y: n(entry.elapsedMs) / 1000 }));
    const W = 900, H = 220, P = 24, maxX = Math.max(1, fit.length - 1), maxY = Math.max(1, ...fit.map((p) => p.y), ...sec.map((p) => p.y));
    const pathOf = (points) => points.map((point, i) => `${i ? 'L' : 'M'}${(P + ((W - P * 2) * (point.x / maxX))).toFixed(2)},${(H - P - ((H - P * 2) * (point.y / maxY))).toFixed(2)}`).join(' ');
    elements.progressChart.innerHTML = `<path d="${pathOf(fit)}" fill="none" stroke="#84d8ff" stroke-width="4" stroke-linecap="round" /><path d="${pathOf(sec)}" fill="none" stroke="#d7ff71" stroke-width="3" stroke-dasharray="8 6" stroke-linecap="round" />`;
    elements.chartHint.textContent = 'Blue = top fitness, lime = generation seconds';
  }
  function renderOverview() {
    const run = selectedRun();
    elements.stopTrainingButton.disabled = !run || !run.active;
    if (!run) {
      elements.overviewTitle.textContent = 'Live Overview'; elements.overviewSubtitle.textContent = 'Select a run to inspect progress, logs, and checkpoints.'; elements.runStatus.textContent = 'No active run';
      elements.overviewStats.innerHTML = '<div class="emptyState">Run-level metrics will appear here.</div>'; elements.progressChart.innerHTML = ''; elements.chartHint.textContent = 'Waiting for run data';
      elements.topCandidates.innerHTML = '<div class="emptyState">Top candidates appear here after checkpoints.</div>'; elements.tuningDiagnostics.innerHTML = '<div class="emptyState">Lineage diagnostics appear here.</div>'; elements.logConsole.textContent = 'No run selected.'; elements.runDetails.innerHTML = '<div class="emptyState">Run details will appear here.</div>'; return;
    }
    elements.overviewTitle.textContent = run.title; elements.overviewSubtitle.textContent = `${run.active ? 'Training is running.' : 'Run is idle.'} ${run.generationCompleted || 0}/${run.generationsPlanned || 0} generations complete.`; elements.runStatus.textContent = run.active ? `Active run: ${run.title}` : `Selected run: ${run.title}`;
    const stats = [['Progress', `${dec((run.progress || 0) * 100, 1)}%`], ['Elapsed', dur(run.elapsedMs)], ['Population', fmt(run.population)], ['Matches/gen', fmt(run.matchesPerGeneration)]];
    elements.overviewStats.innerHTML = stats.map(([l, v]) => `<div class="statCard"><span class="muted">${esc(l)}</span><strong>${esc(v)}</strong></div>`).join('');
    renderChart(run);
    elements.topCandidates.innerHTML = (run.topCandidates || []).length ? `<div class="listStack">${run.topCandidates.map((item) => `<div class="parameterChip"><span>${esc(item.name || item.id || 'candidate')}</span><strong>Elo ${esc(Math.round(n(item.elo)))}</strong></div>`).join('')}</div>` : '<div class="emptyState">No checkpoint candidates yet.</div>';
    elements.tuningDiagnostics.innerHTML = (run.tuningDiagnostics || []).length ? `<div class="listStack">${run.tuningDiagnostics.map((line) => `<div class="parameterChip"><span class="mono">${esc(line)}</span></div>`).join('')}</div>` : '<div class="emptyState">No lineage diagnostics recorded yet.</div>';
    elements.logConsole.textContent = (run.recentLogs || []).length ? run.recentLogs.join('\n') : 'No log lines available yet.';
    const details = [['Reports dir', run.reportsDir || 'n/a'], ['Checkpoint', run.checkpointPath || 'n/a'], ['Report', run.reportPath || 'n/a'], ['Log', run.runLogFile || 'n/a'], ['Planned matches', fmt(run.totalPlannedMatches)], ['Replay bundles', fmt(run.replayCount)]];
    elements.runDetails.innerHTML = details.map(([l, v]) => `<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('');
  }
  function filterReplays() {
    const query = elements.searchInput.value.trim().toLowerCase();
    const filter = elements.decisionFilter.value;
    state.filteredReplays = state.replays.filter((entry) => {
      const rating = state.ratings.get(entry.replayId) || null;
      const haystack = [entry.replayId].concat(entry.botIds || []).join(' ').toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (filter === 'unrated' && rating) return false;
      if (filter !== 'all' && filter !== 'unrated' && (!rating || rating.decision !== filter)) return false;
      return true;
    });
    if (!state.filteredReplays.some((item) => item.replayId === state.selectedReplayId)) state.selectedReplayId = state.filteredReplays[0] ? state.filteredReplays[0].replayId : null;
  }
  function renderReplayList() {
    filterReplays();
    elements.queueCount.textContent = `${state.filteredReplays.length} replays`;
    elements.replayList.innerHTML = state.filteredReplays.length ? state.filteredReplays.map((entry) => {
      const rating = state.ratings.get(entry.replayId) || null;
      return `<button type="button" data-replay-id="${esc(entry.replayId)}" class="${entry.replayId === state.selectedReplayId ? 'is-active' : ''}"><div class="replayTitle">${esc(entry.replayId)}</div><div class="tagRow"><span class="tag">${esc(entry.score || '?')}</span><span class="tag">${esc(`speed ${dec(entry.maxBallSpeed, 2)}`)}</span><span class="tag ${entry.clipExists ? 'good' : 'warn'}">${esc(entry.clipExists ? 'clip ready' : 'clip missing')}</span><span class="tag">${esc(rating ? rating.decision.toUpperCase() : 'UNRATED')}</span></div></button>`;
    }).join('') : '<div class="emptyState">No replay bundles match the current filters.</div>';
    elements.replayList.querySelectorAll('button[data-replay-id]').forEach((button) => button.addEventListener('click', async () => { state.selectedReplayId = button.getAttribute('data-replay-id'); await refreshRun(); }));
  }
  function ensureRuntime() {
    if (!simCore || !config || !runtimeVersion) return null;
    if (!state.playback.runtime) { state.playback.runtime = simCore.createRuntime({ document, window, config, runtimeVersion, canvas: elements.replayCanvas }); state.playback.runtime.setMuted(true); state.playback.runtime.resize(); }
    return state.playback.runtime;
  }
  function updateTickLabel() { const runtime = state.playback.runtime; const total = state.playback.bundle ? state.playback.bundle.durationTicks || 0 : 0; const tick = runtime ? runtime.state.tick : 0; elements.replayTickLabel.textContent = `tick ${fmt(tick)} / ${fmt(total)}`; elements.replayScrubber.value = String(tick); }
  function drawReplay() { if (state.playback.runtime) { state.playback.runtime.render(); updateTickLabel(); } }
  function stopReplay() { state.playback.playing = false; state.playback.lastAt = 0; state.playback.pending = 0; if (state.playback.raf) window.cancelAnimationFrame(state.playback.raf); state.playback.raf = 0; elements.replayPlayPauseButton.textContent = 'Play'; }
  function resetReplay(bundle) {
    const runtime = ensureRuntime(); if (!runtime || !bundle) return null;
    runtime.startMatch({ ...(bundle.matchOptions || {}), skipCountdown: true, leftController: null, rightController: null });
    runtime.setControllers({ left: null, right: null });
    ((bundle.replay && bundle.replay.actions) || []).forEach((action) => runtime.queueInput(action.side, action.tick, action.action));
    state.playback.bundle = bundle; elements.replayScrubber.max = String(Math.max(1, bundle.durationTicks || 1)); elements.replayScrubber.value = '0'; drawReplay(); return runtime;
  }
  function replayLoop(ts) {
    if (!state.playback.playing || !state.playback.bundle || !state.playback.runtime) return;
    if (!state.playback.lastAt) state.playback.lastAt = ts;
    state.playback.pending += ((ts - state.playback.lastAt) / 1000) * state.playback.runtime.fixedTickRate * state.playback.speed;
    state.playback.lastAt = ts;
    while (state.playback.pending >= 1) {
      state.playback.runtime.stepSimulation(1); state.playback.pending -= 1;
      if (state.playback.runtime.state.tick >= state.playback.bundle.durationTicks) { stopReplay(); break; }
    }
    drawReplay();
    if (state.playback.playing) state.playback.raf = window.requestAnimationFrame(replayLoop);
  }
  function loadReplayBundle(bundle) { stopReplay(); resetReplay(bundle); elements.replayEmpty.classList.add('hidden'); elements.replayStatus.textContent = `Loaded replay ${bundle.replayId}`; }
  function replayClipSource(runId, replayId) { return state.clipOverrides.get(replayId) || `/training/reports/${encodeURIComponent(runId)}/clips/${encodeURIComponent(replayId)}.webm`; }
  function renderReplayStudio() {
    const replay = selectedReplay();
    if (!replay || !state.bundle) { elements.studioSubtitle.textContent = 'Pick a replay to view either a rendered clip or a fully simulated playback.'; elements.replayMeta.innerHTML = '<div class="emptyState">Replay metadata appears here after you select a replay.</div>'; elements.replayEmpty.classList.remove('hidden'); elements.clipEmpty.classList.remove('hidden'); return; }
    elements.studioSubtitle.textContent = `${(replay.botIds || []).join(' vs ') || 'Unknown matchup'} | seed ${replay.seed}`;
    const meta = [['Replay id', replay.replayId], ['Score', replay.score || '?'], ['Duration ticks', fmt(state.bundle.durationTicks)], ['Max ball speed', dec(replay.maxBallSpeed, 2)], ['Bots', (replay.botIds || []).join(' vs ') || 'Unknown'], ['Clip', replay.clipExists ? 'Available' : 'Missing']];
    elements.replayMeta.innerHTML = meta.map(([l, v]) => `<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('');
    const run = selectedRun(); const source = run ? replayClipSource(run.runId, replay.replayId) : '';
    if (elements.clipPlayer.getAttribute('src') !== source) { elements.clipPlayer.src = source; elements.clipPlayer.load(); }
    elements.canvasStage.classList.toggle('hidden', state.mode !== 'live'); elements.videoStage.classList.toggle('hidden', state.mode !== 'clip');
  }
  function renderRatingForm() {
    const replay = selectedReplay(); if (!replay) return;
    const rating = ratingOf(replay);
    Object.keys(scoreInputs).forEach((k) => { scoreInputs[k].input.value = rating.scores[k]; scoreInputs[k].output.value = rating.scores[k]; });
    elements.decisionInput.value = rating.decision; elements.notesInput.value = rating.notes || '';
  }
  function renderBotSummary() {
    const rows = {};
    state.ratings.forEach((rating) => (rating.botIds || []).forEach((botId) => {
      rows[botId] = rows[botId] || { botId, count: 0, rejectCount: 0, fun: 0, fairness: 0, skillExpression: 0, pace: 0, exploitRisk: 0 };
      rows[botId].count += 1; if (rating.decision === 'reject') rows[botId].rejectCount += 1;
      Object.keys(rows[botId]).forEach((key) => { if (rating.scores && Object.prototype.hasOwnProperty.call(rating.scores, key)) rows[botId][key] += n(rating.scores[key]); });
    }));
    const list = Object.values(rows).sort((a, b) => b.rejectCount - a.rejectCount || b.exploitRisk - a.exploitRisk);
    elements.botSummary.innerHTML = list.length ? '<table><thead><tr><th>Bot</th><th>Reviews</th><th>Rejects</th><th>Fun</th><th>Fair</th><th>Skill</th><th>Pace</th><th>Risk</th></tr></thead><tbody>' + list.map((row) => `<tr><td>${esc(row.botId)}</td><td>${esc(row.count)}</td><td>${esc(row.rejectCount)}</td><td>${esc(dec(row.fun / row.count, 2))}</td><td>${esc(dec(row.fairness / row.count, 2))}</td><td>${esc(dec(row.skillExpression / row.count, 2))}</td><td>${esc(dec(row.pace / row.count, 2))}</td><td>${esc(dec(row.exploitRisk / row.count, 2))}</td></tr>`).join('') + '</tbody></table>' : '<div class="emptyState">Bot-level review stats appear after you save replay ratings.</div>';
  }
  async function saveCurrentRating() {
    const replay = selectedReplay(); if (!replay) return;
    state.ratings.set(replay.replayId, { replayId: replay.replayId, botIds: Array.isArray(replay.botIds) ? replay.botIds.slice() : [], decision: ['accept', 'watch', 'reject'].includes(elements.decisionInput.value) ? elements.decisionInput.value : 'watch', scores: { fun: clamp(Math.round(n(scoreInputs.fun.input.value) || 3), 1, 5), fairness: clamp(Math.round(n(scoreInputs.fairness.input.value) || 3), 1, 5), skillExpression: clamp(Math.round(n(scoreInputs.skillExpression.input.value) || 3), 1, 5), pace: clamp(Math.round(n(scoreInputs.pace.input.value) || 3), 1, 5), exploitRisk: clamp(Math.round(n(scoreInputs.exploitRisk.input.value) || 1), 0, 5) }, notes: elements.notesInput.value.trim(), updatedAt: new Date().toISOString() });
    persistRatings();
    render();
    try { await postJson('/api/review/ratings', { schemaVersion: 1, source: 'training-workbench', updatedAt: new Date().toISOString(), items: Array.from(state.ratings.values()) }); persistRatings('Ratings saved to training/reports/review-ratings.json'); } catch (error) { persistRatings('Server save failed; ratings kept locally'); console.warn(error); }
  }
  function clearCurrentRating() { const replay = selectedReplay(); if (!replay) return; state.ratings.delete(replay.replayId); persistRatings(); render(); }
  function downloadText(name, text) { const blob = new Blob([text], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
  async function importRatings(file) { mergeRatings(file); render(); }
  async function mergeRatings(file) { const payload = JSON.parse(await file.text()); (payload.items || payload || []).map(normalizeRating).filter(Boolean).forEach((r) => state.ratings.set(r.replayId, r)); persistRatings(); }
  function loadClipOverrides(files) { state.clipUrls.forEach((url) => URL.revokeObjectURL(url)); state.clipUrls = []; state.clipOverrides.clear(); Array.from(files || []).forEach((file) => { const url = URL.createObjectURL(file); state.clipUrls.push(url); state.clipOverrides.set(file.name.replace(/\.webm$/i, ''), url); }); elements.replayStatus.textContent = state.clipOverrides.size ? `Loaded ${state.clipOverrides.size} clip override(s)` : 'Replay studio idle'; renderReplayStudio(); }
  function render() { elements.serverStatus.textContent = state.online ? 'Workbench server connected' : 'Server offline'; renderRuns(); renderOverview(); renderReplayList(); renderReplayStudio(); renderRatingForm(); renderBotSummary(); }

  function bindPair(range, input) { range.addEventListener('input', () => { input.value = range.value; renderParameterSummary(); }); input.addEventListener('input', () => { range.value = input.value; renderParameterSummary(); }); }
  bindPair(elements.generationsRange, elements.generationsInput); bindPair(elements.populationRange, elements.populationInput);
  [elements.seedInput, elements.scoreLimitInput, elements.maxTicksInput, elements.checkpointEveryInput, elements.autoPromoteEveryInput, elements.progressEveryInput, elements.updateAllRosterInput, elements.publishRuntimeInput].forEach((e) => e.addEventListener('input', renderParameterSummary));
  document.querySelectorAll('button[data-preset]').forEach((b) => b.addEventListener('click', () => applyConfig(({ smoke: { generations: 80, population: 10, checkpointEvery: 10, autoPromoteEvery: 0, publishRuntime: false }, tune: { generations: 600, population: 20, checkpointEvery: 25, autoPromoteEvery: 0, publishRuntime: false }, overnight: { generations: 2400, population: 24, checkpointEvery: 50, autoPromoteEvery: 100, publishRuntime: true } })[b.getAttribute('data-preset')] || {})));
  elements.refreshButton.addEventListener('click', () => refreshState(false));
  elements.startTrainingButton.addEventListener('click', startTraining);
  elements.stopTrainingButton.addEventListener('click', stopTraining);
  elements.saveRatingsButton.addEventListener('click', () => postJson('/api/review/ratings', buildRatingsExport()).then(() => persistRatings('Ratings saved to training/reports/review-ratings.json')).catch((e) => { persistRatings('Server save failed; ratings kept locally'); console.warn(e); }));
  elements.downloadRatingsButton.addEventListener('click', () => downloadText('review-ratings.json', JSON.stringify(buildRatingsExport(), null, 2)));
  elements.ratingsInput.addEventListener('change', async (event) => { const file = event.target.files && event.target.files[0]; if (file) await importRatings(file); });
  elements.clipsInput.addEventListener('change', (event) => loadClipOverrides(event.target.files));
  elements.searchInput.addEventListener('input', renderReplayList);
  elements.decisionFilter.addEventListener('change', renderReplayList);
  elements.liveReplayTab.addEventListener('click', () => { state.mode = 'live'; elements.liveReplayTab.classList.add('is-active'); elements.clipReplayTab.classList.remove('is-active'); renderReplayStudio(); });
  elements.clipReplayTab.addEventListener('click', () => { state.mode = 'clip'; elements.clipReplayTab.classList.add('is-active'); elements.liveReplayTab.classList.remove('is-active'); renderReplayStudio(); });
  elements.replayPlayPauseButton.addEventListener('click', () => { if (!state.bundle) return; state.playback.playing = !state.playback.playing; elements.replayPlayPauseButton.textContent = state.playback.playing ? 'Pause' : 'Play'; if (state.playback.playing) state.playback.raf = window.requestAnimationFrame(replayLoop); else stopReplay(); });
  elements.replayRestartButton.addEventListener('click', () => { if (state.bundle) loadReplayBundle(state.bundle); });
  elements.replaySpeedInput.addEventListener('change', () => { state.playback.speed = Math.max(0.25, n(elements.replaySpeedInput.value) || 1); });
  elements.replayScrubber.addEventListener('input', () => { if (!state.bundle) return; stopReplay(); const runtime = resetReplay(state.bundle); const target = clamp(n(elements.replayScrubber.value), 0, state.bundle.durationTicks || 0); while (runtime.state.tick < target) runtime.stepSimulation(Math.min(4, target - runtime.state.tick)); drawReplay(); });
  elements.saveReplayRatingButton.addEventListener('click', saveCurrentRating);
  elements.clearReplayRatingButton.addEventListener('click', clearCurrentRating);
  elements.copyErrorButton.addEventListener('click', copyErrorDialogText);
  elements.closeErrorButton.addEventListener('click', closeErrorDialog);
  elements.errorDialog.addEventListener('click', (event) => { if (event.target === elements.errorDialog) closeErrorDialog(); });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !elements.errorDialog.classList.contains('hidden')) closeErrorDialog(); });
  elements.clipPlayer.addEventListener('loadeddata', () => elements.clipEmpty.classList.add('hidden'));
  elements.clipPlayer.addEventListener('error', () => { elements.clipEmpty.classList.remove('hidden'); elements.clipEmpty.textContent = 'Unable to load the rendered clip. Use the live replay tab or load clip overrides.'; });
  Object.keys(scoreInputs).forEach((key) => scoreInputs[key].input.addEventListener('input', () => { scoreInputs[key].output.value = scoreInputs[key].input.value; }));

  applyConfig({ generations: 400, population: 16, seed: 1337, scoreLimit: 5, maxTicks: 10800, checkpointEvery: 25, autoPromoteEvery: 0, progressEvery: 0, updateAllRoster: true, publishRuntime: false });
  persistRatings();
  render();
  refreshState(true);
  window.setInterval(() => refreshState(false), POLL_MS);
})();
