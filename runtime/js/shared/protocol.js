(function (root, factory) {
  const multiplayer = (typeof module === 'object' && module.exports)
    ? require('./multiplayer.js')
    : (root && root.WavePong && root.WavePong.Multiplayer);
  const api = factory(multiplayer);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WavePong = root.WavePong || {};
    root.WavePong.Protocol = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (multiplayer) {
  const CLIENT_WS_TYPES = [
    'hello',
    'resume',
    'queue.join',
    'queue.leave',
    'match.accept',
    'match.input_batch',
    'match.reconnect',
    'chat.send',
    'chat.report',
    'ping'
  ];
  const SERVER_WS_TYPES = [
    'hello.ok',
    'queue.state',
    'match.found',
    'match.ready',
    'match.start',
    'match.snapshot',
    'match.correction',
    'match.event',
    'match.result',
    'chat.message',
    'chat.moderation',
    'presence.update',
    'error'
  ];
  const WS_PATHS = {
    control: '/ws/control',
    match: '/ws/match'
  };
  const quickChatIds = new Set((multiplayer && multiplayer.quickChat || []).map((entry) => entry.id));

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);
    const next = {};
    for (const key of Object.keys(value)) next[key] = clone(value[key]);
    return next;
  }

  function normalizeActionFrame(frame) {
    const moveAxis = frame && Number.isFinite(Number(frame.moveAxis))
      ? Math.max(-1, Math.min(1, Math.round(Number(frame.moveAxis))))
      : 0;
    return {
      moveAxis,
      fire: !!(frame && frame.fire)
    };
  }

  function validateInputBatch(payload, options) {
    const limits = options || {};
    if (!isObject(payload)) return { ok: false, error: 'Input batch must be an object.' };
    if (typeof payload.matchId !== 'string' || !payload.matchId) return { ok: false, error: 'Input batch is missing matchId.' };
    if (!Number.isFinite(Number(payload.seq))) return { ok: false, error: 'Input batch is missing seq.' };
    if (!Number.isFinite(Number(payload.startTick))) return { ok: false, error: 'Input batch is missing startTick.' };
    if (!Array.isArray(payload.frames) || !payload.frames.length) return { ok: false, error: 'Input batch requires at least one frame.' };
    const maxFrames = Math.max(1, Number(limits.maxFrames) || (multiplayer && multiplayer.netcode && multiplayer.netcode.maxInputBatchFrames) || 12);
    if (payload.frames.length > maxFrames) return { ok: false, error: 'Input batch exceeds the maximum frame count.' };
    return {
      ok: true,
      value: {
        matchId: payload.matchId,
        seq: Math.max(0, Math.floor(Number(payload.seq))),
        startTick: Math.max(0, Math.floor(Number(payload.startTick))),
        frames: payload.frames.map(normalizeActionFrame)
      }
    };
  }

  function validateChatPayload(payload, options) {
    const moderation = (multiplayer && multiplayer.moderation) || {};
    const limits = options || {};
    const maxLength = Number(limits.maxLength) || moderation.lobbyMessageMaxLength || 280;
    if (!isObject(payload)) return { ok: false, error: 'Chat payload must be an object.' };
    if (payload.kind === 'quick') {
      if (typeof payload.quickChatId !== 'string' || !quickChatIds.has(payload.quickChatId)) {
        return { ok: false, error: 'Unknown quick chat message.' };
      }
      return { ok: true, value: { kind: 'quick', quickChatId: payload.quickChatId } };
    }
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) return { ok: false, error: 'Chat payload is missing text.' };
    if (text.length > maxLength) return { ok: false, error: 'Chat payload exceeds the maximum length.' };
    return { ok: true, value: { kind: 'free', text } };
  }

  function validateSnapshot(payload) {
    if (!isObject(payload)) return { ok: false, error: 'Snapshot payload must be an object.' };
    if (typeof payload.matchId !== 'string' || !payload.matchId) return { ok: false, error: 'Snapshot is missing matchId.' };
    if (!Number.isFinite(Number(payload.serverTick))) return { ok: false, error: 'Snapshot is missing serverTick.' };
    if (typeof payload.stateHash !== 'string' || !payload.stateHash) return { ok: false, error: 'Snapshot is missing stateHash.' };
    return {
      ok: true,
      value: {
        matchId: payload.matchId,
        serverTick: Math.max(0, Math.floor(Number(payload.serverTick))),
        ackSeq: isObject(payload.ackSeq) ? clone(payload.ackSeq) : {},
        stateHash: payload.stateHash,
        full: !!payload.full,
        scores: clone(payload.scores || {}),
        paddles: clone(payload.paddles || {}),
        balls: clone(payload.balls || []),
        waves: clone(payload.waves || []),
        powerups: clone(payload.powerups || []),
        timers: clone(payload.timers || {}),
        lastActions: clone(payload.lastActions || {}),
        stateBlob: payload.stateBlob || null
      }
    };
  }

  function encodeMessage(type, payload) {
    return JSON.stringify({ type, payload: payload || {} });
  }

  function parseMessage(raw) {
    const text = typeof raw === 'string' ? raw : String(raw || '');
    const parsed = JSON.parse(text);
    if (!isObject(parsed) || typeof parsed.type !== 'string') {
      throw new Error('Malformed websocket message.');
    }
    return {
      type: parsed.type,
      payload: isObject(parsed.payload) ? parsed.payload : {}
    };
  }

  function createError(code, message, details) {
    return {
      code,
      message,
      details: details ? clone(details) : undefined
    };
  }

  return {
    CLIENT_WS_TYPES,
    SERVER_WS_TYPES,
    WS_PATHS,
    normalizeActionFrame,
    validateInputBatch,
    validateChatPayload,
    validateSnapshot,
    encodeMessage,
    parseMessage,
    createError
  };
});
