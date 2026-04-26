# Quickstart

Get an OpenRush instance running, create an AgentDefinition, and stream a live Agent run — in three steps.

Target runtime: Node.js 22+, pnpm 10+, Docker + Docker Compose. Estimated time: ~5 minutes.

---

## 1. Install and start the platform

```bash
# Clone and install
git clone https://github.com/kanyun-rush/open-rush.git
cd open-rush
pnpm install

# Start Postgres + Redis + MinIO (Docker Compose)
pnpm db:up
pnpm db:push            # push schema to PG

# Configure env for each app (.env.example -> .env.local)
cp apps/web/.env.example apps/web/.env.local
cp apps/control-worker/.env.example apps/control-worker/.env.local
cp apps/agent-worker/.env.example apps/agent-worker/.env.local
```

Edit `apps/web/.env.local`:

- `ANTHROPIC_API_KEY=...` (or switch to Bedrock — see `apps/agent-worker/.env.example`).
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` — create a GitHub OAuth App at <https://github.com/settings/developers> with callback `http://localhost:3000/api/auth/callback/github`.

Start dev servers (web + control-worker + agent-worker in parallel):

```bash
pnpm dev
# → Web UI: http://localhost:3000
```

Sign in via GitHub to create your first `user` row. A default project is created on first login.

---

## 2. Mint a service token

Service tokens authenticate API calls without a browser session. Tokens are session-gated at creation time (the `POST /api/v1/auth/tokens` endpoint rejects service-token bearers — see [`specs/service-token-auth.md`](../specs/service-token-auth.md)).

**Option A — from the Web UI**: go to `Settings → API Tokens → New token`, pick scopes, and copy the plaintext once.

**Option B — via API after a session cookie**: sign in, copy the `next-auth.session-token` cookie, then:

```bash
# expiresAt must be strictly in the future AND ≤ 90 days from now.
EXPIRES_AT=$(date -u -v+30d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
          || date -u -d "+30 days" +%Y-%m-%dT%H:%M:%SZ)

curl -X POST http://localhost:3000/api/v1/auth/tokens \
  -H 'Content-Type: application/json' \
  -H 'Cookie: next-auth.session-token=<your-session-cookie>' \
  -d "{
    \"name\": \"quickstart\",
    \"scopes\": [
      \"agent-definitions:read\", \"agent-definitions:write\",
      \"agents:read\", \"agents:write\",
      \"runs:read\", \"runs:write\", \"runs:cancel\"
    ],
    \"expiresAt\": \"$EXPIRES_AT\"
  }"
# => { "data": { "id": "...", "token": "sk_...", ... } }
```

Save the plaintext `sk_...` as `$OPENRUSH_TOKEN` — it is only shown once.

```bash
export OPENRUSH_TOKEN=sk_...
export OPENRUSH_BASE=http://localhost:3000
export OPENRUSH_PROJECT=<your-project-uuid>   # visible in the Web UI URL after login
```

---

## 3. Create an AgentDefinition, launch an Agent, stream events

### 3.1 Create an AgentDefinition (blueprint)

```bash
curl -X POST "$OPENRUSH_BASE/api/v1/agent-definitions" \
  -H "Authorization: Bearer $OPENRUSH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"projectId\": \"$OPENRUSH_PROJECT\",
    \"name\": \"echo-bot\",
    \"providerType\": \"claude-code\",
    \"model\": \"claude-sonnet-4-5\",
    \"systemPrompt\": \"You are a concise assistant.\",
    \"allowedTools\": [\"Bash\", \"Read\", \"Write\"],
    \"skills\": [],
    \"mcpServers\": [],
    \"maxSteps\": 20,
    \"deliveryMode\": \"chat\"
  }"
# => { "data": { "id": "<definitionId>", "currentVersion": 1, ... } }
```

### 3.2 Create an Agent (one task/conversation) and start the first Run

`POST /api/v1/agents` creates both the Agent and its first Run when `initialInput` is supplied.

```bash
curl -X POST "$OPENRUSH_BASE/api/v1/agents" \
  -H "Authorization: Bearer $OPENRUSH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"projectId\": \"$OPENRUSH_PROJECT\",
    \"definitionId\": \"<definitionId>\",
    \"mode\": \"chat\",
    \"initialInput\": \"List the files in /tmp and count them.\"
  }"
# => { "data": { "agent": { "id": "<agentId>", "activeRunId": "<runId>", ... }, "firstRunId": "<runId>" } }
```

### 3.3 Stream events via SSE

```bash
curl -N "$OPENRUSH_BASE/api/v1/agents/<agentId>/runs/<runId>/events" \
  -H "Authorization: Bearer $OPENRUSH_TOKEN" \
  -H 'Accept: text/event-stream'
```

You'll see a `text/event-stream` with `id: <seq>` frames carrying [AI SDK UIMessageChunk](https://sdk.vercel.ai/) payloads plus OpenRush-specific `data-openrush-*` extensions:

```
id: 1
data: {"type":"start","messageId":"msg_1"}

id: 2
data: {"type":"text-delta","id":"msg_1","delta":"I'll list"}

id: 3
data: {"type":"tool-input-available","toolCallId":"call_1","toolName":"Bash","input":{"command":"ls /tmp"}}

id: 4
data: {"type":"tool-output-available","toolCallId":"call_1","output":{...}}

id: 5
data: {"type":"data-openrush-run-done","data":{"status":"success"}}
```

**Reconnect after disconnection**: pass `Last-Event-ID: <last seq>` header. The server replays `run_events` rows with `seq > N`, then attaches to the active-run notification path (handler-side choice — polling by default; pub/sub / hybrid are client-transparent alternatives). No query-string cursor is used — single protocol.

### 3.4 Append a follow-up message (second Run)

```bash
curl -X POST "$OPENRUSH_BASE/api/v1/agents/<agentId>/runs" \
  -H "Authorization: Bearer $OPENRUSH_TOKEN" \
  -H 'Idempotency-Key: '"$(uuidgen)" \
  -H 'Content-Type: application/json' \
  -d '{"input": "Now print the first 3 file names."}'
```

`Idempotency-Key` is optional; when present it gives a 24-hour "same key + same body → same run" guarantee (see [`specs/managed-agents-api.md` §幂等性](../specs/managed-agents-api.md)).

### 3.5 Cancel a run

```bash
curl -X POST "$OPENRUSH_BASE/api/v1/agents/<agentId>/runs/<runId>/cancel" \
  -H "Authorization: Bearer $OPENRUSH_TOKEN"
# => { "data": { "status": "cancelled", ... } }
```

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `curl` returns `401 UNAUTHORIZED` | Token missing / expired / revoked. Re-issue and export `OPENRUSH_TOKEN`. |
| `403 FORBIDDEN` with a valid token | Token scopes too narrow. Re-issue with the scope listed in [`specs/managed-agents-api.md` §Scope 矩阵](../specs/managed-agents-api.md). |
| `503` on every `/api/v1/*` call | Feature flag `OPENRUSH_V1_ENABLED` is off. Set it to `true` in `apps/web/.env.local`. |
| SSE immediately closes after replay | `runs.status` already reached a state-machine terminal (`completed` / `failed`; wire shows `cancelled` for user-cancels). Spec: terminal runs full-replay then close — not a bug. |
| Agent worker can't reach Claude | Verify `ANTHROPIC_API_KEY` / Bedrock creds in `apps/agent-worker/.env.local`. |

---

## Next steps

- [`docs/api.md`](./api.md) — full endpoint reference, auth, SSE protocol.
- [`specs/managed-agents-api.md`](../specs/managed-agents-api.md) — binding contract, status codes, E2E scenarios.
- [`specs/service-token-auth.md`](../specs/service-token-auth.md) — scopes, rotation, revocation.
- [`specs/agent-definition-versioning.md`](../specs/agent-definition-versioning.md) — PATCH semantics and `If-Match`.
- TypeScript SDK (`@open-rush/sdk`) — ships alongside OpenAPI spec once task-16 lands; see the package README.
