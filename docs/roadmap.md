# Open Rush v2 — Roadmap

## Vision

Build a fully open-source AI web builder with a clean three-layer architecture.

**Core Principles:**
- Zero proprietary dependencies — all standard open-source libraries
- Clean-slate schema design (Drizzle ORM), no legacy migration
- Three-layer architecture: Web → Control Worker → Agent Worker (sandboxed)
- Full product capabilities: conversational web building, preview, deployment, Skills/MCP, Memory
- Test-driven: comprehensive test suite as behavior specifications
- Pluggable sandbox: OpenSandbox default, bring your own

---

## Repo Structure

```
open-rush/
├── apps/
│   ├── web/                    # Next.js 16 — User Portal + Control API
│   ├── control-worker/         # Background orchestration — pg-boss consumer, state machine
│   └── agent-worker/           # Hono — Agent execution inside sandbox container
│
├── packages/
│   ├── contracts/              # Zod schemas — zero deps, all type definitions
│   ├── db/                     # Drizzle ORM + PostgreSQL schema + migrations
│   ├── control-plane/          # Orchestration logic (RunService, AgentService, EventStore, FinalizationStateMachine)
│   ├── sandbox/                # SandboxProvider interface (pluggable) + built-in OpenSandboxProvider
│   ├── agent-runtime/          # AI Provider abstraction (Claude, Codex, Gemini, OpenAI)
│   ├── stream/                 # Redis-backed resumable SSE
│   ├── integrations/           # External integrations (GitHub, S3, OAuth)
│   ├── ai-components/          # React AI UI component library
│   ├── skills/                 # Skills runtime (install, discover, execute)
│   ├── mcp/                    # MCP server management (lifecycle, proxy, registry)
│   └── memory/                 # User memory system (embedding, search, personalization)
│
├── specs/
│   ├── architecture/           # System-level constraints and decisions
│   └── features/               # Per-feature behavior contracts
│
├── docker/                     # Dockerfile + compose (local dev)
├── docs/                       # Architecture docs
├── tests/
│   ├── e2e/                    # Playwright E2E tests
│   └── migration-matrix.csv    # Test migration tracking
├── AGENTS.md
├── CLAUDE.md
└── verify.sh
```

---

## Sandbox: OpenSandbox

### Architecture

The control plane manages containers through an external sandbox platform API — never touching Docker/K8s directly:

```
Control Worker → SandboxProvider interface → OpenSandboxProvider → OpenSandbox API → Container
```

### Interface Mapping

| SandboxProvider Method | OpenSandbox SDK Call |
|-----------------------|--------------------|
| `create(image, opts)` | `Sandbox.create({ image, env, networkPolicy, resource })` |
| `get(sandboxId)` | `Sandbox.connect({ sandboxId })` |
| `destroy(sandboxId)` | `sandbox.kill()` |
| `extendTTL(sandboxId, ttl)` | `sandbox.renew(timeoutSeconds)` |
| `exec(sandboxId, cmd)` | `sandbox.commands.run(cmd)` (SSE streaming) |
| `readFile(sandboxId, path)` | `sandbox.files.read(path)` |
| `writeFile(sandboxId, path, content)` | `sandbox.files.write(path, content)` |
| `resolveEndpoint(sandboxId, port)` | `sandbox.getEndpointUrl(port)` |
| — | `sandbox.pause()` / `sandbox.resume()` |
| — | `sandbox.patchEgressRules()` |

### Pluggable Provider Design

```typescript
interface SandboxProvider {
  create(opts: CreateSandboxOpts): Promise<SandboxInfo>;
  get(sandboxId: string): Promise<SandboxInfo>;
  destroy(sandboxId: string): Promise<void>;
  extendTTL(sandboxId: string, ttlSeconds: number): Promise<void>;
  exec(sandboxId: string, command: string): Promise<ExecResult>;
  readFile(sandboxId: string, path: string): Promise<Buffer>;
  writeFile(sandboxId: string, path: string, content: Buffer): Promise<void>;
  listPath(sandboxId: string, path: string): Promise<FileInfo[]>;
  resolveEndpoint(sandboxId: string, port: number): Promise<string>;
}

// Built-in: OpenSandboxProvider (default)
// Community: E2BSandboxProvider, DockerSandboxProvider, FlyMachineProvider, etc.
```

Select via env: `SANDBOX_PROVIDER=opensandbox | e2b | docker`

### Dual-Channel Communication

```
Control Worker
    ├── Channel 1: SandboxProvider (infra) → execd (:44772)
    └── Channel 2: AgentBridge (business) → Agent Worker (Hono :8787)
```

### PoC Validation (Phase 0 Week 1)

| # | Blocker | Pass Criteria |
|---|---------|---------------|
| 1 | Agent Worker + execd coexistence | Stable 30 min, no OOM/crash |
| 2 | SandboxProvider interface coverage | 78 sandbox tests green |
| 3 | Interactive CLI support | SSE streaming complete, SIGINT works |

---

## Phases

### Phase 0: Infrastructure (Week 1-2)

- [ ] OpenSandbox PoC
- [ ] Monorepo skeleton (pnpm, turborepo, biome, vitest, tsup)
- [ ] CI: GitHub Actions
- [ ] Docker Compose (PostgreSQL + Redis + OpenSandbox + MinIO)
- [ ] `packages/contracts` — Zod schemas
- [ ] `packages/db` — Drizzle schema (see below)
- [ ] `packages/stream` — Redis resumable SSE
- [ ] `packages/control-plane` — RunService, EventStore, FinalizationStateMachine
- [ ] `apps/control-worker` — pg-boss consumer + state machine
- [ ] `packages/sandbox` — SandboxProvider + OpenSandboxProvider
- [ ] Env var config + standard OTEL

**Tests:** ~400

### Phase 1: AI Core (Week 3-5)

- [ ] `packages/agent-runtime` — AIProvider + Claude/Codex/Gemini/OpenAI
- [ ] `apps/agent-worker` — Hono + streamText + UIMessageStream
- [ ] Agent Bridge — SSE① communication
- [ ] Checkpoint & Recovery
- [ ] Stream middleware pipeline
- [ ] Agent Executor (prepareAgentContext + executeWithContext)
- [ ] `apps/web` — Next.js 16 + React 19 + Tailwind 4 + shadcn/ui
- [ ] Auth — NextAuth.js v5 (GitHub OAuth)
- [ ] SSE② endpoint

**Tests:** ~1,500

### Phase 2: Product Core — MVP (Week 6-9)

- [ ] Project management (CRUD, templates, members, trash)
- [ ] Conversation system (messages, title generation)
- [ ] File management (S3-compatible)
- [ ] Preview & Dev Server (Vite, HMR, screenshots)
- [ ] Version management (history, publish, rollback)
- [ ] Deployment (S3 + CDN)
- [ ] `packages/ai-components` — 64 React components
- [ ] Template system
- [ ] Permission model (project_members + roles + auth guard)

**Tests:** ~3,000. **Public repo after this phase.**

### Phase 3: Ecosystem (Week 10-13)

- [ ] `packages/skills` — runtime, discovery, permissions
- [ ] `packages/mcp` — registry, lifecycle, probe, config
- [ ] `packages/memory` — pgvector, hybrid search, auto-extraction
- [ ] Agent config system
- [ ] Admin panel

**Tests:** ~4,000

### Phase 4: Polish & Scale (Week 14-16)

- [ ] Observability (standard OTEL)
- [ ] LLM Tracing
- [ ] Rate limiting (Redis)
- [ ] RBAC enhancement
- [ ] i18n (zh/en)
- [ ] Documentation site
- [ ] E2E tests (Playwright)
- [ ] BatchSandbox resource pools + auto-reclaim

**Tests:** ~5,000+

---

## Schema (Drizzle)

```
users          UNIQUE(provider, provider_id), email unique where not null
projects       soft delete, sandbox_type (opensandbox | docker)
project_members  role (owner|editor|viewer), UNIQUE(project_id, user_id)
agents         nullable project_id (global agents)
runs           15-state machine, parent_run_id for follow-ups
conversations  linked to project + optional run
messages       UIMessage jsonb format
run_events     UNIQUE(run_id, cursor)
checkpoints    FK(run_id, event_cursor) → run_events DEFERRABLE
versions       build_status, artifact S3 path
skills         visibility, download/star counts
skill_versions semver + dist_tag
mcp_servers    transport type, config_template
project_mcp_config  per-project MCP config
user_memories  vector(1024), hybrid search
platform_tokens  hashed, expirable
```

---

## Milestones

| Milestone | Week | Tests | Gate |
|-----------|------|-------|------|
| M0: Skeleton | 2 | ~400 | `pnpm build && pnpm test` green |
| M1: Agent Loop | 5 | ~1,500 | prompt → sandbox → browser streaming |
| M2: MVP | 9 | ~3,000 | create → chat → code → preview → deploy |
| M3: Ecosystem | 13 | ~4,000 | skills + MCP + memory working |
| M4: GA | 16 | ~5,000+ | OTEL + RBAC + docs + E2E |

---

## Risks

| Risk | Mitigation |
|------|-----------|
| OpenSandbox PoC fails | SandboxProvider interface; write Docker/E2B adapter |
| Timeline too aggressive | Phase 2 is hard deadline; 3/4 can slip |
| Test migration complex | migration-matrix tracks; allow REPLACED/DROPPED |
| Pause/Resume state loss | Checkpoint mechanism + recovery protocol |
