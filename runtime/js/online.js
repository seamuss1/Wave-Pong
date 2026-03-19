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
    const fetchImpl = options.fetch || ((windowRef && windowRef.fetch) ? windowRef.fetch.bind(windowRef) : null);
    const WebSocketImpl = options.WebSocket || (windowRef && windowRef.WebSocket);
    const storage = options.storage || (windowRef && windowRef.localStorage) || null;
    const sessionKey = 'wavePongOnlineSessionV1';
    const emitter = createEmitter();
    const maxBatchFrames = ((multiplayer.netcode || {}).maxInputBatchFrames) || 12;
    const reconnectConfig = (multiplayer && multiplayer.reconnect) || {};
    const state = {
      enabled: !!(env && env.enabled && fetchImpl && WebSocketImpl),
      session: null,
      controlSocket: null,
      matchSocket: null,
      controlConnected: false,
      queue: null,
      statusText: env && env.enabled ? 'Online ready.' : 'Online disabled. Configure runtime/js/runtime-env.js or use api/controlWs query params to enable it.',
      currentMatch: null,
      localSide: null,
      remoteSide: null,
      remotePredictedAction: { moveAxis: 0, fire: false },
      pendingInputs: new Map(),
      lastQueuedTick: -1,
      nextSeq: 1,
      lobbyMessages: [],
      matchMessages: [],
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
        currentMatch: state.currentMatch,
        lobbyMessages: state.lobbyMessages.slice(-20),
        matchMessages: state.matchMessages.slice(-20)
      };
    }

    function applyAuthoritativeSnapshot(payload) {
      const validation = protocol.validateSnapshot(payload);
      if (!validation.ok) return;
      const snapshot = validation.value;
      if (!snapshot.stateBlob || !state.currentMatch || !runtime) return;
      state.remotePredictedAction = snapshot.lastActions && snapshot.lastActions[state.remoteSide]
        ? snapshot.lastActions[state.remoteSide]
        : state.remotePredictedAction;
      const stateBlob = engineApi.deserializeStateBlob(snapshot.stateBlob);
      const pendingTicks = Array.from(state.pendingInputs.keys()).filter((tick) => tick > snapshot.serverTick).sort((a, b) => a - b);
      runtime.setLiveInputEnabled(false);
      runtime.restoreSimulation(stateBlob);
      for (const [tick] of Array.from(state.pendingInputs.entries())) {
        if (tick <= snapshot.serverTick) {
          state.pendingInputs.delete(tick);
        }
      }
      for (const tick of pendingTicks) {
        runtime.queueInput(state.localSide, tick, state.pendingInputs.get(tick));
        runtime.queueInput(state.remoteSide, tick, state.remotePredictedAction);
      }
      if (pendingTicks.length) {
        runtime.stepSimulation(pendingTicks[pendingTicks.length - 1] - runtime.state.tick);
      }
      runtime.setLiveInputEnabled(true);
    }

    function buildRuntimeInputProvider() {
      return function onRuntimeInput(context) {
        if (!state.currentMatch) return context.defaultAction;
        if (context.side === state.localSide) {
          const action = protocol.normalizeActionFrame(context.defaultAction);
          if (!state.pendingInputs.has(context.tick)) {
            state.pendingInputs.set(context.tick, action);
            state.lastQueuedTick = Math.max(state.lastQueuedTick, context.tick);
            if (state.matchSocket && state.matchSocket.readyState === WebSocketImpl.OPEN) {
              state.matchSocket.send(protocol.encodeMessage('match.input_batch', {
                matchId: state.currentMatch.matchId,
                seq: state.nextSeq++,
                startTick: context.tick,
                frames: [action]
              }));
            }
          }
          return action;
        }
        return state.remotePredictedAction;
      };
    }

    function ensureRuntimeForMatch(matchInfo, startPayload) {
      const playlist = multiplayer.getPlaylist(matchInfo.playlistId);
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
      if (startPayload && startPayload.snapshot) {
        applyAuthoritativeSnapshot(startPayload.snapshot);
      }
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
        region: state.currentMatch.region,
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
      const reconnectWindowSeconds = reconnectConfig.graceSeconds || reconnectConfig.rankedForfeitSeconds || 15;
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
          region: foundPayload.region,
          opponent: foundPayload.opponent
        };
        state.localSide = foundPayload.side;
        state.remoteSide = foundPayload.side === 'left' ? 'right' : 'left';
        state.remotePredictedAction = { moveAxis: 0, fire: false };
        state.pendingInputs.clear();
        state.lastQueuedTick = -1;
        state.matchMessages = [];
        state.matchReconnectAttempts = 0;
      }
      clearMatchReconnectTimer();
      if (state.matchSocket) {
        closeMatchSocket(true);
      }
      const socket = new WebSocketImpl(foundPayload.workerUrl || env.workerWsUrl);
      state.intentionalMatchSocketClose = false;
      state.matchSocket = socket;
      setStatus(connectOptions.resume ? `Reconnecting to ${foundPayload.playlistId} match...` : `Connecting to ${foundPayload.playlistId} match...`);

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
          const leftName = foundPayload.side === 'left' ? (state.session && state.session.player && state.session.player.displayName) : foundPayload.opponent.displayName;
          const rightName = foundPayload.side === 'right' ? (state.session && state.session.player && state.session.player.displayName) : foundPayload.opponent.displayName;
          ensureRuntimeForMatch({
            matchId: foundPayload.matchId,
            playlistId: foundPayload.playlistId,
            region: foundPayload.region,
            opponentLabel: foundPayload.opponent.displayName,
            leftName,
            rightName
          }, message.payload);
          setStatus(`Live in ${foundPayload.playlistId}.`);
        } else if (message.type === 'match.snapshot' || message.type === 'match.correction') {
          applyAuthoritativeSnapshot(message.payload);
        } else if (message.type === 'match.result') {
          setStatus(`Match complete: ${message.payload.reason}.`);
          emitter.emit('match.result', message.payload);
          clearMatchReconnectTimer();
          state.currentMatch = null;
          state.matchReconnectAttempts = 0;
          runtime.setInputProvider(null);
        } else if (message.type === 'chat.message') {
          state.matchMessages.push(message.payload);
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
            connectMatchSocket(message.payload);
            emitter.emit('state', snapshotState());
            return;
          }
          if (message.type === 'chat.message') {
            state.lobbyMessages.push(message.payload);
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
        throw new Error('Online services are disabled for this build.');
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
        setStatus('Control plane connected.');
      },
      async upgradeAccount(displayName) {
        await ensureGuestSession(displayName);
        const payload = await jsonFetch(fetchImpl, `${env.apiBaseUrl}/auth/upgrade`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${state.session.accessToken}`
          },
          body: JSON.stringify({
            displayName,
            method: 'local-dev'
          })
        });
        state.session = payload;
        persistSession();
        emitter.emit('state', snapshotState());
      },
      async joinQueue(payload) {
        await ensureGuestSession(payload.displayName);
        await connectControlSocket();
        const response = await jsonFetch(fetchImpl, `${env.apiBaseUrl}/queue/join`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${state.session.accessToken}`
          },
          body: JSON.stringify({
            playlistId: payload.playlistId,
            region: payload.region
          })
        });
        state.queue = response.queue;
        setStatus(`Queued for ${payload.playlistId} in ${payload.region}.`);
        emitter.emit('state', snapshotState());
      },
      async leaveQueue() {
        if (!state.session) return;
        const payload = state.queue || {};
        const response = await jsonFetch(fetchImpl, `${env.apiBaseUrl}/queue/leave`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${state.session.accessToken}`
          },
          body: JSON.stringify({
            playlistId: payload.playlistId,
            region: payload.region
          })
        });
        state.queue = response.queue;
        setStatus('Queue left.');
        emitter.emit('state', snapshotState());
      },
      sendLobbyChat(payload) {
        if (!state.controlSocket || state.controlSocket.readyState !== WebSocketImpl.OPEN) {
          throw new Error('Control socket is not connected.');
        }
        state.controlSocket.send(protocol.encodeMessage('chat.send', payload));
      },
      sendMatchQuickChat(quickChatId) {
        if (!state.matchSocket || state.matchSocket.readyState !== WebSocketImpl.OPEN) return;
        state.matchSocket.send(protocol.encodeMessage('chat.send', {
          kind: 'quick',
          quickChatId
        }));
      },
      _debugState: state
    };
  }

  return {
    createOnlineService
  };
});
