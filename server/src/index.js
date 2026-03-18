require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');

const authRouter = require('./routes/auth');
const sessionsRouter = require('./routes/sessions');
const connectionManager = require('./ws/ConnectionManager');
const { dispatch } = require('./ws/MessageRouter');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cookieParser());

// HTTP routes
app.use('/api/auth', authRouter);
app.use('/api/sessions', sessionsRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// --- WebSocket setup --------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Path pattern: /sessions/:id
const WS_PATH_RE = /^\/sessions\/([^/?]+)/;

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const match = url.pathname.match(WS_PATH_RE);

  if (!match) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const sessionId = match[1];

  // Authenticate via ?token= query param
  const token = url.searchParams.get('token');
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  let user;
  try {
    user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, sessionId, user);
  });
});

wss.on('connection', (ws, _req, sessionId, user) => {
  connectionManager.add(sessionId, ws, user.userId);

  ws.send(JSON.stringify({ type: 'connected', payload: { sessionId, user } }));

  ws.on('message', (rawMessage) => {
    dispatch(ws, sessionId, user, rawMessage);
  });

  ws.on('close', () => {
    connectionManager.remove(sessionId, ws);
  });

  ws.on('error', (err) => {
    console.error(`ws error [session=${sessionId}]`, err.message);
    connectionManager.remove(sessionId, ws);
  });
});

// ---------------------------------------------------------------------------

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      connectionManager.startHeartbeat();
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err);
    process.exit(1);
  });

module.exports = app;
