const engine = require('../ot/engine');
const Session = require('../models/Session');
const Operation = require('../models/Operation');
const SessionService = require('./SessionService');
const redis = require('./RedisService');
const log = require('../logger');

// ---------------------------------------------------------------------------
// In-memory rate limiter: 100 ops / userId:sessionId / 60 s
// ---------------------------------------------------------------------------
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60_000;

// key → { count: number, resetAt: number }
const _rateBuckets = new Map();

/**
 * Returns true if the user is within their rate limit and increments the counter.
 * Returns false if they are over the limit (does NOT increment).
 */
function _checkRateLimit(userId, sessionId) {
  const key = `${userId}:${sessionId}`;
  const now = Date.now();

  let bucket = _rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    _rateBuckets.set(key, bucket);
  }

  if (bucket.count >= RATE_LIMIT) return false;

  bucket.count += 1;
  return true;
}

// Periodically sweep expired buckets so the Map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of _rateBuckets) {
    if (now >= bucket.resetAt) _rateBuckets.delete(key);
  }
}, RATE_WINDOW_MS);

// ---------------------------------------------------------------------------
// Transform helpers
// ---------------------------------------------------------------------------

/**
 * Transform an array of client ops against a sequence of already-applied
 * server op components (from a single Operation document).
 *
 * Each serverComponent in serverOps has already been applied to the document;
 * we adjust every client op to account for it.
 */
function _transformOpsAgainst(clientOps, serverOps) {
  let result = [...clientOps];
  for (const sOp of serverOps) {
    result = result.map((cOp) => engine.transform(cOp, sOp));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

/**
 * Process an incoming op from a client.
 *
 * @param {string} sessionId
 * @param {string} userId
 * @param {{ revision: number, ops: object[] }} incoming
 * @returns {{ revision: number, ops: object[] }}
 */
async function processOp(sessionId, userId, incoming) {
  const t0 = Date.now();
  const { revision: clientRev, ops: clientOps } = incoming;

  log.info(
    { sessionId, userId, clientRev, opCount: clientOps.length },
    'op:received'
  );

  // 1. Load session ──────────────────────────────────────────────────────────
  const session = await Session.findById(sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { code: 'SESSION_NOT_FOUND' });
  if (session.isLocked) throw Object.assign(new Error('Session is locked'), { code: 'SESSION_LOCKED' });

  const serverRev = session.revision;

  log.info({ sessionId, userId, clientRev, serverRev }, 'op:revisions');

  // 2. Transform if behind ───────────────────────────────────────────────────
  let transformedOps = [...clientOps];

  if (clientRev < serverRev) {
    const concurrentDocs = await Operation.find({
      sessionId,
      revision: { $gt: clientRev, $lte: serverRev },
    }).sort({ revision: 1 });

    log.info(
      { sessionId, userId, clientRev, serverRev, concurrentCount: concurrentDocs.length },
      'op:transforming'
    );

    for (const doc of concurrentDocs) {
      transformedOps = _transformOpsAgainst(transformedOps, doc.ops);
    }
  }

  // 3. Apply to snapshot ─────────────────────────────────────────────────────
  let newSnapshot = session.snapshot;
  for (const op of transformedOps) {
    newSnapshot = engine.apply(newSnapshot, op);
  }

  // 4. Persist Operation ─────────────────────────────────────────────────────
  const newRevision = serverRev + 1;

  await Operation.create({
    sessionId,
    userId,
    revision: newRevision,
    ops: transformedOps,
    acknowledged: true,
  });

  // 5. Update session ────────────────────────────────────────────────────────
  await Session.findByIdAndUpdate(sessionId, {
    revision: newRevision,
    snapshot: newSnapshot,
  });

  const latencyMs = Date.now() - t0;

  log.info(
    { sessionId, userId, newRevision, latencyMs },
    'op:committed'
  );

  // 6. Publish to Redis (fan-out to other server instances) ──────────────────
  const redisPayload = {
    type: 'op',
    payload: {
      revision: newRevision,
      ops: transformedOps,
      userId,
      timestamp: new Date().toISOString(),
    },
  };

  await redis.publishOp(sessionId, redisPayload);

  log.info({ sessionId, userId, newRevision }, 'op:published');

  // 7. Checkpoint if needed ──────────────────────────────────────────────────
  const needsCheckpoint = await SessionService.shouldCheckpoint(sessionId);
  if (needsCheckpoint) {
    log.info({ sessionId, newRevision }, 'op:checkpoint:start');
    await SessionService.checkpoint(sessionId);
    log.info({ sessionId, newRevision }, 'op:checkpoint:done');
  }

  // 8. Return ack data ───────────────────────────────────────────────────────
  return { revision: newRevision, ops: transformedOps };
}

module.exports = { processOp, _checkRateLimit };
