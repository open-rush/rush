# agent-c-docs-fe — progress

## task-17: README v2 + quickstart + api docs

### Decisions

- **Slogan aligned** with plan §1: "Run managed agents on your own infrastructure. Claude Code native. Registry included." Replaced the Chinese one-liner on line 3.
- **Differentiation table** added for `openclaw-managed-agents` directly (positioning / Registry / persistence / event stream / version control / credentials / API / sandbox / Web UI). Kept the adjacent-categories table as a secondary comparison so readers still see where OpenRush sits vs. bolt / Cursor / LangGraph / etc.
- **Quickstart** kept to 3 numbered steps (Install → Token → Create+Stream) in the README. Full expanded walkthrough (curl, troubleshooting, SSE reconnect, follow-up runs, cancel) goes in `docs/quickstart.md`.
- **API docs**: `docs/api.md` authored as reader-friendly index — per-endpoint table with scopes + implementation paths, envelope/error/pagination conventions, SSE protocol, and pointers to OpenAPI + SDK (both marked "landing in task-15 / task-16").
- **OpenAPI / SDK**: neither is merged yet. README and docs reference them with file paths but note that until then, `packages/contracts/src/v1/*` Zod types are authoritative. This matches team-lead guidance "先写纯 curl 示例,SDK merge 后再单独 PR 补 SDK usage".
- **Badges**: added status / license / node / pnpm / TypeScript / Postgres badges at the top of README.
- **Milestones**: re-labelled M4 from "E2E 测试、OTEL、K8s 部署、文档" to "Managed-agents API" so the README reflects the current deliverable set; linked to `docs/execution/TASKS.md` for live status.
- **Language**: switched the user-facing top-half of README to English (slogan, value prop, comparison, quickstart, status, API pointers) since the audience is external integrators. Kept the architecture / platform-capabilities / tech stack sections bilingual-Chinese (historical content) — didn't touch them beyond minor section header cleanup to keep the diff focused on task-17 scope.

### Verify

- `./docs/execution/verify.sh task-17` → PASS.
  - Build ✅, Check ✅, Lint ✅, Test ✅ (397 web tests pass), Protected files check ✅, task-specific presence check ✅ (README + quickstart + api.md all exist).

### Files touched

- `README.md` — rewrote header, differentiation section, milestones, quickstart, API-reference anchor, contributors/license headings to English.
- `docs/quickstart.md` — new (3-step guide with curl).
- `docs/api.md` — new (endpoint index, auth, error codes, SSE protocol).
- `docs/execution/current_tasks/task-17.lock` — created, will remove before commit.
- `docs/execution/progress/agent-c-docs-fe.md` — this file.

### Sparring

Running via Codex next.

---

## task-19 (upcoming)

Waiting for task-18 (Agent-C-e2e) to merge — E2E is the gate for task-19. Plan:

- **Step 1 PR**: migrate front-end fetch to `/api/v1/*`, keep legacy routes, run manual regression (login → create AgentDefinition → launch Agent → SSE → cancel). Record logs/screenshots here.
- **Step 2 PR**: delete legacy routes (per `verify.sh task-19` LEGACY_TO_REMOVE list) + remove `OPENRUSH_V1_ENABLED` guard.

Files still to survey when task-18 merges:
- `apps/web/app/**/*.tsx` (candidates: chat UI, agent detail page, project dashboard).
- `apps/web/app/api/{tasks,runs,chat,conversations,agents,skills,mcps,projects}` — confirm which are legacy before deleting.
