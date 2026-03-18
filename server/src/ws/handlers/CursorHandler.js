const connectionManager = require('../ConnectionManager');

// Stub – broadcasts cursor position to other participants
function handle(ws, sessionId, user, payload) {
  connectionManager.broadcast(
    sessionId,
    {
      type: 'cursor',
      payload: {
        userId: user.userId,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        ...payload,
      },
    },
    ws // exclude sender
  );
}

module.exports = { handle };
