(function () {
  const STORAGE_KEY = 'wave-pong-review-ratings-v1';
  const EMPTY_STATS = [
    { label: 'Replays', value: '0' },
    { label: 'Rated', value: '0' },
    { label: 'Rejected', value: '0' },
    { label: 'Flagged', value: '0' }
  ];

  const elements = {
    manifestInput: document.getElementById('manifestInput'),
    ratingsInput: document.getElementById('ratingsInput'),
    clipsInput: document.getElementById('clipsInput'),
    repoButton: document.getElementById('repoButton'),
    saveButton: document.getElementById('saveButton'),
    downloadButton: document.getElementById('downloadButton'),
    manifestStatus: document.getElementById('manifestStatus'),
    clipsStatus: document.getElementById('clipsStatus'),
    ratingsStatus: document.getElementById('ratingsStatus'),
    statsGrid: document.getElementById('statsGrid'),
    searchInput: document.getElementById('searchInput'),
    decisionFilter: document.getElementById('decisionFilter'),
    flaggedOnly: document.getElementById('flaggedOnly'),
    queueCount: document.getElementById('queueCount'),
    replayList: document.getElementById('replayList'),
    viewerTitle: document.getElementById('viewerTitle'),
    viewerSubtitle: document.getElementById('viewerSubtitle'),
    prevReplayButton: document.getElementById('prevReplayButton'),
    nextReplayButton: document.getElementById('nextReplayButton'),
    clipPlayer: document.getElementById('clipPlayer'),
    videoEmpty: document.getElementById('videoEmpty'),
    viewerTags: document.getElementById('viewerTags'),
    metaGrid: document.getElementById('metaGrid'),
    perturbationTable: document.getElementById('perturbationTable'),
    decisionInput: document.getElementById('decisionInput'),
    notesInput: document.getElementById('notesInput'),
    saveReplayRatingButton: document.getElementById('saveReplayRatingButton'),
    clearReplayRatingButton: document.getElementById('clearReplayRatingButton'),
    botSummary: document.getElementById('botSummary')
  };

  const scoreInputs = ['fun', 'fairness', 'skillExpression', 'pace', 'exploitRisk'].reduce((accumulator, key) => {
    accumulator[key] = {
      input: document.getElementById(key + 'Input'),
      output: document.getElementById(key + 'Value')
    };
    return accumulator;
  }, {});

  const state = {
    manifest: [],
    filteredManifest: [],
    selectedReplayId: null,
    ratings: loadRatingsFromStorage(),
    clipOverrides: new Map(),
    clipObjectUrls: []
  };

  function normalizeSlashes(value) {
    return String(value || '').replace(/\\/g, '/');
  }

  function baseName(value) {
    const normalized = normalizeSlashes(value);
    const parts = normalized.split('/');
    return parts[parts.length - 1] || normalized;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeDecision(value) {
    return value === 'accept' || value === 'watch' || value === 'reject' ? value : 'watch';
  }

  function normalizeScore(value, allowZero) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return allowZero ? 1 : 3;
    return clamp(Math.round(numeric), allowZero ? 0 : 1, 5);
  }

  function normalizeRating(item) {
    if (!item || !item.replayId) return null;
    const scores = item.scores || {};
    return {
      replayId: item.replayId,
      botIds: Array.isArray(item.botIds) ? item.botIds.filter(Boolean) : [],
      decision: normalizeDecision(item.decision),
      scores: {
        fun: normalizeScore(item.fun != null ? item.fun : scores.fun, false),
        fairness: normalizeScore(item.fairness != null ? item.fairness : scores.fairness, false),
        skillExpression: normalizeScore(item.skillExpression != null ? item.skillExpression : scores.skillExpression, false),
        pace: normalizeScore(item.pace != null ? item.pace : scores.pace, false),
        exploitRisk: normalizeScore(item.exploitRisk != null ? item.exploitRisk : scores.exploitRisk, true)
      },
      notes: typeof item.notes === 'string' ? item.notes : '',
      updatedAt: item.updatedAt || new Date().toISOString()
    };
  }

  function loadRatingsFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Map();
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed.items) ? parsed.items : [];
      return new Map(items.map((item) => {
        const normalized = normalizeRating(item);
        return normalized ? [normalized.replayId, normalized] : null;
      }).filter(Boolean));
    } catch (error) {
      console.warn('Unable to load cached ratings.', error);
      return new Map();
    }
  }

  function persistRatings() {
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      items: Array.from(state.ratings.values()).sort((a, b) => a.replayId.localeCompare(b.replayId))
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    elements.ratingsStatus.textContent = state.ratings.size
      ? state.ratings.size + ' ratings cached locally'
      : 'Local cache ready';
  }

  function buildDefaultRating(entry) {
    return {
      replayId: entry.replayId,
      botIds: Array.isArray(entry.botIds) ? entry.botIds.slice() : [],
      decision: normalizeDecision(entry.agentDecision),
      scores: {
        fun: 3,
        fairness: 3,
        skillExpression: 3,
        pace: 3,
        exploitRisk: entry.heuristicFlags && entry.heuristicFlags.length ? 2 : 1
      },
      notes: '',
      updatedAt: null
    };
  }

  function getCurrentEntry() {
    return state.manifest.find((entry) => entry.replayId === state.selectedReplayId) || null;
  }

  function getCurrentRating(entry) {
    return state.ratings.get(entry.replayId) || buildDefaultRating(entry);
  }

  function hydrateEntry(entry) {
    const normalized = { ...entry };
    normalized.botIds = Array.isArray(entry.botIds) ? entry.botIds : [];
    normalized.heuristicFlags = Array.isArray(entry.heuristicFlags) ? entry.heuristicFlags : [];
    normalized.agentDecision = normalizeDecision(entry.agentDecision);
    normalized.clipFileName = entry.clipFileName || baseName(entry.clipRelativePath || entry.clipPath || '');
    normalized.clipRelativePath = normalizeSlashes(entry.clipRelativePath || ('reports/clips/' + normalized.clipFileName));
    normalized.replayRelativePath = normalizeSlashes(entry.replayRelativePath || ('reports/replays/' + baseName(entry.replayPath || '')));
    if (!/^reports\//.test(normalized.clipRelativePath) && /^clips\//.test(normalized.clipRelativePath)) {
      normalized.clipRelativePath = 'reports/' + normalized.clipRelativePath;
    }
    if (!/^reports\//.test(normalized.replayRelativePath) && /^replays\//.test(normalized.replayRelativePath)) {
      normalized.replayRelativePath = 'reports/' + normalized.replayRelativePath;
    }
    normalized.perturbationResults = entry.perturbationResults || {};
    normalized.clipExists = !!entry.clipExists;
    if (entry.humanRating && !state.ratings.has(entry.replayId)) {
      const imported = normalizeRating(entry.humanRating);
      if (imported) state.ratings.set(imported.replayId, imported);
    }
    return normalized;
  }

  function loadManifestPayload(payload, sourceLabel) {
    const items = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
    state.manifest = items.map(hydrateEntry);
    state.filteredManifest = state.manifest.slice();
    state.selectedReplayId = state.manifest[0] ? state.manifest[0].replayId : null;
    elements.manifestStatus.textContent = state.manifest.length
      ? state.manifest.length + ' replays loaded from ' + sourceLabel
      : 'Manifest loaded with no items';
    persistRatings();
    render();
  }

  function loadRatingsPayload(payload, sourceLabel) {
    const items = Array.isArray(payload) ? payload : Array.isArray(payload.items) ? payload.items : [];
    let importedCount = 0;
    for (const item of items) {
      const normalized = normalizeRating(item);
      if (!normalized) continue;
      state.ratings.set(normalized.replayId, normalized);
      importedCount += 1;
    }
    persistRatings();
    elements.ratingsStatus.textContent = importedCount
      ? 'Imported ' + importedCount + ' ratings from ' + sourceLabel
      : 'No ratings found in ' + sourceLabel;
    render();
  }

  async function readJsonFile(file) {
    const text = await file.text();
    return JSON.parse(text);
  }

  function resolveClipSource(entry) {
    if (!entry) return '';
    if (state.clipOverrides.has(entry.clipFileName)) {
      return state.clipOverrides.get(entry.clipFileName);
    }
    return encodeURI('./' + normalizeSlashes(entry.clipRelativePath).replace(/^\.\//, ''));
  }

  function computeStats() {
    const rated = state.manifest.filter((entry) => state.ratings.has(entry.replayId));
    const rejected = rated.filter((entry) => state.ratings.get(entry.replayId).decision === 'reject');
    const flagged = state.manifest.filter((entry) => entry.heuristicFlags.length);
    return [
      { label: 'Replays', value: String(state.manifest.length) },
      { label: 'Rated', value: String(rated.length) },
      { label: 'Rejected', value: String(rejected.length) },
      { label: 'Flagged', value: String(flagged.length) }
    ];
  }

  function renderStats() {
    const stats = state.manifest.length ? computeStats() : EMPTY_STATS;
    elements.statsGrid.innerHTML = stats.map((stat) => (
      '<div class="stat-card"><span class="muted">' + escapeHtml(stat.label) + '</span><strong>' + escapeHtml(stat.value) + '</strong></div>'
    )).join('');
  }

  function applyFilters() {
    const query = elements.searchInput.value.trim().toLowerCase();
    const decisionFilter = elements.decisionFilter.value;
    const flaggedOnly = elements.flaggedOnly.checked;

    state.filteredManifest = state.manifest.filter((entry) => {
      const rating = state.ratings.get(entry.replayId);
      const haystack = [entry.replayId].concat(entry.botIds || []).join(' ').toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (flaggedOnly && !entry.heuristicFlags.length) return false;
      if (decisionFilter === 'unrated' && rating) return false;
      if (decisionFilter !== 'all' && decisionFilter !== 'unrated') {
        if (!rating || rating.decision !== decisionFilter) return false;
      }
      return true;
    });

    if (!state.filteredManifest.some((entry) => entry.replayId === state.selectedReplayId)) {
      state.selectedReplayId = state.filteredManifest[0] ? state.filteredManifest[0].replayId : null;
    }
  }

  function renderReplayList() {
    applyFilters();
    elements.queueCount.textContent = state.filteredManifest.length + ' items';
    if (!state.filteredManifest.length) {
      elements.replayList.innerHTML = '<div class="empty-state">No replays match the current filters.</div>';
      return;
    }

    elements.replayList.innerHTML = state.filteredManifest.map((entry) => {
      const rating = state.ratings.get(entry.replayId);
      const tags = [];
      tags.push(
        '<span class="tag ' + (entry.heuristicFlags.length ? 'flag' : 'good') + '">' +
          escapeHtml(entry.heuristicFlags.length ? entry.heuristicFlags.join(', ') : 'clean heuristics') +
        '</span>'
      );
      tags.push('<span class="tag">' + escapeHtml(rating ? rating.decision.toUpperCase() : 'UNRATED') + '</span>');
      if (entry.clipExists) tags.push('<span class="tag">clip ready</span>');
      return (
        '<button type="button" data-replay-id="' + escapeHtml(entry.replayId) + '"' +
          (entry.replayId === state.selectedReplayId ? ' class="is-active"' : '') + '>' +
          '<div class="replay-title">' + escapeHtml(entry.replayId) + '</div>' +
          '<div class="tag-row">' + tags.join('') + '</div>' +
        '</button>'
      );
    }).join('');

    elements.replayList.querySelectorAll('button[data-replay-id]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedReplayId = button.getAttribute('data-replay-id');
        render();
      });
    });
  }

  function renderMeta(entry) {
    const items = [
      ['Bots', entry.botIds.join(' vs ') || 'Unknown'],
      ['Replay id', entry.replayId],
      ['Seed', entry.seed],
      ['Config hash', entry.configHash],
      ['Agent decision', entry.agentDecision],
      ['Clip path', entry.clipRelativePath],
      ['Replay bundle', entry.replayRelativePath],
      ['Clip status', entry.clipExists ? 'Rendered' : 'Missing']
    ];

    elements.metaGrid.innerHTML = items.map((item) => (
      '<div><dt>' + escapeHtml(item[0]) + '</dt><dd>' + escapeHtml(item[1]) + '</dd></div>'
    )).join('');
  }

  function renderPerturbations(entry) {
    const rows = [
      ['Seed +1', entry.perturbationResults.plusSeed],
      ['+1 decision tick', entry.perturbationResults.delayed]
    ];

    elements.perturbationTable.innerHTML = rows.map((row) => {
      const label = row[0];
      const data = row[1];
      if (!data) {
        return '<tr><td>' + escapeHtml(label) + '</td><td colspan="4" class="muted">No data</td></tr>';
      }
      return (
        '<tr>' +
          '<td>' + escapeHtml(label) + '</td>' +
          '<td>' + escapeHtml(data.leftScore + ' - ' + data.rightScore) + '</td>' +
          '<td>' + escapeHtml(data.tick) + '</td>' +
          '<td>' + escapeHtml(Number(data.maxBallSpeed || 0).toFixed(2)) + '</td>' +
          '<td><code>' + escapeHtml(data.hash || '') + '</code></td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderTags(entry) {
    const tags = [];
    if (entry.botIds[0]) tags.push('<span class="tag">' + escapeHtml(entry.botIds[0]) + '</span>');
    if (entry.botIds[1]) tags.push('<span class="tag">' + escapeHtml(entry.botIds[1]) + '</span>');
    tags.push('<span class="tag ' + (entry.clipExists ? 'good' : '') + '">' + escapeHtml(entry.clipExists ? 'clip present' : 'clip missing') + '</span>');
    if (entry.heuristicFlags.length) {
      entry.heuristicFlags.forEach((flag) => {
        tags.push('<span class="tag flag">' + escapeHtml(flag) + '</span>');
      });
    }
    elements.viewerTags.innerHTML = tags.join('');
  }

  function renderVideo(entry) {
    const source = resolveClipSource(entry);
    if (!source) {
      elements.clipPlayer.removeAttribute('src');
      elements.clipPlayer.load();
      elements.videoEmpty.style.display = 'grid';
      elements.videoEmpty.textContent = 'No clip source is available for this replay.';
      return;
    }

    if (elements.clipPlayer.getAttribute('src') !== source) {
      elements.clipPlayer.src = source;
      elements.clipPlayer.load();
    }
    elements.videoEmpty.style.display = 'none';
  }

  function renderRatingForm(entry) {
    const rating = getCurrentRating(entry);
    Object.keys(scoreInputs).forEach((key) => {
      scoreInputs[key].input.value = rating.scores[key];
      scoreInputs[key].output.value = rating.scores[key];
    });
    elements.decisionInput.value = rating.decision;
    elements.notesInput.value = rating.notes || '';
  }

  function collectFormRating(entry) {
    return {
      replayId: entry.replayId,
      botIds: Array.isArray(entry.botIds) ? entry.botIds.slice() : [],
      decision: normalizeDecision(elements.decisionInput.value),
      scores: {
        fun: normalizeScore(scoreInputs.fun.input.value, false),
        fairness: normalizeScore(scoreInputs.fairness.input.value, false),
        skillExpression: normalizeScore(scoreInputs.skillExpression.input.value, false),
        pace: normalizeScore(scoreInputs.pace.input.value, false),
        exploitRisk: normalizeScore(scoreInputs.exploitRisk.input.value, true)
      },
      notes: elements.notesInput.value.trim(),
      updatedAt: new Date().toISOString()
    };
  }

  function saveCurrentRating() {
    const entry = getCurrentEntry();
    if (!entry) return;
    state.ratings.set(entry.replayId, collectFormRating(entry));
    persistRatings();
    render();
  }

  function clearCurrentRating() {
    const entry = getCurrentEntry();
    if (!entry) return;
    state.ratings.delete(entry.replayId);
    persistRatings();
    render();
  }

  function buildRatingsExport() {
    return {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      source: 'replay-review-workbench',
      items: Array.from(state.ratings.values()).sort((a, b) => a.replayId.localeCompare(b.replayId))
    };
  }

  function downloadText(fileName, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function saveRatingsToFile() {
    const text = JSON.stringify(buildRatingsExport(), null, 2);
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'review-ratings.json',
          types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        elements.ratingsStatus.textContent = 'Saved ratings to file';
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
        console.warn('File picker save failed. Falling back to download.', error);
      }
    }
    downloadText('review-ratings.json', text);
  }

  function buildBotSummaryRows() {
    const summaryByBot = new Map();
    for (const rating of state.ratings.values()) {
      for (const botId of rating.botIds || []) {
        if (!botId) continue;
        const row = summaryByBot.get(botId) || {
          botId,
          count: 0,
          rejectCount: 0,
          fun: 0,
          fairness: 0,
          skillExpression: 0,
          pace: 0,
          exploitRisk: 0
        };
        row.count += 1;
        if (rating.decision === 'reject') row.rejectCount += 1;
        row.fun += rating.scores.fun;
        row.fairness += rating.scores.fairness;
        row.skillExpression += rating.scores.skillExpression;
        row.pace += rating.scores.pace;
        row.exploitRisk += rating.scores.exploitRisk;
        summaryByBot.set(botId, row);
      }
    }

    return Array.from(summaryByBot.values()).map((row) => ({
      botId: row.botId,
      count: row.count,
      rejectCount: row.rejectCount,
      fun: (row.fun / row.count).toFixed(2),
      fairness: (row.fairness / row.count).toFixed(2),
      skillExpression: (row.skillExpression / row.count).toFixed(2),
      pace: (row.pace / row.count).toFixed(2),
      exploitRisk: (row.exploitRisk / row.count).toFixed(2)
    })).sort((a, b) => {
      if (b.rejectCount !== a.rejectCount) return b.rejectCount - a.rejectCount;
      return Number(b.exploitRisk) - Number(a.exploitRisk);
    });
  }

  function renderBotSummary() {
    const rows = buildBotSummaryRows();
    if (!rows.length) {
      elements.botSummary.innerHTML = '<div class="empty-state">Bot-level review stats appear here after you save ratings.</div>';
      return;
    }

    elements.botSummary.innerHTML =
      '<table><thead><tr><th>Bot</th><th>Reviews</th><th>Rejects</th><th>Fun</th><th>Fair</th><th>Skill</th><th>Pace</th><th>Risk</th></tr></thead><tbody>' +
      rows.map((row) => (
        '<tr>' +
          '<td>' + escapeHtml(row.botId) + '</td>' +
          '<td>' + escapeHtml(row.count) + '</td>' +
          '<td>' + escapeHtml(row.rejectCount) + '</td>' +
          '<td>' + escapeHtml(row.fun) + '</td>' +
          '<td>' + escapeHtml(row.fairness) + '</td>' +
          '<td>' + escapeHtml(row.skillExpression) + '</td>' +
          '<td>' + escapeHtml(row.pace) + '</td>' +
          '<td>' + escapeHtml(row.exploitRisk) + '</td>' +
        '</tr>'
      )).join('') +
      '</tbody></table>';
  }

  function renderEmptySelection() {
    elements.viewerTitle.textContent = 'No replay selected';
    elements.viewerSubtitle.textContent = state.manifest.length
      ? 'Adjust the filters or choose a replay from the queue.'
      : 'Load a replay manifest from tools/reports/review-manifest.json to begin.';
    elements.metaGrid.innerHTML = '<div class="empty-state">Replay metadata will appear here once a manifest is loaded.</div>';
    elements.perturbationTable.innerHTML = '<tr><td colspan="5" class="muted">No perturbation data loaded.</td></tr>';
    elements.viewerTags.innerHTML = '';
    elements.videoEmpty.style.display = 'grid';
    elements.videoEmpty.textContent = 'No clip loaded yet. If the player stays empty after choosing a replay, load the clip folder or render the replay clip first.';
    elements.clipPlayer.removeAttribute('src');
    elements.clipPlayer.load();
  }

  function render() {
    renderStats();
    renderReplayList();
    renderBotSummary();

    const entry = getCurrentEntry();
    elements.prevReplayButton.disabled = !state.filteredManifest.length;
    elements.nextReplayButton.disabled = !state.filteredManifest.length;
    if (!entry) {
      renderEmptySelection();
      return;
    }

    elements.viewerTitle.textContent = entry.replayId;
    elements.viewerSubtitle.textContent = (entry.botIds.join(' vs ') || 'Unknown matchup') + ' | seed ' + entry.seed;
    renderTags(entry);
    renderMeta(entry);
    renderPerturbations(entry);
    renderVideo(entry);
    renderRatingForm(entry);
  }

  function stepSelection(direction) {
    if (!state.filteredManifest.length) return;
    const currentIndex = Math.max(0, state.filteredManifest.findIndex((entry) => entry.replayId === state.selectedReplayId));
    const nextIndex = (currentIndex + direction + state.filteredManifest.length) % state.filteredManifest.length;
    state.selectedReplayId = state.filteredManifest[nextIndex].replayId;
    render();
  }

  function updateScorePreview(key) {
    scoreInputs[key].output.value = scoreInputs[key].input.value;
  }

  async function loadRepoDefaults() {
    try {
      const [manifestResponse, ratingsResponse] = await Promise.allSettled([
        fetch('./reports/review-manifest.json'),
        fetch('./reports/review-ratings.json')
      ]);

      if (manifestResponse.status === 'fulfilled' && manifestResponse.value.ok) {
        loadManifestPayload(await manifestResponse.value.json(), 'reports/review-manifest.json');
      } else {
        throw new Error('Manifest fetch failed. Use the file picker if you opened this page directly from disk.');
      }

      if (ratingsResponse.status === 'fulfilled' && ratingsResponse.value.ok) {
        loadRatingsPayload(await ratingsResponse.value.json(), 'reports/review-ratings.json');
      }
    } catch (error) {
      elements.manifestStatus.textContent = 'Repo auto-load failed. Use the file pickers.';
      console.warn(error);
    }
  }

  function loadClipOverrides(fileList) {
    state.clipObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    state.clipObjectUrls = [];
    state.clipOverrides.clear();

    Array.from(fileList || []).forEach((file) => {
      const url = URL.createObjectURL(file);
      state.clipObjectUrls.push(url);
      state.clipOverrides.set(file.name, url);
    });

    elements.clipsStatus.textContent = state.clipOverrides.size
      ? 'Loaded ' + state.clipOverrides.size + ' clip files'
      : 'Using repo-relative clips';
    render();
  }

  elements.manifestInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    loadManifestPayload(await readJsonFile(file), file.name);
  });

  elements.ratingsInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    loadRatingsPayload(await readJsonFile(file), file.name);
  });

  elements.clipsInput.addEventListener('change', (event) => {
    loadClipOverrides(event.target.files);
  });

  elements.repoButton.addEventListener('click', loadRepoDefaults);
  elements.saveButton.addEventListener('click', saveRatingsToFile);
  elements.downloadButton.addEventListener('click', () => {
    downloadText('review-ratings.json', JSON.stringify(buildRatingsExport(), null, 2));
  });
  elements.searchInput.addEventListener('input', render);
  elements.decisionFilter.addEventListener('change', render);
  elements.flaggedOnly.addEventListener('change', render);
  elements.prevReplayButton.addEventListener('click', () => stepSelection(-1));
  elements.nextReplayButton.addEventListener('click', () => stepSelection(1));
  elements.saveReplayRatingButton.addEventListener('click', saveCurrentRating);
  elements.clearReplayRatingButton.addEventListener('click', clearCurrentRating);

  elements.clipPlayer.addEventListener('error', () => {
    const entry = getCurrentEntry();
    elements.videoEmpty.style.display = 'grid';
    elements.videoEmpty.textContent = entry
      ? 'Unable to load ' + entry.clipRelativePath + '. Load the clip folder or render that replay clip.'
      : 'Unable to load the clip.';
  });

  elements.clipPlayer.addEventListener('loadeddata', () => {
    elements.videoEmpty.style.display = 'none';
  });

  Object.keys(scoreInputs).forEach((key) => {
    scoreInputs[key].input.addEventListener('input', () => updateScorePreview(key));
  });

  document.addEventListener('keydown', (event) => {
    const tagName = event.target && event.target.tagName;
    if (tagName && (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT')) return;
    if (event.key === 'ArrowLeft') stepSelection(-1);
    if (event.key === 'ArrowRight') stepSelection(1);
  });

  persistRatings();
  render();
})();
