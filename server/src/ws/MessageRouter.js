const connectionManager = require('./ConnectionManager');
const OpHandler = require('./handlers/OpHandler');
const CursorHandler = require('./handlers/CursorHandler');
const AdminHandler = require('./handlers/AdminHandler');

const ERROR_FRAME = JSON.stringify({ type: 'error', payload: { code: 'INVALID_FRAME' } });

/**
 * Parse and dispatch a raw WebSocket message.
 *
 * @param {WebSocket} ws
 * @param {string}    sessionId
 * @param {object}    user       – decoded JWT payload
 * @param {Buffer|string} rawMessage
 */
function dispatch(ws, sessionId, user, rawMessage) {
  let message;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    ws.send(ERROR_FRAME);
    return;
  }

  const { type, payload } = message;

  switch (type) {
    case 'pong':
      ws.isAlive = true;
      break;

    case 'op':
      OpHandler.handle(ws, sessionId, user, payload);
      break;

    case 'cursor':
      CursorHandler.handle(ws, sessionId, user, payload);
      break;

    case 'admin':
      AdminHandler.handle(ws, sessionId, user, payload);
      break;

    default:
      ws.send(ERROR_FRAME);
  }
}

module.exports = { dispatch };
