const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Two clients: pub never blocks on subscribe, sub never blocks on commands
const redisPub = new Redis(REDIS_URL);
const redisSub = new Redis(REDIS_URL);

redisPub.on('error', (err) => console.error('[redisPub]', err.message));
redisSub.on('error', (err) => console.error('[redisSub]', err.message));

// channel name helpers
const opsChannel   = (sessionId) => `session:${sessionId}:ops`;
const usersKey     = (sessionId) => `session:${sessionId}:users`;
const cursorsKey   = (sessionId) => `session:${sessionId}:cursors`;

// sessionId → Set<onMessage callback> — avoids re-subscribing on the Redis
// client when a second local socket joins the same session in this process.
const _listeners = new Map();

redisSub.on('message', (channel, raw) => {
  // Find the sessionId from the channel name  session:<id>:ops
  const m = channel.match(/^session:(.+):ops$/);
  if (!m) return;
  const sessionId = m[1];

  const cbs = _listeners.get(sessionId);
  if (!cbs || cbs.size === 0) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  for (const cb of cbs) cb(payload);
});

// ---------------------------------------------------------------------------
// Pub/Sub
// ---------------------------------------------------------------------------

/**
 * Register a callback for ops published to this session's channel.
 * Subscribes on the Redis client the first time per session in this process.
 */
async function subscribeToSession(sessionId, onMessage) {
  if (!_listeners.has(sessionId)) {
    _listeners.set(sessionId, new Set());
    await redisSub.subscribe(opsChannel(sessionId));
  }
  _listeners.get(sessionId).add(onMessage);
}

/**
 * Remove a callback. Unsubscribes from Redis when no listeners remain.
 */
async function unsubscribeFromSession(sessionId, onMessage) {
  const cbs = _listeners.get(sessionId);
  if (!cbs) return;
  cbs.delete(onMessage);
  if (cbs.size === 0) {
    _listeners.delete(sessionId);
    await redisSub.unsubscribe(opsChannel(sessionId));
  }
}

/**
 * Publish an op payload to all server instances subscribed to this session.
 */
async function publishOp(sessionId, payload) {
  await redisPub.publish(opsChannel(sessionId), JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Presence — users
// ---------------------------------------------------------------------------

const USER_TTL_SECONDS = 86400;

async function userJoined(sessionId, userId, userMeta) {
  const key = usersKey(sessionId);
  await redisPub.hset(key, userId, JSON.stringify(userMeta));
  await redisPub.expire(key, USER_TTL_SECONDS);
}

async function userLeft(sessionId, userId) {
  await redisPub.hdel(usersKey(sessionId), userId);
}

async function getPresence(sessionId) {
  const hash = await redisPub.hgetall(usersKey(sessionId));
  if (!hash) return [];
  return Object.values(hash).map((v) => JSON.parse(v));
}

// ---------------------------------------------------------------------------
// Presence — cursors
// ---------------------------------------------------------------------------

async function updateCursor(sessionId, userId, cursor) {
  await redisPub.hset(cursorsKey(sessionId), userId, JSON.stringify(cursor));
}

module.exports = {
  redisPub,
  redisSub,
  subscribeToSession,
  unsubscribeFromSession,
  publishOp,
  userJoined,
  userLeft,
  getPresence,
  updateCursor,
};
