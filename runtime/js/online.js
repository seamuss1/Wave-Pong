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
    const state = {
      enabled: !!(env && env.enabled && fetchImpl && WebSocketImpl),
      session: null,
      controlSocket: null,
      matchSocket: null,
      controlConnected: false,
      queue: null,
      statusText: env && env.enabled ? 'Online ready.' : 'Online disabled. Set api/controlWs query params to enable it.',
      currentMatch: null,
      localSide: null,
      remoteSide: null,
      remotePredictedAction: { moveAxis: 0, fire: false },
      pendingInputs: new Map(),
      lastQueuedTick: -1,
      nextSeq: 1,
      lobbyMessages: [],
      matchMessages: []
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

    function connectMatchSocket(foundPayload) {
      if (!WebSocketImpl) {
        throw new Error('WebSocket is not available in this browser.');
      }
      if (state.matchSocket) {
        state.matchSocket.close();
      }
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
      const socket = new WebSocketImpl(foundPayload.workerUrl || env.workerWsUrl);
      state.matchSocket = socket;
      setStatus(`Connecting to ${foundPayload.playlistId} match...`);

      socket.addEventListener('open', () => {
        socket.send(protocol.encodeMessage('hello', {
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
          state.currentMatch = null;
          runtime.setInputProvider(null);
        } else if (message.type === 'chat.message') {
          state.matchMessages.push(message.payload);
          emitter.emit('state', snapshotState());
        } else if (message.type === 'error') {
          setStatus(message.payload.message || 'Match socket error.');
        }
      });

      socket.addEventListener('close', () => {
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
      if (!state.session || !state.session.accessToken) {
        return Promise.reject(new Error('No online session is available.'));
      }
      return new Promise((resolve, reject) => {
        const socket = new WebSocketImpl(normalizeSocketUrl(env.controlWsUrl));
        state.controlSocket = socket;
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
            resolve();
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
            setStatus(message.payload.message || 'Control socket error.');
          }
        });
        socket.addEventListener('close', () => {
          state.controlConnected = false;
          emitter.emit('state', snapshotState());
        });
        socket.addEventListener('error', () => {
          reject(new Error('Control websocket connection failed.'));
        });
      });
    }

    async function ensureGuestSession(displayName) {
      if (!state.enabled) {
        throw new Error('Online services are disabled for this build.');
      }
      if (state.session && state.session.accessToken) return state.session;
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
      }
    };
  }

  return {
    createOnlineService
  };
});
