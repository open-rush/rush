# OpenRush API Reference

OpenRush exposes a stable `/api/v1/*` contract for external callers (rush-app, CLI, third-party SDKs). This page is a reader-friendly index; the binding spec lives in [`specs/managed-agents-api.md`](../specs/managed-agents-api.md). A machine-readable OpenAPI document is planned at `docs/specs/openapi-v0.1.yaml` once **task-15** lands (see [`docs/execution/TASKS.md`](./execution/TASKS.md) for live status).

- **Base URL**: `http(s)://<your-openrush-host>`
- **Versioning**: URL-prefixed (`/api/v1/`). Non-breaking additions in place; breaking changes move to `/api/v2/`. v1 is supported ≥ 6 months after v2 is published.
- **Formats**: `application/json` request/response; `text/event-stream` for `.../events`.
- **Schemas**: authoritative Zod types live in [`packages/contracts/src/v1/`](../packages/contracts/src/v1).

---

## Authentication

A unified middleware (see [`apps/web/lib/auth/unified-auth.ts`](../apps/web/lib/auth/unified-auth.ts)) accepts two auth schemes across `/api/v1/*`. Individual endpoints may further restrict which scheme is allowed (for example, `POST /api/v1/auth/tokens` is session-only so that service tokens cannot mint more service tokens):

| Scheme | Header | Scopes | Use case |
| --- | --- | --- | --- |
| NextAuth session | `Cookie: next-auth.session-token=...` | Implicit `['*']` | Browser UI, human users |
| Service Token | `Authorization: Bearer sk_...` | Explicit list | CLI, CI, SDKs |

**Service tokens**: mint via `POST /api/v1/auth/tokens` (session-only — service tokens cannot mint service tokens). The plaintext `token` is returned **once**; store it immediately. `expiresAt` is required and must be within 90 days. Per-user cap: 20 active tokens. See [`specs/service-token-auth.md`](../specs/service-token-auth.md) for the guardrails.

### Scope matrix (summary)

```
agent-definitions:read  agent-definitions:write
agents:read             agents:write
runs:read               runs:write           runs:cancel
vaults:read             vaults:write
projects:read           projects:write
```

Session-authenticated calls implicitly carry `*` and bypass scope checks. Service tokens MUST declare explicit scopes and cannot claim `*`.

The definitive per-endpoint scope table lives in [`specs/service-token-auth.md` §Scope 定义](../specs/service-token-auth.md).

---

## Endpoint index (24 endpoints)

| Group | Method + Path | Scope | Implementation |
| --- | --- | --- | --- |
| **Auth** (3) | `POST   /api/v1/auth/tokens` | session-only | `apps/web/app/api/v1/auth/tokens/route.ts` |
| | `GET    /api/v1/auth/tokens` | owner self | 同上 |
| | `DELETE /api/v1/auth/tokens/:id` | owner self | `apps/web/app/api/v1/auth/tokens/[id]/route.ts` |
| **AgentDefinition** (6) | `POST   /api/v1/agent-definitions` | `agent-definitions:write` | `apps/web/app/api/v1/agent-definitions/route.ts` |
| | `GET    /api/v1/agent-definitions` | `agent-definitions:read` | 同上 |
| | `GET    /api/v1/agent-definitions/:id` (`?version=N`) | `agent-definitions:read` | `apps/web/app/api/v1/agent-definitions/[id]/route.ts` |
| | `PATCH  /api/v1/agent-definitions/:id` (requires `If-Match`) | `agent-definitions:write` | 同上 |
| | `GET    /api/v1/agent-definitions/:id/versions` | `agent-definitions:read` | `apps/web/app/api/v1/agent-definitions/[id]/versions/route.ts` |
| | `POST   /api/v1/agent-definitions/:id/archive` | `agent-definitions:write` | `apps/web/app/api/v1/agent-definitions/[id]/archive/route.ts` |
| **Agent** (4) | `POST   /api/v1/agents` | `agents:write` | `apps/web/app/api/v1/agents/route.ts` |
| | `GET    /api/v1/agents` | `agents:read` | 同上 |
| | `GET    /api/v1/agents/:id` | `agents:read` | `apps/web/app/api/v1/agents/[id]/route.ts` |
| | `DELETE /api/v1/agents/:id` | `agents:write` | 同上 |
| **Run** (5) | `POST   /api/v1/agents/:id/runs` (opt. `Idempotency-Key`) | `runs:write` | `apps/web/app/api/v1/agents/[agentId]/runs/route.ts` |
| | `GET    /api/v1/agents/:id/runs` | `runs:read` | 同上 |
| | `GET    /api/v1/agents/:id/runs/:runId` | `runs:read` | `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/route.ts` |
| | `GET    /api/v1/agents/:id/runs/:runId/events` (SSE, `Last-Event-ID`) | `runs:read` | `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/events/route.ts` |
| | `POST   /api/v1/agents/:id/runs/:runId/cancel` | `runs:cancel` | `apps/web/app/api/v1/agents/[agentId]/runs/[runId]/cancel/route.ts` |
| **Vault** (3) | `POST   /api/v1/vaults/entries` | `vaults:write` | `apps/web/app/api/v1/vaults/entries/route.ts` |
| | `GET    /api/v1/vaults/entries` | `vaults:read` | 同上 |
| | `DELETE /api/v1/vaults/entries/:id` | `vaults:write` | `apps/web/app/api/v1/vaults/entries/[id]/route.ts` |
| **Registry** (2) | `GET    /api/v1/skills` | `projects:read` | *(task-15 OpenAPI only; existing UI routes stay for M4)* |
| | `GET    /api/v1/mcps` | `projects:read` | 同上 |
| **Project** (3) | `POST   /api/v1/projects` | `projects:write` | 同上 |
| | `GET    /api/v1/projects` | `projects:read` | 同上 |
| | `GET    /api/v1/projects/:id` | `projects:read` | 同上 |

---

## Request / response conventions

### Envelope

Every JSON response uses one of:

```json
{ "data": { /* resource */ } }
```

```json
{ "data": [ /* rows */ ], "nextCursor": "opaque" | null }
```

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Definition has been modified since your last read",
    "hint": "Fetch the latest version and retry"
  }
}
```

### Error codes

| Code | HTTP | Trigger |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | No valid auth |
| `FORBIDDEN` | 403 | Valid auth, insufficient scope or resource ownership |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 400 | Body/query/header fails Zod validation |
| `VERSION_CONFLICT` | 409 | Optimistic concurrency: `If-Match` mismatch |
| `IDEMPOTENCY_CONFLICT` | 409 | Same `Idempotency-Key` replayed with a different body hash |
| `RATE_LIMITED` | 429 | Reserved for P2 — v0.1 does not enforce |
| `INTERNAL` | 500 | Server-side failure |

### Pagination

- Request: `?limit=50&cursor=<opaque>` (limit ≤ 200, default 50).
- Response: `{ "data": [...], "nextCursor": "..." | null }`.

### Idempotency (only `POST /api/v1/agents/:id/runs`)

- Header: `Idempotency-Key: <url-safe string, ≤ 160 chars>` — UUIDv4 recommended.
- Window: 24 hours.
  - Same key + same canonical body → returns the original run.
  - Same key + different body → `409 IDEMPOTENCY_CONFLICT`.
  - Different key → new run.
- Other POSTs do not guarantee idempotency in v0.1; use application-level de-duplication.

---

## Event stream (SSE)

### Request

```
GET /api/v1/agents/:agentId/runs/:runId/events
Authorization: Bearer sk_...
Accept: text/event-stream
Last-Event-ID: 42          # optional, resume from seq > 42
```

### Response framing

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

id: 43
data: {"type":"text-delta","id":"msg_1","delta":"hello"}

id: 44
data: {"type":"tool-input-available","toolCallId":"c1","toolName":"Read","input":{...}}
```

- `id:` — monotonic per-run `seq` (used by browsers to auto-set `Last-Event-ID` on retry).
- `data:` — one JSON value per frame, conforming to the `runEventPayloadSchema` discriminated union in [`packages/contracts/src/v1/runs.ts`](../packages/contracts/src/v1/runs.ts).

### Payload types

Aligned with **AI SDK v6 UIMessageChunk** (wire-level streaming shape used by `useChat`). No schema rewrite is needed on the client side:

- Text: `text-start` / `text-delta` / `text-end`
- Reasoning: `reasoning-start` / `reasoning-delta` / `reasoning-end`
- Tool lifecycle: `tool-input-start` / `tool-input-delta` / `tool-input-available` / `tool-output-available` / `tool-output-error`
- Stream / step markers: `start` / `finish` / `error` / `start-step` / `finish-step`
- Generic data: `data-<key>` (`<key>` matches `[A-Za-z0-9_-]+`)
- OpenRush extensions (`data-openrush-*` reserved subset):
  - `data-openrush-run-started` — `{ runId, agentId, definitionVersion }`
  - `data-openrush-run-done` — `{ status: "success"|"failed"|"cancelled", error? }`
  - `data-openrush-usage` — `{ tokensIn, tokensOut, costUsd }`
  - `data-openrush-sub-run` — `{ parentRunId, childRunId }`

### Reconnect protocol

Single protocol, `Last-Event-ID` only (no query cursor):

1. Client disconnects at `seq = N`.
2. Client reconnects with `Last-Event-ID: N` (browsers set this automatically from the last `id:` field).
3. Server replays `SELECT * FROM run_events WHERE run_id = ? AND seq > N ORDER BY seq`.
4. Server then attaches to the active-run notification path for live events.
5. When `runs.status` reaches a state-machine terminal (`completed` or `failed`; the wire shows `cancelled` for user-cancels), the server replays any trailing events then closes the connection.

**Invariants (hold regardless of handler choice)**:

- `run_events` is the single-writer source of truth (control-worker `EventStore`, see [`packages/control-plane`](../packages/control-plane)).
- Every SSE frame carries `id: <seq>` — on both replay and live paths.
- `seq` is strictly monotonic; live `seq` is always greater than the largest replay `seq`.
- Connection close is driven by `runs.status` reaching state-machine terminal — **not** by the `data-openrush-run-done.status` field, which is a display-layer hint only.

### Live-notification implementation (handler choice, client-transparent)

How the server is notified of new events on an active run is a handler-side decision and does **not** affect the wire protocol:

| Option | Mechanism | When |
| --- | --- | --- |
| `run_events` polling | Periodic (~500 ms) query for `seq > lastSentSeq` | **P0 default** — smallest blast radius, no Redis dependency |
| StreamRegistry pub/sub | Subscribe to Redis channel, publish forwards immediately | P1+ — lower latency on active runs |
| Hybrid | Polling fallback plus pub/sub fast-path | P2+ — high-load production |

The current `GET /api/v1/agents/:agentId/runs/:runId/events` handler (task-14) uses **polling**. Future swaps to pub/sub or hybrid are transparent to clients because the invariants above remain intact. See [`specs/managed-agents-api.md` §断线重连, §实时通知实现选项](../specs/managed-agents-api.md) for the binding decision trail.

---

## Machine-readable spec (OpenAPI)

The canonical machine-readable document will be maintained at `docs/specs/openapi-v0.1.yaml` and validated by `scripts/validate-openapi.ts` in CI. Both artefacts land with **task-15**; until then this Markdown page plus the Zod schemas in `packages/contracts/src/v1/*` are the binding references.

Once published, you will be able to render the spec with any standards-compliant tool, e.g. Swagger UI:

```bash
docker run --rm -p 8080:8080 \
  -e SWAGGER_JSON=/spec/openapi-v0.1.yaml \
  -v "$PWD/docs/specs:/spec" \
  swaggerapi/swagger-ui
# → http://localhost:8080
```

Or Redoc:

```bash
npx @redocly/cli preview-docs docs/specs/openapi-v0.1.yaml
```

---

## TypeScript SDK

`@open-rush/sdk` is the planned typed TypeScript client (request/response types, SSE consumer with `Last-Event-ID` auto-reconnect). It will be published from a `packages/sdk` workspace as part of **task-16**. Until the SDK is available, a typed client can be assembled directly from the Zod contracts in `packages/contracts/src/v1/*`.

---

## Deprecations

Routes under `/api/*` (no `/v1/` prefix) are the legacy Web UI API surface. They are removed as part of task-19 once the browser code finishes its migration. The following are **intentionally retained**:

- `/api/auth/[...nextauth]` — NextAuth.js callbacks
- `/api/health` — liveness probe
- Web UI-only actions that don't fit the REST contract (e.g. `POST /api/skills/:id/star`, `POST /api/mcps/:id/install`, `PATCH /api/projects/:id/members/:userId`, `POST /api/chat/:id/generate-title`). These accept session cookies only and never service tokens.

External integrations **must** target `/api/v1/*` only.
