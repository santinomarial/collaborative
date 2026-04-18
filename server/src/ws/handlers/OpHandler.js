const { processOp, _checkRateLimit } = require('../../services/OpService');
const log = require('../../logger');

const RATE_LIMITED_FRAME = JSON.stringify({
  type: 'error',
  payload: { code: 'RATE_LIMITED' },
});

async function handle(ws, sessionId, user, payload) {
  const { userId } = user;

  // Rate limit check ─────────────────────────────────────────────────────────
  if (!_checkRateLimit(userId, sessionId)) {
    log.warn({ sessionId, userId }, 'op:rate_limited');
    ws.send(RATE_LIMITED_FRAME);
    return;
  }

  // Basic shape validation ───────────────────────────────────────────────────
  if (
    !payload ||
    typeof payload.revision !== 'number' ||
    !Array.isArray(payload.ops) ||
    payload.ops.length === 0
  ) {
    ws.send(
      JSON.stringify({ type: 'error', payload: { code: 'INVALID_OP' } })
    );
    return;
  }

  try {
    const { revision, ops } = await processOp(sessionId, userId, payload, ws._connId);

    ws.send(
      JSON.stringify({
        type: 'ack',
        payload: { revision, ops },
      })
    );
  } catch (err) {
    const code = err.code || 'OP_FAILED';
    log.error({ sessionId, userId, err: err.message, code }, 'op:error');

    ws.send(
      JSON.stringify({ type: 'error', payload: { code, message: err.message } })
    );
  }
}

module.exports = { handle };
