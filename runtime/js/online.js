(function (root, factory) {
  const env = (typeof module === 'object' && module.exports)
    ? require('./env.js')
    : (root && root.WavePong && root.WavePong.ENV);
  const multiplayer = (typeof module === 'object' && module.exports)
    ? require('./shared/multiplayer.js')
    : (root && root.WavePong && root.WavePong.Multiplayer);
  const protocol = (typeof module === 'object' && module.exports)
    ? require('./shared/protocol.js')
    : (root && root.WavePong && root.WavePong.Protocol);
  const engineApi = (typeof module === 'object' && module.exports)
    ? require('./shared/engine.js')
    : (root && root.WavePong && root.WavePong.Engine);
  const api = factory(root, env, multiplayer, protocol, engineApi);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WavePong = root.WavePong || {};
    root.WavePong.Online = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, env, multiplayer, protocol, engineApi) {
  function createEmitter() {
    const listeners = new Map();
    return {
      on(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
        return () => listeners.get(type).delete(listener);
      },
      emit(type, payload) {
        if (!listeners.has(type)) return;
        for (const listener of listeners.get(type)) {
          listener(payload);
        }
      }
    };
  }

  function jsonFetch(fetchImpl, url, options) {
    return fetchImpl(url, options).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
      }
      return payload;
    });
  }

  function normalizeSocketUrl(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '');
  }

  function createOnlineService(options) {
    const runtime = options.runtime;
    const windowRef = options.window || (root && root.window) || root;
    const decorateLocalAction = typeof options.decorateLocalAction === 'function'
      ? options.decorateLocalAction
      : ((defaultAction) => defaultAction);
    const fetchImpl = options.fetch || ((windowRef && windowRef.fetch) ? windowRef.fetch.bind(windowRef) : null);
    const WebSocketImpl = options.WebSocket || (windowRef && windowRef.WebSocket);
    const storage = options.storage || (windowRef && windowRef.localStorage) || null;
    const sessionKey = 'wavePongOnlineSessionV1';
    const emitter = createEmitter();
    const reconnectConfig = (multiplayer && multiplayer.reconnect) || {};
    const netcodeConfig = (multiplayer && multiplayer.netcode) || {};
    // Batch this many input frames per websocket message (fire frames flush
    // immediately). At 120Hz a batch of 4 sends ~30 messages/sec instead of 120.
    const inputFlushFrames = Math.max(1, Math.min(
      Number(netcodeConfig.inputSendIntervalTicks) || 4,
      Number(netcodeConfig.maxInputBatchFrames) || 12
    ));
    // Keep the local sim ahead of the last authoritative snapshot so inputs
    // reach the server before the tick they are stamped for. This is the
    // starting lead; it adapts at runtime from the server-reported input margin.
    const initialLeadTicks = Math.max(2, Number(netcodeConfig.inputBufferTicks) || 4);
    const minLeadTicks = 2;
    const maxLeadTicks = 30; // 250ms at 120Hz; beyond this latency is the problem
    // Target window for how early our inputs should land at the server, in ticks.
    const marginLow = 1;
    const marginHigh = 7;
    const state = {
      enabled: !!(env && env.enabled && fetchImpl && WebSocketImpl),
      session: null,
      controlSocket: null,
      matchSocket: null,
      controlConnected: false,
      queue: null,
      statusText: env && env.enabled ? 'Ready.' : 'Online play is not configured for this build.',
      currentMatch: null,
      localSide: null,
      remoteSide: null,
      remotePredictedAction: { moveAxis: 0, fire: false, fireTier: null },
      pendingInputs: new Map(),
      lastQueuedTick: -1,
      outgoing: { startTick: -1, frames: [] },
      leadTicks: initialLeadTicks,
      lastLeadRaiseMs: 0,
      lastLeadLowerMs: 0,
      nextSeq: 1,
      pendingControlConnect: null,
      matchReconnectTimer: null,
      matchReconnectAttempts: 0,
      intentionalMatchSocketClose: false
    };

    function persistSession() {
      if (!storage) return;
      if (!state.session) {
        storage.removeItem(sessionKey);
        return;
      }
      storage.setItem(sessionKey, JSON.stringify(state.session));
    }

    function loadSession() {
      if (!storage) return null;
      try {
        return JSON.parse(storage.getItem(sessionKey) || 'null');
      } catch (error) {
        return null;
      }
    }

    function setStatus(text) {
      state.statusText = text;
      emitter.emit('state', snapshotState());
    }

    function clearSession() {
      state.session = null;
      state.controlConnected = false;
      state.queue = null;
      state.pendingControlConnect = null;
      if (state.controlSocket) {
        try {
          state.controlSocket.close();
        } catch (error) {
          /* noop */
        }
      }
      state.controlSocket = null;
      persistSession();
      emitter.emit('state', snapshotState());
    }

    function decodeTokenPayload(token) {
      const body = String(token || '').split('.')[0];
      if (!body) return null;
      try {
        const normalized = body.replace(/-/g, '+').replace(/_/g, '/');
        const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
        const decoded = (windowRef && typeof windowRef.atob === 'function')
          ? windowRef.atob(normalized + padding)
          : Buffer.from(normalized + padding, 'base64').toString('utf8');
        return JSON.parse(decoded);
      } catch (error) {
        return null;
      }
    }

    function hasFreshAccessToken(session) {
      if (!session || !session.accessToken) return false;
      const payload = decodeTokenPayload(session.accessToken);
      return !payload || !payload.exp || Date.now() < Number(payload.exp);
    }

    function clearMatchReconnectTimer() {
      if (!state.matchReconnectTimer) return;
      windowRef.clearTimeout(state.matchReconnectTimer);
      state.matchReconnectTimer = null;
    }

    function closeMatchSocket(intentional) {
      if (!state.matchSocket) return;
      state.intentionalMatchSocketClose = !!intentional;
      try {
        state.matchSocket.close();
      } catch (error) {
        /* noop */
      }
      state.matchSocket = null;
    }

    function snapshotState() {
      return {
        enabled: state.enabled,
        session: state.session,
        controlConnected: state.controlConnected,
        queue: state.queue,
        statusText: state.statusText,
        currentMatch: state.currentMatch
      };
    }

    function flushOutgoingInputs() {
      if (!state.outgoing.frames.length) return;
      if (state.currentMatch && state.matchSocket && state.matchSocket.readyState === WebSocketImpl.OPEN) {
        state.matchSocket.send(protocol.encodeMessage('match.input_batch', {
          matchId: state.currentMatch.matchId,
          seq: state.nextSeq++,
          startTick: state.outgoing.startTick,
          frames: state.outgoing.frames
        }));
      }
      state.outgoing = { startTick: -1, frames: [] };
    }

    function bufferOutgoingInput(tick, action) {
      const expectedTick = state.outgoing.startTick + state.outgoing.frames.length;
      if (state.outgoing.frames.length && tick !== expectedTick) {
        // Tick gap (countdown, reconnect, lead catch-up): frames must stay contiguous.
        flushOutgoingInputs();
      }
      if (!state.outgoing.frames.length) state.outgoing.startTick = tick;
      state.outgoing.frames.push(action);
      // Fire is latency-sensitive; movement can ride the batch cadence.
      if (action.fire || state.outgoing.frames.length >= inputFlushFrames) {
        flushOutgoingInputs();
      }
    }

    function prunePendingInputs(confirmedTick) {
      for (const tick of Array.from(state.pendingInputs.keys())) {
        if (tick <= confirmedTick) state.pendingInputs.delete(tick);
      }
      // Hard cap so a stalled snapshot stream can never grow this without bound.
      if (state.pendingInputs.size > 600) {
        const ticks = Array.from(state.pendingInputs.keys()).sort((a, b) => a - b);
        for (const tick of ticks.slice(0, ticks.length - 600)) {
          state.pendingInputs.delete(tick);
        }
      }
    }

    function applyAuthoritativeSnapshot(payload) {
      const validation = protocol.validateSnapshot(payload);
      if (!validation.ok) return;
      const snapshot = validation.value;
      if (!snapshot.stateBlob || !state.currentMatch || !runtime) return;
      const remoteAction = snapshot.lastActions && snapshot.lastActions[state.remoteSide];
      if (remoteAction) {
        // Predict remote movement only. Predicting fire would re-trigger the wave
        // on every predicted tick until the next snapshot corrects it.
        state.remotePredictedAction = {
          moveAxis: Number(remoteAction.moveAxis) || 0,
          fire: false,
          fireTier: null
        };
      }
      flushOutgoingInputs();
      adaptLeadTicks(snapshot);
      const stateBlob = engineApi.deserializeStateBlob(snapshot.stateBlob);
      prunePendingInputs(snapshot.serverTick);
      const pendingTicks = Array.from(state.pendingInputs.keys()).sort((a, b) => a - b);
      runtime.setLiveInputEnabled(false);
      if (typeof runtime.beginNetworkCorrection === 'function') runtime.beginNetworkCorrection();
      runtime.restoreSimulation(stateBlob);
      for (const tick of pendingTicks) {
        runtime.queueInput(state.localSide, tick, state.pendingInputs.get(tick));
        runtime.queueInput(state.remoteSide, tick, state.remotePredictedAction);
      }
      if (pendingTicks.length) {
        runtime.stepSimulation(pendingTicks[pendingTicks.length - 1] - runtime.state.tick);
      }
      // Keep the local sim ahead of the server so our inputs arrive before the
      // tick they are stamped for; when they do, the deterministic replay above
      // reproduces the server state exactly and no visible correction happens.
      // Big deficits (match start, reconnect, tab stall) are closed with a hard
      // fast-forward; small drift is closed by nudging the sim clock a few
      // percent, which is invisible, instead of stepping (which reads as jitter).
      const targetTick = snapshot.serverTick + Math.round(state.leadTicks);
      const behind = targetTick - runtime.state.tick;
      if (behind >= 10) {
        const lastLocal = state.pendingInputs.get(state.lastQueuedTick);
        const heldLocal = {
          moveAxis: lastLocal ? lastLocal.moveAxis : 0,
          fire: false,
          fireTier: null
        };
        for (let tick = runtime.state.tick + 1; tick <= targetTick; tick += 1) {
          if (!state.pendingInputs.has(tick)) state.pendingInputs.set(tick, heldLocal);
          runtime.queueInput(state.localSide, tick, state.pendingInputs.get(tick));
          runtime.queueInput(state.remoteSide, tick, state.remotePredictedAction);
        }
        state.lastQueuedTick = Math.max(state.lastQueuedTick, targetTick);
        runtime.stepSimulation(targetTick - runtime.state.tick);
        if (typeof runtime.setSimSpeed === 'function') runtime.setSimSpeed(1);
      } else if (typeof runtime.setSimSpeed === 'function') {
        runtime.setSimSpeed(1 + Math.max(-0.08, Math.min(0.12, behind * 0.02)));
      }
      if (typeof runtime.endNetworkCorrection === 'function') runtime.endNetworkCorrection();
      runtime.setLiveInputEnabled(true);
    }

    // Adaptive tick lead: the server echoes how early (positive) or late
    // (negative) our newest input batch landed. Late inputs are the direct
    // cause of own-paddle correction jitter, so react to lateness quickly and
    // give back excess lead slowly. Adjustments are throttled because margins
    // reflect batches sent a round trip ago.
    function adaptLeadTicks(snapshot) {
      const rawMargin = snapshot.inputMargin ? snapshot.inputMargin[state.localSide] : null;
      const margin = Number(rawMargin);
      if (rawMargin == null || !Number.isFinite(margin)) return;
      const now = Date.now();
      if (margin < marginLow && now - state.lastLeadRaiseMs > 300) {
        state.lastLeadRaiseMs = now;
        state.leadTicks = Math.min(maxLeadTicks, state.leadTicks + Math.min(4, marginLow - margin));
      } else if (margin > marginHigh && now - state.lastLeadLowerMs > 2000) {
        state.lastLeadLowerMs = now;
        state.leadTicks = Math.max(minLeadTicks, state.leadTicks - 1);
      }
    }

    function buildRuntimeInputProvider() {
      return function onRuntimeInput(context) {
        const decoratedDefaultAction = context.side === state.localSide
          ? decorateLocalAction(context.defaultAction, context)
          : context.defaultAction;
        if (!state.currentMatch) return decoratedDefaultAction;
        if (context.side === state.localSide) {
          if (state.pendingInputs.has(context.tick)) {
            return state.pendingInputs.get(context.tick);
          }
          const action = protocol.normalizeActionFrame(decoratedDefaultAction);
          state.pendingInputs.set(context.tick, action);
          state.lastQueuedTick = Math.max(state.lastQueuedTick, context.tick);
          bufferOutgoingInput(context.tick, action);
          return action;
        }
        return state.remotePredictedAction;
      };
    }

    function ensureRuntimeForMatch(matchInfo, startPayload) {
      const playlist = multiplayer.getPlaylist(matchInfo.playlistId) || multiplayer.getDefaultPlaylist();
      const playlistOptions = multiplayer.buildMatchRuntimeOptions(playlist, {
        skipCountdown: true,
        leftName: matchInfo.leftName,
        rightName: matchInfo.rightName,
        modeLabel: playlist.modeLabel,
        opponentLabel: matchInfo.opponentLabel
      });
      runtime.startMatch(playlistOptions);
      runtime.setInputProvider(buildRuntimeInputProvider());
      runtime.setLiveInputEnabled(true);
      if (typeof runtime.setLocalHumanSide === 'function') {
        runtime.setLocalHumanSide(state.localSide);
      }
      if (startPayload && startPayload.snapshot) {
        applyAuthoritativeSnapshot(startPayload.snapshot);
      }
      emitter.emit('match.started', {
        matchId: matchInfo.matchId,
        side: state.localSide,
        opponentLabel: matchInfo.opponentLabel
      });
    }

    async function reconnectCurrentMatch() {
      if (!state.currentMatch || !state.session || !state.session.accessToken || !fetchImpl) return;
      const response = await jsonFetch(fetchImpl, `${env.apiBaseUrl}/matches/${state.currentMatch.matchId}/reconnect`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${state.session.accessToken}`
        },
        body: JSON.stringify({})
      });
      connectMatchSocket({
        matchId: response.matchId,
        playlistId: state.currentMatch.playlistId,
        opponent: state.currentMatch.opponent,
        side: state.localSide,
        ticket: response.ticket,
        workerUrl: response.workerUrl || env.workerWsUrl
      }, {
        resume: true
      });
    }

    function scheduleMatchReconnect() {
      clearMatchReconnectTimer();
      if (!state.currentMatch || !state.session || !state.session.accessToken) return;
      const reconnectWindowSeconds = reconnectConfig.graceSeconds || 30;
      const maxAttempts = Math.max(1, Math.ceil((reconnectWindowSeconds * 1000) / 2000));
      if (state.matchReconnectAttempts >= maxAttempts) {
        setStatus('Match connection lost. Reconnect window expired.');
        return;
      }
      state.matchReconnectAttempts += 1;
      setStatus(`Match connection lost. Reconnecting (${state.matchReconnectAttempts}/${maxAttempts})...`);
      state.matchReconnectTimer = windowRef.setTimeout(async () => {
        try {
          await reconnectCurrentMatch();
        } catch (error) {
          setStatus(error && error.message ? error.message : 'Reconnect attempt failed.');
          scheduleMatchReconnect();
        }
      }, 2000);
    }

    function connectMatchSocket(foundPayload, options) {
      const connectOptions = options || {};
      if (!WebSocketImpl) {
        throw new Error('WebSocket is not available in this browser.');
      }
      if (!connectOptions.resume) {
        state.currentMatch = {
          matchId: foundPayload.matchId,
          playlistId: foundPayload.playlistId,
          opponent: foundPayload.opponent
        };
        state.localSide = foundPayload.side;
        state.remoteSide = foundPayload.side === 'left' ? 'right' : 'left';
        state.remotePredictedAction = { moveAxis: 0, fire: false, fireTier: null };
        state.pendingInputs.clear();
        state.lastQueuedTick = -1;
        state.outgoing = { startTick: -1, frames: [] };
        state.leadTicks = initialLeadTicks;
        state.lastLeadRaiseMs = 0;
        state.lastLeadLowerMs = 0;
        state.nextSeq = 1;
        state.matchReconnectAttempts = 0;
      }
      clearMatchReconnectTimer();
      if (state.matchSocket) {
        closeMatchSocket(true);
      }
      const socket = new WebSocketImpl(foundPayload.workerUrl || env.workerWsUrl);
      state.intentionalMatchSocketClose = false;
      state.matchSocket = socket;
      setStatus(connectOptions.resume ? 'Reconnecting to match...' : 'Opponent found. Connecting...');

      socket.addEventListener('open', () => {
        socket.send(protocol.encodeMessage(connectOptions.resume ? 'resume' : 'hello', {
          ticket: foundPayload.ticket
        }));
      });

      socket.addEventListener('message', (event) => {
        const message = protocol.parseMessage(event.data);
        if (message.type === 'match.ready') {
          socket.send(protocol.encodeMessage('match.accept', {
            matchId: foundPayload.matchId
          }));
        } else if (message.type === 'match.start') {
          const localName = state.session && state.session.player ? state.session.player.displayName : 'You';
          const opponentName = foundPayload.opponent ? foundPayload.opponent.displayName : 'Opponent';
          ensureRuntimeForMatch({
            matchId: foundPayload.matchId,
            playlistId: foundPayload.playlistId,
            opponentLabel: opponentName,
            leftName: foundPayload.side === 'left' ? localName : opponentName,
            rightName: foundPayload.side === 'right' ? localName : opponentName
          }, message.payload);
          setStatus(`Playing vs ${opponentName}.`);
        } else if (message.type === 'match.snapshot' || message.type === 'match.correction') {
          applyAuthoritativeSnapshot(message.payload);
        } else if (message.type === 'match.result') {
          setStatus(message.payload.reason === 'completed' ? 'Match complete.' : `Match over: ${message.payload.reason}.`);
          clearMatchReconnectTimer();
          state.currentMatch = null;
          state.matchReconnectAttempts = 0;
          state.pendingInputs.clear();
          state.outgoing = { startTick: -1, frames: [] };
          if (runtime && typeof runtime.setSimSpeed === 'function') runtime.setSimSpeed(1);
          closeMatchSocket(true);
          emitter.emit('match.result', message.payload);
          emitter.emit('state', snapshotState());
        } else if (message.type === 'error') {
          setStatus(message.payload.message || 'Match socket error.');
        }
      });

      socket.addEventListener('close', () => {
        state.matchSocket = null;
        if (!state.intentionalMatchSocketClose && state.currentMatch) {
          scheduleMatchReconnect();
        }
        state.intentionalMatchSocketClose = false;
        emitter.emit('state', snapshotState());
      });
    }

    function connectControlSocket() {
      if (!state.enabled) {
        return Promise.resolve();
      }
      if (state.controlSocket && state.controlConnected) {
        return Promise.resolve();
      }
      if (state.pendingControlConnect) {
        return state.pendingControlConnect;
      }
      if (!state.session || !state.session.accessToken) {
        return Promise.reject(new Error('No online session is available.'));
      }
      state.pendingControlConnect = new Promise((resolve, reject) => {
        const socket = new WebSocketImpl(normalizeSocketUrl(env.controlWsUrl));
        state.controlSocket = socket;
        let settled = false;
        function finishSuccess() {
          if (settled) return;
          settled = true;
          state.pendingControlConnect = null;
          resolve();
        }
        function finishError(error) {
          if (settled) return;
          settled = true;
          state.pendingControlConnect = null;
          state.controlConnected = false;
          state.controlSocket = null;
          reject(error);
        }
        socket.addEventListener('open', () => {
          socket.send(protocol.encodeMessage('hello', {
            accessToken: state.session.accessToken
          }));
        });
        socket.addEventListener('message', (event) => {
          const message = protocol.parseMessage(event.data);
          if (message.type === 'hello.ok') {
            state.controlConnected = true;
            state.session.player = message.payload.player;
            persistSession();
            emitter.emit('state', snapshotState());
            finishSuccess();
            return;
          }
          if (message.type === 'queue.state') {
            state.queue = message.payload;
            emitter.emit('state', snapshotState());
            return;
          }
          if (message.type === 'match.found') {
            state.queue = null;
            connectMatchSocket(message.payload);
            emitter.emit('state', snapshotState());
            return;
          }
          if (message.type === 'error') {
            const errorMessage = message.payload.message || 'Control socket error.';
            setStatus(errorMessage);
            if (!state.controlConnected) {
              if (/expired|token|access/i.test(errorMessage)) {
                clearSession();
              }
              try {
                socket.close();
              } catch (error) {
                /* noop */
              }
              finishError(new Error(errorMessage));
            }
          }
        });
        socket.addEventListener('close', () => {
          state.controlConnected = false;
          if (!settled) {
            finishError(new Error('Control websocket connection closed before authentication completed.'));
            return;
          }
          emitter.emit('state', snapshotState());
        });
        socket.addEventListener('error', () => {
          finishError(new Error('Control websocket connection failed.'));
        });
      });
      return state.pendingControlConnect;
    }

    async function ensureGuestSession(displayName) {
      if (!state.enabled) {
        throw new Error('Online play is not configured for this build.');
      }
      if (hasFreshAccessToken(state.session)) return state.session;
      if (state.session && !hasFreshAccessToken(state.session)) {
        clearSession();
      }
      if (!fetchImpl) {
        throw new Error('Fetch is not available in this browser.');
      }
      const payload = await jsonFetch(fetchImpl, `${env.apiBaseUrl}/auth/guest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName
        })
      });
      state.session = payload;
      persistSession();
      emitter.emit('state', snapshotState());
      return state.session;
    }

    state.session = loadSession();

    return {
      on: emitter.on,
      getState: snapshotState,
      async ensureConnected(displayName) {
        await ensureGuestSession(displayName);
        await connectControlSocket();
        setStatus('Connected.');
      },
      async joinQueue(payload) {
        const options = payload || {};
        await ensureGuestSession(options.displayName);
        await connectControlSocket();
        const response = await jsonFetch(fetchImpl, `${env.apiBaseUrl}/queue/join`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${state.session.accessToken}`
          },
          body: JSON.stringify({})
        });
        state.queue = response.queue;
        setStatus('Searching for an opponent...');
        emitter.emit('state', snapshotState());
      },
      async leaveQueue() {
        if (!state.session) return;
        const response = await jsonFetch(fetchImpl, `${env.apiBaseUrl}/queue/leave`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${state.session.accessToken}`
          },
          body: JSON.stringify({})
        });
        state.queue = response.queue;
        setStatus('Search cancelled.');
        emitter.emit('state', snapshotState());
      },
      _debugState: state
    };
  }

  return {
    createOnlineService
  };
});
