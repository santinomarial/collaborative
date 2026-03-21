const WebSocket = require('ws');
const redis = require('../services/RedisService');

const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 5_000;

class ConnectionManager {
  constructor() {
    // sessionId → Set<WebSocket>
    this._sessions = new Map();
    // sessionId → Redis onMessage callback (kept so we can unsubscribe later)
    this._redisCallbacks = new Map();
    this._pingInterval = null;
  }

  // -------------------------------------------------------------------------
  // Connect / disconnect
  // -------------------------------------------------------------------------

  /**
   * Register a socket, update Redis presence, subscribe to the session's
   * Redis channel (once per session per process), then broadcast presence.
   */
  async add(sessionId, ws, userId, userMeta) {
    ws.userId = userId;
    ws.isAlive = true;

    const isFirstLocal = !this._sessions.has(sessionId);

    if (isFirstLocal) {
      this._sessions.set(sessionId, new Set());

      // Subscribe once; fan messages out to all local sockets.
      const cb = (payload) => this.broadcast(sessionId, payload);
      this._redisCallbacks.set(sessionId, cb);
      await redis.subscribeToSession(sessionId, cb);
    }

    this._sessions.get(sessionId).add(ws);

    // Presence
    await redis.userJoined(sessionId, userId, userMeta);
    await this._broadcastPresence(sessionId);
  }

  /**
   * Deregister a socket, update Redis presence, broadcast presence.
   * Unsubscribes from Redis when the last local socket for the session leaves.
   */
  async remove(sessionId, ws) {
    const sockets = this._sessions.get(sessionId);
    if (!sockets) return;

    sockets.delete(ws);

    // Presence: only remove the user from Redis if they have no other sockets
    // open for this session in this process.
    const stillHere = [...sockets].some((s) => s.userId === ws.userId);
    if (!stillHere) {
      await redis.userLeft(sessionId, ws.userId);
    }

    if (sockets.size === 0) {
      this._sessions.delete(sessionId);
      const cb = this._redisCallbacks.get(sessionId);
      this._redisCallbacks.delete(sessionId);
      await redis.unsubscribeFromSession(sessionId, cb);
    }

    // Broadcast updated presence to whoever remains (may be empty — no-op)
    await this._broadcastPresence(sessionId);
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  /**
   * Send to all open sockets in this session in this process, optionally
   * excluding one (the sender).
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

  // -------------------------------------------------------------------------
  // Presence helpers
  // -------------------------------------------------------------------------

  async _broadcastPresence(sessionId) {
    const users = await redis.getPresence(sessionId);
    this.broadcast(sessionId, { type: 'presence', payload: { users } });
  }

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  startHeartbeat() {
    if (this._pingInterval) return;

    this._pingInterval = setInterval(() => {
      for (const [sessionId, sockets] of this._sessions) {
        for (const ws of sockets) {
          if (ws.readyState !== WebSocket.OPEN) {
            this.remove(sessionId, ws);
            continue;
          }
          ws.isAlive = false;
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }

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

module.exports = new ConnectionManager();
