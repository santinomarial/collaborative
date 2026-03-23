# Collaborative Code Editor

Real-time collaborative code editor built on Node.js, CodeMirror 6, and Operational Transformation. Multiple users edit the same document simultaneously; every keystroke converges on all clients within a single round-trip.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Browser A                               │
│  CodeMirror 6 ──▶ CollabExtension ──▶ WSClient                  │
└───────────────────────────────┬──────────────────────────────────┘
                                │  WebSocket  op / ack / cursor
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                         Node.js Server                           │
│                                                                  │
│  ┌────────────┐   ┌──────────────┐   ┌─────────────────────┐    │
│  │ HTTP / REST│   │  WS Upgrade  │   │   MessageRouter     │    │
│  │  (Express) │   │  JWT verify  │──▶│  op / cursor /      │    │
│  └─────┬──────┘   └──────────────┘   │  admin / pong       │    │
│        │                             └──────────┬──────────┘    │
│        ▼                                        │                │
│  ┌──────────────────────┐          ┌────────────▼────────────┐  │
│  │  REST handlers       │          │       OpHandler         │  │
│  │  sessions / auth     │          │  rate-check → transform │  │
│  └──────────┬───────────┘          │  → apply → persist      │  │
│             │                      └────────────┬────────────┘  │
│             │                                   │                │
│             ▼                                   ▼                │
│  ┌─────────────────────┐          ┌─────────────────────────┐   │
│  │      MongoDB        │          │       OT Engine         │   │
│  │  Session / Op docs  │◀─────────│  transform(op1, op2)    │   │
│  │  snapshot + history │          │  apply(doc, op)         │   │
│  └─────────────────────┘          └─────────────┬───────────┘   │
│                                                  │               │
│                                    publishOp ────▼               │
│                                   ┌──────────────────────────┐  │
│                                   │    Redis Pub/Sub          │  │
│                                   │  session:{id}:ops channel │  │
│                                   └──────────────┬───────────┘  │
└──────────────────────────────────────────────────┼──────────────┘
                                                   │ fan-out to all
                                                   │ subscribed processes
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Node.js Server (same or other process)        │
│                                                                  │
│  ConnectionManager.broadcast ──▶  WebSocket  ──▶  Browser B     │
│                                                                  │
│  CodeMirror 6 ◀── CollabExtension ◀── WSClient                  │
└──────────────────────────────────────────────────────────────────┘
                         │
                         ▼
                 ┌──────────────┐
                 │   MongoDB    │   (presence TTL, session lock,
                 │   Redis      │    checkpoint, history, restore)
                 └──────────────┘
```

### Op pipeline (one keystroke end-to-end)

1. User types → CM6 fires `update` → `CollabExtension` converts changeset to `[{type,position,…}]` ops
2. `WSClient.sendOp(revision, ops)` enqueues the op locally and sends `{type:"op",…}` over WebSocket
3. Server `OpHandler` rate-checks, transforms ops against any concurrent ops committed since `clientRevision`, applies to snapshot, persists `Operation` document, increments `Session.revision`
4. Server acks the sender (`{type:"ack",…}`) and publishes the committed op to Redis
5. Redis fan-out delivers the op to every other connected process; each broadcasts to its local sockets
6. Receiving clients transform the remote op through their pending (unacked) ops, rebase their pending ops against it, then apply to CodeMirror as a remote transaction (skipped by undo history)

---

## Quick Start

```bash
git clone <repo-url>
cd collaborative
cp .env.example .env          # edit JWT_SECRET at minimum
docker compose up --build
```

- App:     http://localhost:3000
- Health:  http://localhost:3000/health → `{"status":"ok"}`

### Local Node (no Docker)

Requires MongoDB 7 and Redis 7 running on localhost.

```bash
cd server
cp .env.example .env          # PORT defaults to 3001
npm install
npm start
```

```bash
cd client
npm install
npm run dev                   # Vite dev server on http://localhost:5173
```

---

## Load Test

### 1. Install dependencies

```bash
cd load-test
npm install
```

### 2. Obtain tokens

Guest tokens share `userId: null` and will hit the per-user rate limit (100 ops/min)
almost immediately when running more than ~5 concurrent clients. Use `setup.js` to
register real test users instead:

```bash
# Registers (or re-logs-in) N test users; prints one JWT per line
node setup.js --users=30 --base=http://localhost:3001 > tokens.txt
```

For a quick single-client smoke test you can use a guest token directly:

```bash
TOKEN=$(curl -s -c /dev/null -D - -X POST http://localhost:3001/api/auth/guest \
  -H 'Content-Type: application/json' \
  -d '{"displayName":"Hammer"}' \
  | grep -i set-cookie | sed 's/.*token=//;s/;.*//' | tr -d '[:space:]')
```

### 3. Create a session and get its ID

```bash
# (after registering/logging in as a real user and saving the cookie)
SESSION=$(curl -s -b cookies.txt -X POST http://localhost:3001/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"title":"Load Test","language":"javascript"}')
SESSION_ID=$(echo $SESSION | python3 -c "import sys,json; print(json.load(sys.stdin)['_id'])")
```

### 4. Run hammer.js

```bash
# With a tokens file (recommended for --users > 5)
node hammer.js \
  --session=$SESSION_ID \
  --tokens-file=./tokens.txt \
  --users=30 \
  --duration=60

# With a single token (fine for --users=1 smoke tests)
node hammer.js \
  --session=$SESSION_ID \
  --token=$TOKEN \
  --users=1 \
  --duration=30
```

CLI options:

| Flag | Default | Description |
|------|---------|-------------|
| `--session` | required | Session ID to target |
| `--token` | — | Single JWT; all clients share it (and its rate-limit bucket) |
| `--tokens-file` | — | Path to file with one JWT per line; round-robined across clients |
| `--users` | `30` | Number of concurrent WebSocket clients |
| `--duration` | `60` | Test duration in seconds |
| `--host` | `ws://localhost:3001` | WebSocket base URL |

### 5. Debug RTT badge

Add `?debug=1` to any session URL to show a live rolling p95 RTT badge in the toolbar.
The badge is updated by `CollabExtension` on every ack; `console.debug` also logs each
individual op RTT.

---

## Measured Performance

Tested locally on a MacBook (Apple M-series), single Node.js process, MongoDB 7 and
Redis 7 running via Homebrew, all on loopback.

| Users | Duration | Ops sent | Ops acked | Dropped | Throughput | p50 RTT | p95 RTT | p99 RTT | Max RTT | Drops |
|------:|:--------:|---------:|----------:|--------:|:----------:|--------:|--------:|--------:|--------:|------:|
| 30    | 30 s     | 1 755    | 1 755     | 0       | 55.7 ops/s | 6.6 ms  | **8.8 ms** | 12.9 ms | 50.8 ms | 0 |
| 100   | 30 s     | 5 642    | 5 642     | 0       | 179.1 ops/s| 4.5 ms  | **7.8 ms** | 9.0 ms  | 16.0 ms | 0 |

p95 stays flat from 30 → 100 users because op processing is serialised through a single
MongoDB write (one `Session.findByIdAndUpdate` per op). The extra concurrency therefore
adds queue depth but not per-op latency on a fast local disk.

Network RTT and MongoDB/Redis latency dominate in production; expect p95 of 20–80 ms
depending on geography and instance type.

---

## Engineering Decisions

### OT over CRDT

CRDTs guarantee convergence without coordination but push merge complexity into the data
structure itself, making conflict semantics implicit. This codebase uses a minimal two-op
model (`insert` / `delete`) with a fully explicit `transform(op1, op2)` function and a
unit-tested diamond property. Every edge case (insert-insert, insert-delete, delete-delete,
same-position ties) is a named test in `server/src/ot/engine.test.js`. The tradeoff:
OT requires a central authority (the server) to serialize ops and assign revisions; CRDTs
can merge peer-to-peer. For a server-centric editor with session ownership, OT is the
simpler choice.

### Raw `ws` over Socket.io

Socket.io adds rooms, multiplexing, automatic fallback to long-polling, and its own
acknowledgement protocol. Those features conflict with this project's requirements:

- **Ordering** — Socket.io's built-in ack is per-message and unordered; the OT protocol
  needs FIFO ack ordering with explicit revision numbers.
- **Heartbeat** — the server issues `ping` frames on a 15 s interval and terminates
  connections that miss a 5 s `pong` window. Socket.io heartbeats are not customisable
  without deep internals access.
- **Upgrade path** — `ws` exposes `server.handleUpgrade` so token verification happens
  before the WebSocket handshake completes, rather than in a `connection` callback after
  the socket is already open.

### Checkpoint strategy

`Operation` documents accumulate in MongoDB as the document evolves. After every 100 ops,
`SessionService.checkpoint` deletes all `Operation` rows for the session; the authoritative
state is `Session.snapshot`. This bounds op-log growth (and therefore the number of
documents the server must fetch during OT transformation) at the cost of losing fine-grained
history older than 100 ops. The `HistoryScrubber` component reconstructs intermediate states
by replaying the current op window from `''`; sessions that have been checkpointed will
start from an empty baseline rather than the true historical start. A production system would
store a base snapshot alongside the op window to close this gap.

### Redis pub/sub for fan-out

Each Node.js process only holds the WebSocket sockets that connected to it. Without a
shared message bus, an op received by process A cannot reach users connected to process B.
Redis `PUBLISH session:{id}:ops` solves this: every process that has at least one socket
for a session subscribes to that channel and fans the received JSON payload to its local
sockets. This works without sticky sessions and scales horizontally by adding processes
behind a load balancer.

### Two Redis clients (`redisPub` + `redisSub`)

The Redis protocol prohibits a connection in `SUBSCRIBE` mode from issuing other commands
(`SET`, `GET`, `HSET`, etc.). A single client would dead-lock attempting to do both. Two
dedicated clients are required by protocol, not by preference.

---

## Known Limitations and 10× Scale

| Limitation | Impact now | At 10× (≈1 000 concurrent users) |
|---|---|---|
| **In-process rate limiter** | Correct for a single Node instance | Each process has its own bucket; a user split across processes can exceed the global limit. Fix: move rate counters to Redis with `INCR` + `EXPIRE`. |
| **Sequential op commits** | One MongoDB write per op; serialisation is the bottleneck | `Session.findByIdAndUpdate` on a single document becomes a hot row. Fix: shard sessions across replica sets, or use optimistic locking with a version field and retry on conflict. |
| **Synchronous checkpoint** | Deletes 100+ `Operation` docs in the op pipeline | At high write rates this adds 5–20 ms spikes every ~100 ops per session. Fix: run checkpoint asynchronously in a background worker (e.g. a Bull queue) or via a MongoDB change stream trigger. |
| **OT transformation scan** | `Operation.find({ revision: { $gt, $lte } })` on reconnect | Without an index on `(sessionId, revision)` this is a collection scan. Fix: add a compound index (already partially covered by `sessionId`; add `revision` to it). |
| **No horizontal Redis presence** | Presence TTL is 86 400 s; stale users can linger if process crashes before `userLeft` | Fix: reduce TTL, add a process-level shutdown hook, and use `HSCAN` + TTL-per-field (Redis 7.4+) or a sorted-set timestamp approach. |
| **WebSocket on a single port** | Works fine up to ~65 k concurrent sockets per process on Linux | Split WebSocket and REST onto separate services; put a Layer-4 load balancer (e.g. HAProxy) in front so WS connections are distributed without sticky routing. |

---

## REST API

All `/api/sessions/*` routes require `Cookie: token=<jwt>`.

| Method & path | Auth | Body | Response |
|---|---|---|---|
| `POST /api/auth/register` | None | `{ email, password, displayName, avatarColor? }` | `201 { userId, displayName, avatarColor }` + cookie |
| `POST /api/auth/login` | None | `{ email, password }` | `200 { userId, … }` + cookie |
| `POST /api/auth/guest` | None | `{ displayName, avatarColor? }` | `200 { displayName, role:"guest" }` + cookie |
| `POST /api/auth/logout` | None | — | `200 { message }` |
| `GET /api/auth/token` | Cookie | — | `200 { token }` (JWT body for WS upgrade) |
| `POST /api/sessions` | Cookie | `{ title, language }` | `201` session document |
| `GET /api/sessions/:id` | Cookie | — | `200` session document |
| `GET /api/sessions/:id/history` | Cookie | `?page&limit` | `200 { page, limit, total, pages, operations }` |
| `PATCH /api/sessions/:id` | Cookie; owner | Partial `{ title?, language?, isLocked?, expiresAt? }` | `200` updated session |
| `PATCH /api/sessions/:id/restore` | Cookie; owner | `{ revision, snapshot }` | `200 { ok, revision }` |
| `DELETE /api/sessions/:id` | Cookie; owner | — | `200 { message }` |

Validation errors: `400 { error:"Validation failed", fields:{…} }`.
Auth errors: `401`. Forbidden: `403`.

---

## WebSocket Protocol

**URL:** `ws://<host>/sessions/<sessionId>?token=<jwt>`

**Client → server**

| `type` | Payload | Purpose |
|--------|---------|---------|
| `op` | `{ revision, ops[] }` | Send an edit |
| `cursor` | `{ anchor, head, … }` | Broadcast cursor position |
| `pong` | — | Reply to server heartbeat |
| `admin` | `{ action:"kick", targetUserId }` | Owner-only: remove a user |

**Server → client**

| `type` | Payload | When |
|--------|---------|------|
| `connected` | `{ sessionId, user }` | After successful upgrade |
| `ping` | — | Every 15 s; reply within 5 s |
| `ack` | `{ revision, ops }` | Op accepted and committed |
| `op` | `{ revision, ops, userId }` | Another user's committed op |
| `presence` | `{ users[] }` | On any join/leave |
| `cursor` | `{ userId, … }` | Another user moved their cursor |
| `reload` | `{ reason, revision }` | Owner restored a previous version |
| `error` | `{ code }` | `INVALID_FRAME` / `RATE_LIMITED` / `SESSION_LOCKED` / `KICKED` |

---

## OT Engine

**Path:** `server/src/ot/engine.js` (server) · `client/src/editor/otEngine.js` (client)

**Op shape:** `{ type: "insert"|"delete", position: number, text?: string, length?: number }`

| Export | Description |
|--------|-------------|
| `apply(doc, op)` | Returns new string after applying op |
| `transform(op1, op2)` | Returns `op1′` that produces the same result after `op2` has already been applied (diamond property) |
| `compose(op1, op2)` | Returns a single op equivalent to applying both in sequence |

**Diamond property** — for any `doc` and concurrent `op1`, `op2`:

```
apply(apply(doc, op2), transform(op1, op2))
  === apply(apply(doc, op1), transform(op2, op1))
```

Covered by `engine.test.js` (insert/insert, insert/delete, delete/insert, delete/delete,
same-position, overlapping deletes).

---

## Data Models

**Session**
```
_id:           String (nanoid 8 chars)
title:         String
language:      String
owner:         ObjectId → User
collaborators: [ObjectId → User]
revision:      Number   (incremented on every committed op)
snapshot:      String   (current document content)
isLocked:      Boolean  (true → guests read-only)
expiresAt:     Date?
createdAt / updatedAt: timestamps
```

**Operation**
```
sessionId:    String
userId:       String
revision:     Number   (server revision at commit time)
ops:          [{ type, position, text?, length? }]
timestamp:    Date
acknowledged: Boolean
```

Checkpointing deletes all Operation rows for a session when `count >= 100` and advances
`Session.updatedAt`. The snapshot field is always current.

---

## Infrastructure

`docker-compose.yml` services:

| Service | Image | Port |
|---------|-------|------|
| `mongo` | `mongo:7` | 27017 |
| `redis` | `redis:7-alpine` | 6379 |
| `app` | built from `Dockerfile` | 3000 |

`app` overrides `MONGODB_URI` and `REDIS_URL` to in-network service names; all other
vars come from `.env`.

---

## Testing

```bash
cd server
npm test          # Jest — OT engine unit tests (apply, transform, compose, convergence)
```
