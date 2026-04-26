# agent-step2-relay — progress

## task-19 Step 2: delete legacy routes + finish P0+P1

### Decisions

- Branch: `feat/task-19-step2` from main (588526e).
- Followed handoff doc (`docs/execution/progress/agent-c-docs-fe.md` §task-19 Step 2 handoff) verbatim.
- Blocker decisions (all already approved by team-lead per handoff):
  - **B1** → Option B (frontend rebind). Implemented via new helper
    `apps/web/lib/api/archive-agent.ts`.
  - **B2** → option (c) KEEP legacy `POST /api/agents` + `PATCH /api/agents/:id`
    as UI-only. The legacy `DELETE` method is dead after B1 migration, removed
    from the route file.
  - **B3** → KEEP `POST /api/chat/start` as UI-only (home page 1-step create).
  - **B4** → KEEP `GET /api/conversations` + `GET /api/conversations/:id`
    as UI-only (conversation is a UI concept, not API).

### Deletions performed

Safe-delete (no frontend callers — grep confirmed empty before delete):

- `apps/web/app/api/tasks/` (whole dir — 3 files)
- `apps/web/app/api/runs/` (whole dir — 5 files)
- `apps/web/app/api/chat/route.ts` (only caller was dead `ChatView` component)
- `apps/web/app/api/chat/abort/` (only caller was dead `useStreamStop` hook)
- `apps/web/app/api/projects/[id]/vault/route.ts` (no frontend caller; v1
  `/api/v1/vaults/entries` is the replacement)
- DELETE method in `apps/web/app/api/agents/[id]/route.ts` (no caller after B1
  migration; the file still exposes GET + PATCH as UI-only per B2-(c))

Dead-code garbage-collected (these only existed to support deleted routes):

- `apps/web/components/ai-elements/chat-view.tsx` (no importers — grep confirmed)
- `apps/web/hooks/use-stream-stop.ts` (no importers — grep confirmed)
- `apps/web/lib/ai/stream-abort-registry.ts` + tests (only caller was
  `/api/chat/route.ts` and `/api/chat/abort/route.ts`, both deleted)

### KEEP list (kept per handoff §KEEP + spec §与 Web UI 关系)

These are UI-private and remain on legacy `/api/*`:

- `apps/web/app/api/agents/route.ts` — POST/GET used by agent-studio-client +
  project-agent-manager (B2-(c)).
- `apps/web/app/api/agents/[id]/route.ts` — GET + PATCH only (DELETE removed).
- `apps/web/app/api/chat/start/` — home page 1-step create (B3).
- `apps/web/app/api/chat/[conversationId]/messages/` — per spec §UI-only.
- `apps/web/app/api/chat/[conversationId]/generate-title/` — per spec §UI-only.
- `apps/web/app/api/conversations/` — UI concept, no v1 equivalent (B4).
- `apps/web/app/api/skills/*`, `apps/web/app/api/mcps/*`,
  `apps/web/app/api/skill-groups/*`, `apps/web/app/api/projects/*`
  (except `vault` which was deleted — no v1 equivalents yet; these routes
  are UI-private per spec §与 Web UI 关系).

### B1 implementation (archive + rebind)

Added `apps/web/lib/api/archive-agent.ts` with `archiveAgentDefinition()`
helper. Flow:

1. `GET /api/projects/:projectId/agent` → current binding.
2. `POST /api/v1/agent-definitions/:id/archive`.
3. If `archived.id === currentBefore`, pick next active candidate from the
   caller-provided list and `PUT /api/projects/:projectId/agent`.
4. If archive fails before step 3 — error surfaces to caller, no rebind.
5. If rebind fails after archive — surface "Archive succeeded but rebind
   failed: <msg>" (archive already committed; caller should refresh + retry).

Unit tests: `apps/web/lib/api/__tests__/archive-agent.test.ts` — 6 cases
covering: happy-path rebind, archive-not-current, no-replacement, archive
error, rebind error after archive, current-GET error fallthrough.

Callers migrated:

- `apps/web/components/agents/project-agent-manager.tsx:handleDelete`
- `apps/web/components/agents/agent-studio-client.tsx:handleDelete`

Both previously called `DELETE /api/agents/:id`.

### `verify.sh task-19` — needs coordinator chore PR

**`docs/execution/verify.sh` is protected** (per AGENTS.md). Step 2 runtime
changes reveal two mismatches in the current verify.sh task-19 case that
need a coordinator chore PR *parallel to this PR*:

1. **`LEGACY_TO_REMOVE` list contains 4 paths that have been decided to KEEP**
   (blockers B2/B3/B4 + spec §UI-only):
   - `apps/web/app/api/chat/start` (B3 — KEEP)
   - `apps/web/app/api/conversations` (B4 — KEEP)
   - `apps/web/app/api/agents/route.ts` (B2-(c) — KEEP; POST/GET still used)
   - `apps/web/app/api/agents/[id]/route.ts` (B2-(c) — KEEP; GET+PATCH still
     used. DELETE removed from the file body in this PR.)
2. **Step-4 grep pattern** (`fetch\(['\"]/api/(tasks|runs|chat|conversations)`)
   is too broad: it still catches `/api/chat/start`,
   `/api/chat/[id]/messages`, `/api/chat/[id]/generate-title`, and
   `/api/conversations*` — all legitimate UI-only KEEP routes per spec
   §与 Web UI 关系. Needs a pattern that excludes KEEP endpoints. Suggested
   replacement below.

Proposed diff for the coordinator chore PR:

```diff
 LEGACY_TO_REMOVE=(
   "apps/web/app/api/tasks"
   "apps/web/app/api/runs"
   "apps/web/app/api/chat/route.ts"
-  "apps/web/app/api/chat/start"
   "apps/web/app/api/chat/abort"
-  "apps/web/app/api/conversations"
-  "apps/web/app/api/agents/route.ts"
-  "apps/web/app/api/agents/[id]/route.ts"
   "apps/web/app/api/skills/route.ts"
   ...
   "apps/web/app/api/projects/[id]/vault"
 )
 ...
-LEGACY_FETCH=$(grep -rnE "fetch\(['\"]/api/(tasks|runs|chat|conversations)" \
-  apps/web/app apps/web/components 2>/dev/null | grep -v "/api/v1/" || true)
+# Only delete routes (listed above) are forbidden targets. UI-only
+# `/api/chat/start`, `/api/chat/[id]/messages|generate-title` and
+# `/api/conversations*` are KEEP per spec §与 Web UI 关系 and must NOT
+# match this grep.
+LEGACY_FETCH=$(grep -rnE \
+  "fetch\(['\"\\\`]/api/(tasks|runs|chat/abort)(/|['\"\\\`])|fetch\(['\"\\\`]/api/chat['\"\\\`]" \
+  apps/web/app apps/web/components apps/web/hooks apps/web/lib 2>/dev/null \
+  | grep -v "/api/v1/" || true)
```

(I did NOT apply this change — verify.sh is protected. I've flagged team-lead
via SendMessage so a separate chore PR can ship alongside this Step 2 PR.)

### Verification

All green on `feat/task-19-step2` after rebasing on main at PR #162:

- `pnpm build` ✅ (all 17 tasks, with dummy `DATABASE_URL` + `REDIS_URL`
  in `apps/web/.env` for Next.js page-data collection — not committed).
- `pnpm check` ✅ (TS strict across workspace).
- `pnpm lint` ✅ (3 pre-existing warnings, 2 pre-existing infos, 0 errors —
  baseline preserved).
- `pnpm test` ✅ 409/409 (28 test files, including 6 new
  `archive-agent.test.ts` cases + existing 13 E2E scenarios + 1 integration
  test for vaults + 1 patch-concurrency integration).
- `./docs/execution/verify.sh task-19` ✅ **[PASS] task-19** after
  coordinator PR #162 aligned the LEGACY_TO_REMOVE/KEEP lists + tightened
  grep pattern.

Manual regression not run locally (no docker). Handoff §6-point checklist
is a code-level confirmation only for this PR:

1. Login — untouched (`/api/auth/*` KEEP).
2. Home page list agents — Step 1 migrated (`GET /api/v1/agent-definitions`).
3. Create AgentDefinition — kept on legacy `POST /api/agents` per B2-(c).
4. Start chat + SSE — Step 1 migrated
   (`POST /api/v1/agents/:taskId/runs` + `…/events`).
5. Cancel run — Step 1 migrated (`POST /api/v1/agents/:taskId/runs/:runId/cancel`).
6. Archive AgentDefinition + rebind — **this PR**, new flow implemented +
   unit-tested.

### Files touched

New:
- `apps/web/lib/api/archive-agent.ts`
- `apps/web/lib/api/__tests__/archive-agent.test.ts`
- `docs/execution/progress/agent-step2-relay.md` (this file)

Modified:
- `apps/web/components/agents/project-agent-manager.tsx` — handleDelete now
  uses `archiveAgentDefinition()`.
- `apps/web/components/agents/agent-studio-client.tsx` — same.
- `apps/web/app/api/agents/[id]/route.ts` — removed DELETE method (dead
  after B1 migration); file now exposes GET + PATCH only (UI-only per B2-(c)).

Deleted:
- 13 legacy route files (see §Deletions)
- 3 dead-code files (ChatView, useStreamStop, stream-abort-registry + test)
