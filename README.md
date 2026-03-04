# Collaborative Code Editor

A real-time collaborative code editor with operational transformation at its core. Built for low latency and predictable convergence under concurrent edits — no third-party OT/CRDT libraries.

**Target:** 30+ concurrent users, &lt;150ms sync latency. Think Google Docs meets a minimal VS Code–style editing surface.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Status](#project-status)
- [OT Engine](#ot-engine)
- [Design Rationale](#design-rationale)
- [Getting Started](#getting-started)
- [Testing](#testing)
- [Load Testing](#load-testing)

---

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐     Redis Pub/Sub     ┌─────────────┐
│   Client    │ ◄────────────────► │  WebSocket       │ ◄──────────────────► │   Client    │
│  (React +   │                    │  Server          │                       │  (React +   │
│  CodeMirror)│                    │  + OT Engine     │                       │  CodeMirror)│
└─────────────┘                    └────────┬─────────┘                       └─────────────┘
                                            │
                                            ▼
                                    ┌───────────────┐
                                    │   MongoDB     │  (sessions, history, auth)
                                    └───────────────┘
```

**Data flow:** Client ops → WebSocket server → transform against server state → persist & broadcast via Redis Pub/Sub → other clients apply transformed ops. OT guarantees convergence without vector clocks or CRDT metadata.

*(Diagram and data-flow details will be refined as the WebSocket and Redis layers are implemented.)*

---

## Tech Stack

| Layer        | Choice                    | Notes |
|-------------|---------------------------|--------|
| **Backend** | Node.js, Express, `ws`    | Raw WebSockets (no Socket.io) for full control over reconnection and framing. |
| **Frontend**| React 18, CodeMirror 6    | CM6 for editor primitives; OT logic lives server-side. |
| **Pub/Sub** | Redis (ioredis)           | Session broadcast and presence; optional caching. |
| **Database**| MongoDB (Mongoose)        | Sessions, document snapshots, user/auth data. |
| **Auth**    | JWT in httpOnly cookies   | Stateless verification at the API/WS boundary. |

---

## Project Status

| Component                    | Status    |
|-----------------------------|-----------|
| OT Engine                   | Done      |
| Project scaffold + Docker   | Next      |
| Auth + MongoDB models       | Planned   |
| REST session API            | Planned   |
| WebSocket infrastructure    | Planned   |
| Redis Pub/Sub + presence     | Planned   |
| Op pipeline (persist + broadcast) | Planned   |
| CodeMirror 6 + OT client     | Planned   |
| Live cursors + presence UI   | Planned   |
| Session UI + history         | Planned   |
| Load test + instrumentation  | Planned   |

*Status: `Done` | `Next` | `Planned`.* (Extend with `In progress` or `Blocked` as needed.)

---

## OT Engine

The shared authority for applying and transforming operations. Implemented from first principles (no ShareDB, Yjs, or other OT/CRDT libs).

**Location:** `server/src/ot/engine.js`

### Op format

```ts
type Op =
  | { type: "insert"; position: number; text: string }
  | { type: "delete"; position: number; length: number };
```

### API

| Function | Signature | Description |
|----------|-----------|-------------|
| `apply` | `(document: string, op: Op) => string` | Applies a single op to a document; throws on invalid indices. |
| `transform` | `(op1: Op, op2: Op) => Op` | Returns op1′ such that `apply(apply(doc, op2), op1′) === apply(apply(doc, op1), transform(op2, op1))` (diamond property). |
| `compose` | `(op1: Op, op2: Op) => Op` | Sequential composition: one op equivalent to applying op1 then op2. |

All four pairwise conflict cases are implemented and tested: insert/insert, insert/delete, delete/insert, delete/delete.

### Tests

- **Path:** `server/src/ot/engine.test.js`
- **Run:** `npm test` (from repo root or `server/` once scaffold exists)

---

## Design Rationale

### Why OT instead of CRDT?

CRDTs (e.g. Yjs) give eventual consistency with less server logic but hide the actual conflict resolution. Here we want explicit, testable semantics: every transform case is in code and covered by tests. OT also keeps the client thin — no need to ship or maintain a CRDT implementation in the browser.

### Why raw `ws` instead of Socket.io?

Socket.io abstracts reconnection, heartbeats, and message framing. For a sync pipeline we need predictable behavior: backoff strategy, op buffering during disconnect, and clear ordering. Using `ws` keeps the protocol visible and avoids hidden retries or multiplexing that could complicate op ordering and idempotency.

### Why MongoDB for sessions?

Sessions and document state benefit from flexible schemas during iteration. Mongoose gives structure and migrations without blocking quick changes to session metadata or snapshot format. If we outgrow it, the OT engine and WebSocket layer remain agnostic.

---

## Getting Started

*(Full setup — Docker, env vars, and seed data — will be documented when the project scaffold is in place.)*

**Prerequisites (planned):** Node 18+, Docker (Redis, MongoDB), npm or pnpm.

---

## Testing

- **OT engine:** `npm test` (see [OT Engine](#ot-engine)).
- **Integration / load tests:** To be added after WebSocket and Redis are wired; results will be summarized in [Load Testing](#load-testing).

---

## Load Testing

*(Results and tooling will be added after instrumentation and the op pipeline are complete. Target: validate 30+ concurrent users and &lt;150ms sync latency under load.)*

---

## License

*(Add license when applicable.)*
