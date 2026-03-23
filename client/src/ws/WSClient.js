// ── Constants ──────────────────────────────────────────────────────────────
const BACKOFF_BASE_MS  = 500;
const BACKOFF_MAX_MS   = 30_000;
const BACKOFF_JITTER   = 0.2;   // ±20%

// ── Helpers ────────────────────────────────────────────────────────────────

function jitter(ms) {
  const delta = ms * BACKOFF_JITTER;
  return ms + (Math.random() * 2 - 1) * delta;
}

function backoffMs(attempt) {
  const raw = BACKOFF_BASE_MS * Math.pow(2, attempt);
  return Math.min(jitter(raw), BACKOFF_MAX_MS);
}

// ── WSClient ───────────────────────────────────────────────────────────────

export class WSClient {
  /**
   * @param {string} sessionId
   * @param {string} token  – JWT, sent as ?token= query param
   * @param {string} [baseUrl]  – defaults to ws://localhost:4000
   */
  constructor(sessionId, token, baseUrl = 'ws://localhost:4000') {
    this._url        = `${baseUrl}/sessions/${sessionId}?token=${token}`;
    this._sessionId  = sessionId;

    this._ws         = null;
    this._connected  = false;
    this._stopped    = false;     // true after disconnect() is called

    this._attempt    = 0;         // backoff attempt counter
    this._reconnectTimer = null;

    // pending ops: [{ revision, ops, id }]  — id is a local serial number
    this._queue      = [];
    this._nextOpId   = 0;

    // event listeners: type → Set<fn>
    this._listeners  = new Map();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  connect() {
    this._stopped = false;
    this._openSocket();
    return this;
  }

  disconnect() {
    this._stopped = true;
    this._clearReconnectTimer();
    if (this._ws) {
      this._ws.onclose = null; // don't trigger reconnect
      this._ws.close(1000, 'client disconnect');
      this._ws = null;
    }
    this._connected = false;
    this._emit('status', 'disconnected');
  }

  /**
   * Enqueue an op and send immediately if connected.
   * @param {number} revision
   * @param {object[]} ops
   * @returns {number} op id (used internally for ack matching)
   */
  sendOp(revision, ops) {
    const id = this._nextOpId++;
    this._queue.push({ id, revision, ops });
    if (this._connected) this._sendFrame({ type: 'op', payload: { revision, ops } });
    return id;
  }

  sendCursor(cursor) {
    if (this._connected) {
      this._sendFrame({ type: 'cursor', payload: cursor });
    }
  }

  send(type, payload) {
    if (this._connected) {
      this._sendFrame({ type, payload });
    }
  }

  /**
   * Subscribe to a message type.
   * Special type "status" emits 'connected' | 'reconnecting' | 'disconnected'.
   */
  on(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
    return () => this.off(type, handler); // returns unsubscribe fn
  }

  off(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }

  get connected() { return this._connected; }

  // ── Socket lifecycle ───────────────────────────────────────────────────

  _openSocket() {
    if (this._stopped) return;

    this._ws = new WebSocket(this._url);

    this._ws.onopen = () => {
      this._connected = true;
      this._attempt   = 0;
      this._clearReconnectTimer();
      this._emit('status', 'connected');
      // Replay the pending queue so nothing is lost across reconnects
      this._replayQueue();
    };

    this._ws.onmessage = (event) => {
      this._handleMessage(event.data);
    };

    this._ws.onclose = (event) => {
      this._connected = false;
      if (!this._stopped) {
        this._emit('status', 'reconnecting');
        this._scheduleReconnect();
      } else {
        this._emit('status', 'disconnected');
      }
    };

    this._ws.onerror = () => {
      // onclose fires right after onerror; let it drive reconnect
      this._connected = false;
    };
  }

  _scheduleReconnect() {
    this._clearReconnectTimer();
    const delay = backoffMs(this._attempt++);
    this._reconnectTimer = setTimeout(() => {
      if (!this._stopped) this._openSocket();
    }, delay);
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  // ── Message handling ───────────────────────────────────────────────────

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.warn('[WSClient] unparseable message', raw);
      return;
    }

    const { type, payload } = msg;

    switch (type) {
      case 'connected':
        // Server confirmed the session; already handled via onopen
        this._emit('connected', payload);
        break;

      case 'ack':
        this._handleAck(payload);
        break;

      case 'pong':
        // Server heartbeat reply — connection is alive, cancel any pending
        // reconnect timer that may have been set by a missed ping.
        this._clearReconnectTimer();
        this._attempt = 0;
        break;

      case 'ping':
        // Server-initiated ping; respond immediately
        this._sendFrame({ type: 'pong' });
        break;

      case 'op':
      case 'cursor':
      case 'presence':
      case 'error':
        this._emit(type, payload);
        break;

      default:
        // unknown type — ignore
        break;
    }
  }

  _handleAck({ revision, ops }) {
    // Remove the first queued op (the server acks are ordered)
    if (this._queue.length > 0) {
      this._queue.shift();
    }
    this._emit('ack', { revision, ops });
  }

  // ── Queue ──────────────────────────────────────────────────────────────

  _replayQueue() {
    for (const { revision, ops } of this._queue) {
      this._sendFrame({ type: 'op', payload: { revision, ops } });
    }
  }

  // ── Send ───────────────────────────────────────────────────────────────

  _sendFrame(obj) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  // ── Emit ───────────────────────────────────────────────────────────────

  _emit(type, payload) {
    for (const handler of this._listeners.get(type) ?? []) {
      try { handler(payload); } catch (e) { console.error('[WSClient] handler error', e); }
    }
  }
}
