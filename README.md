# Collaborative Code Editor

A production-grade real-time collaborative code editor built from scratch. Think Google Docs meets VS Code — supporting 30+ concurrent users with sub-150ms sync latency.

## Architecture (evolves as we build)
Client → WebSocket Server → OT Engine → Redis Pub/Sub → Other Clients
(More detail added in final prompt)

## Tech Stack
- Backend: Node.js + Express + WebSocket (raw ws, no Socket.io)
- Frontend: React 18 + CodeMirror 6
- Pub/Sub & Caching: Redis (ioredis)
- Database: MongoDB (Mongoose)
- Auth: JWT (httpOnly cookies)

## Project Status
| Section | Status |
|---------|--------|
| OT Engine | ✅ Done |
| Project Scaffold + Docker | 🔜 Up next |
| Auth + MongoDB Models | ⏳ Pending |
| REST Session API | ⏳ Pending |
| WebSocket Infrastructure | ⏳ Pending |
| Redis Pub/Sub + Presence | ⏳ Pending |
| Op Pipeline | ⏳ Pending |
| CodeMirror 6 + OT Client | ⏳ Pending |
| Live Cursors + Presence UI | ⏳ Pending |
| Session UI + History | ⏳ Pending |
| Load Test + Instrumentation | ⏳ Pending |

## OT Engine
The foundation of the entire system. Implements Operational Transformation from scratch — no ShareDB, no Yjs.

Located at `server/src/ot/engine.js`. Three core functions:
- `apply(document, op)` — applies an op to a string document
- `transform(op1, op2)` — resolves conflicts between concurrent ops
- `compose(op1, op2)` — merges two sequential ops into one

Handles all four conflict cases: insert/insert, insert/delete, delete/insert, delete/delete.

Tests at `server/src/ot/engine.test.js`. Run with: `npm test`

## Engineering Decisions
**Why OT over CRDT?**
CRDTs (like Yjs) are excellent but treat conflict resolution as a black box. Implementing OT from scratch demonstrates a precise understanding of the concurrency problem — every conflict case is explicit and testable.

**Why raw ws over Socket.io?**
Socket.io abstracts reconnection, framing, and the handshake. Building these manually shows protocol-level knowledge and gives full control over behavior like backoff strategy and op buffering during disconnect.

## Getting Started
(Full setup instructions added when Docker and scaffold are complete)

## Load Test Results
(Added in final prompt after instrumentation is complete)
