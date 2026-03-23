const connectionManager = require('../ConnectionManager');
const Session = require('../../models/Session');

const KICKED_FRAME = JSON.stringify({ type: 'error', payload: { code: 'KICKED' } });

/**
 * Handles admin messages sent by the session owner.
 *
 * Supported actions:
 *   kick – forcibly remove another user from the session.
 */
async function handle(ws, sessionId, user, payload) {
  if (!payload || payload.action !== 'kick' || !payload.targetUserId) {
    ws.send(JSON.stringify({ type: 'error', payload: { code: 'INVALID_FRAME' } }));
    return;
  }

  // Verify the sender is the session owner
  try {
    const session = await Session.findById(sessionId);
    if (!session) return;
    if (session.owner.toString() !== user.userId) {
      ws.send(JSON.stringify({ type: 'error', payload: { code: 'FORBIDDEN' } }));
      return;
    }

    // Don't allow kicking yourself
    if (payload.targetUserId === user.userId) return;

    connectionManager.kickUser(sessionId, payload.targetUserId);
  } catch (err) {
    console.error('[AdminHandler] kick error', err);
  }
}

module.exports = { handle };
