const WebSocket = require('ws');

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 5_000;

class ConnectionManager {
  constructor() {
    // sessionId (string) → Set<WebSocket>
    this._sessions = new Map();
    this._pingInterval = null;
  }

  /** Register a socket for a session. Stores userId on the ws object. */
  add(sessionId, ws, userId) {
    ws.userId = userId;
    ws.isAlive = true;

    if (!this._sessions.has(sessionId)) {
      this._sessions.set(sessionId, new Set());
    }
    this._sessions.get(sessionId).add(ws);
  }

  /** Remove a socket from its session. Cleans up empty session entries. */
  remove(sessionId, ws) {
    const sockets = this._sessions.get(sessionId);
    if (!sockets) return;
    sockets.delete(ws);
    if (sockets.size === 0) this._sessions.delete(sessionId);
  }

  /**
   * Send a message to all sockets in a session, optionally skipping one.
   * @param {string} sessionId
   * @param {object} message  – will be JSON-serialised
   * @param {WebSocket|null} excludeWs
   */
  broadcast(sessionId, message, excludeWs = null) {
    const sockets = this._sessions.get(sessionId);
    if (!sockets) return;

    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket === excludeWs) continue;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  /**
   * Start the heartbeat loop.
   * Every PING_INTERVAL_MS we:
   *   1. Mark all sockets as not alive.
   *   2. Send { type: "ping" }.
   *   3. Schedule a PONG_TIMEOUT_MS follow-up; any socket still dead is terminated.
   */
  startHeartbeat() {
    if (this._pingInterval) return; // already running

    this._pingInterval = setInterval(() => {
      for (const [sessionId, sockets] of this._sessions) {
        for (const ws of sockets) {
          if (ws.readyState !== WebSocket.OPEN) {
            this.remove(sessionId, ws);
            continue;
          }

          // Mark dead before the ping; pong handler sets it back to true.
          ws.isAlive = false;
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }

      // After PONG_TIMEOUT_MS, terminate any socket that still hasn't responded.
      setTimeout(() => {
        for (const [sessionId, sockets] of this._sessions) {
          for (const ws of sockets) {
            if (!ws.isAlive) {
              ws.terminate();
              this.remove(sessionId, ws);
            }
          }
        }
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  stopHeartbeat() {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }
}

module.exports = new ConnectionManager(); // singleton
