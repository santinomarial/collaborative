# Collaborative Code Editor

Backend: Express 5, Mongoose, raw `ws`, ioredis (pub/sub + presence), JWT in httpOnly cookies. OT engine for string insert/delete ops is implemented and unit-tested (see Architecture for how it relates to the WebSocket path).

---

## Architecture

```
Client → WebSocket Server → OT Engine → Redis Pub/Sub → Other Clients
                                ↓
                           MongoDB
```

REST creates/reads/updates/deletes sessions and paginates `Operation` rows in MongoDB. WebSocket path is `/sessions/:id?token=JWT` (JWT in query string on upgrade, not from cookies). When the first client for a `sessionId` connects in this process, the server subscribes to Redis `session:{id}:ops`; payloads received there are JSON-parsed and fanned out to every WebSocket for that session held in this process. `RedisService.publishOp(sessionId, payload)` publishes to that channel. Presence is stored in Redis (`session:{id}:users`, 86400s TTL) and emitted as `presence` frames. `cursor` messages are rebroadcast in-process only. Heartbeat: server `ping` every 15s, client `pong` within 5s or terminate. WebSocket `op` frames invoke `OpHandler.handle`, which does not call the OT engine, MongoDB, or `publishOp`; `server/src/ot/engine.js` is used from unit tests only.

---

## API

### REST

All `/api/sessions/*` routes use `requireAuth`: valid JWT in `Cookie: token=<jwt>` (same secret as WebSocket `?token=`). Responses use JSON unless noted.

| Method & path | Purpose | Auth | Request body | Response |
|---------------|---------|------|--------------|----------|
| `POST /api/auth/register` | Create user, hash password, set cookie | None | `{ email, password, displayName, avatarColor? }` — password ≥8 chars; `avatarColor` optional `#rrggbb` | `201` `{ userId, displayName, avatarColor }` + `Set-Cookie: token` |
| `POST /api/auth/login` | Verify credentials, set cookie | None | `{ email, password }` | `200` `{ userId, displayName, avatarColor }` + cookie |
| `POST /api/auth/guest` | Issue guest JWT, set cookie | None | `{ displayName, avatarColor? }` | `200` `{ displayName, avatarColor, role: "guest" }` + cookie (`userId` in JWT is `null`) |
| `POST /api/auth/logout` | Clear auth cookie | None | — | `200` `{ message: "Logged out" }` |
| `POST /api/sessions` | Create session (`_id` is nanoid(8)) | Cookie JWT | `{ title, language }` each non-empty string (length limits in Zod) | `201` session document JSON |
| `GET /api/sessions/:id` | Fetch session | Cookie JWT | — | `200` `{ _id, title, language, owner, collaborators, isLocked, expiresAt, createdAt, updatedAt, snapshot, revision }` or `404` |
| `GET /api/sessions/:id/history` | Paginated op log | Cookie JWT | Query: `page` (int ≥1, default 1), `limit` (1–200, default 50) | `200` `{ page, limit, total, pages, operations }` — `operations` are `Operation` docs |
| `PATCH /api/sessions/:id` | Update metadata | Cookie JWT; **owner only** | Partial `{ title?, language?, isLocked?, expiresAt? }` — `expiresAt` ISO datetime or `null`; at least one field | `200` updated session document or `403`/`404` |
| `DELETE /api/sessions/:id` | Delete session and its operations | Cookie JWT; **owner only** | — | `200` `{ message: "Session deleted" }` or `403`/`404` |

Validation errors: `400` `{ error: "Validation failed", fields: { <path>: <message> } }`. Auth failures: `401` `{ error: "Not authenticated" }` or `{ error: "Invalid or expired token" }`.

### WebSocket

**URL:** `ws://<host>/sessions/<sessionId>?token=<JWT>`  
Same `JWT_SECRET` as HTTP; token verified before upgrade. No cookie read on upgrade.

**Client → server**

| `type` | Payload | When |
|--------|---------|------|
| `op` | (any JSON; routed to handler) | Client sends edit intent; server handler is currently a no-op |
| `cursor` | Object (e.g. position fields); merged with `userId`, `displayName`, `avatarColor` from JWT | Client cursor move |
| `pong` | ignored | Reply to server `ping` within timeout |

Malformed JSON or unknown `type` → server sends `error` (below).

**Server → client**

| `type` | Payload | When |
|--------|---------|------|
| `connected` | `{ sessionId, user }` — `user` is decoded JWT payload | Immediately after connection |
| `ping` | — | Heartbeat every 15s; expect `pong` within 5s |
| `presence` | `{ users: UserMeta[] }` — each stringified meta from Redis hash | After join/leave and presence refresh |
| `cursor` | `{ userId, displayName, avatarColor, ...clientPayload }` | Another client sent `cursor` (same process only) |
| `error` | `{ code: "INVALID_FRAME" }` | Bad JSON or unsupported `type` |

---

## OT Engine

**Path:** `server/src/ot/engine.js`

**Op shape:** `{ type: "insert" \| "delete", position: number, text?: string, length?: number }`

| Export | Role |
|--------|------|
| `apply(document, op)` | Returns new string; throws on bad bounds or unknown `type` |
| `transform(op1, op2)` | Returns `op1′` so `op1′` applies after `op2` as intended |
| `compose(op1, op2)` | Single op equivalent to `op1` then `op2` when representable; throws otherwise |

**Convergence (diamond property):** For any string `doc` and concurrent ops `op1`, `op2`,

`apply(apply(doc, op2), transform(op1, op2)) === apply(apply(doc, op1), transform(op2, op1))`.

Tests assert this via `assertConverges` in `server/src/ot/engine.test.js` across insert/insert, insert/delete, delete/insert, delete/delete.

---

## Data Models

**User** (`server/src/models/User.js`)

```
email:        String, required, unique, lowercase, trim
passwordHash: String, required
displayName:  String, required, trim
avatarColor:  String, required, /^#[0-9A-Fa-f]{6}$/
createdAt:    Date, default Date.now
```

**Session** (`server/src/models/Session.js`)

```
_id:           String (set explicitly, nanoid in service)
title:         String, required, trim
language:      String, required, trim
owner:         ObjectId ref User, required
collaborators: [ObjectId ref User]
revision:      Number, default 0
snapshot:      String, default ""
expiresAt:     Date (optional)
isLocked:      Boolean, default false
createdAt:     Date (timestamps)
updatedAt:     Date (timestamps)
```

**Operation** (`server/src/models/Operation.js`)

```
sessionId:    String ref Session, required, indexed
userId:       String, required
revision:     Number, required
ops:          [{ type: "insert"|"delete"|"retain", position?, text?, length? }]  // subdocs, _id: false
timestamp:    Date, default Date.now
acknowledged: Boolean, default false
```

---

## Infrastructure

`docker-compose.yml` runs:

- **mongo:7** — `27017:27017`
- **redis:7-alpine** — `6379:6379`
- **app** (image built from repo `Dockerfile`) — `3000:3000`, `env_file: .env`, overrides `MONGODB_URI` / `REDIS_URL` / `PORT` for in-network services

```bash
docker compose up --build
```

---

## Design Rationale

**OT vs CRDT:** CRDTs hide merge semantics; OT keeps every transform case explicit and testable. This codebase uses a small insert/delete op model with a proved diamond property in Jest.

**Raw `ws` vs Socket.io:** Full control over upgrade, heartbeat, and message shape; no hidden multiplexing or retry semantics that complicate ordering.

**MongoDB for sessions:** Flexible schema for session metadata, snapshots, and op history; `Session._id` is a short string id for readable URLs.

**Redis pub/sub for fan-out:** A single Node process only owns its connected sockets. Pub/sub decouples broadcast from the process: any number of instances can `SUBSCRIBE` to `session:{id}:ops` and fan messages to their local connections, which is the usual pattern for horizontal scale without sticky sessions.

**Two Redis clients (`redisPub` + `redisSub`):** A connection that has entered `SUBSCRIBE` mode cannot run arbitrary commands on that same connection. Dedicated publisher and subscriber clients are the correct pattern per Redis protocol rules, not an implementation quirk.

---

## Getting Started

```bash
cp .env.example .env
```

Set at minimum: `MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`, `PORT` (compose forces `PORT=3000` and service URLs for `app`).

```bash
docker compose up --build
```

Health: `http://localhost:3000/health` → `{ "status": "ok" }`.

Local Node (no Docker): `cd server`, copy/configure `.env`, `npm install`, `npm start` — default `PORT` in `server/.env.example` is `3001`.

---

## Testing

From `server/`:

```bash
npm test
```

Jest runs `server/src/ot/engine.test.js` against `apply`, `transform`, `compose`. Concurrency cases covered: insert/insert, insert/delete, delete/insert, delete/delete (including diamond/convergence checks).
