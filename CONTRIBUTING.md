# Contributing to Lux

Thanks for your interest in contributing to Lux! This guide covers everything you need to get started.

## Development Setup

### Prerequisites

- Node.js 22+
- pnpm 10+
- Docker (for PostgreSQL + Redis)

### Getting Started

```bash
# Clone the repo
git clone https://github.com/open-rush/lux.git
cd rush

# Install dependencies
pnpm install

# Start PostgreSQL (pgvector) + Redis
docker compose -f docker/docker-compose.dev.yml up -d

# Build all packages
pnpm build

# Run tests
pnpm test

# Start dev servers
pnpm dev
```

### Project Structure

```
apps/
  web/              # Next.js frontend + Control API
  control-worker/   # pg-boss task orchestration
  agent-worker/     # Hono HTTP server (runs inside sandbox)

packages/
  contracts/        # Zod schemas + enums + state machine
  db/               # Drizzle ORM schema + PostgreSQL client
  control-plane/    # Business logic (RunService, AgentService)
  sandbox/          # SandboxProvider interface + OpenSandbox
  agent-runtime/    # AI Provider interface + Claude Code
  stream/           # Redis-backed resumable SSE
  ...
```

See [AGENTS.md](./AGENTS.md) for the full architecture guide.

## Workflow

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add new feature
fix(scope): fix a bug
docs(scope): update documentation
test(scope): add or update tests
refactor(scope): refactor without behavior change
chore(scope): tooling, dependencies, CI
```

Scope is typically the package or app name: `contracts`, `db`, `web`, `agent`, `stream`, etc.

### Quality Gates

Before committing, ensure all checks pass:

```bash
pnpm build    # Build all packages
pnpm check    # TypeScript type checking
pnpm lint     # Biome lint
pnpm test     # Run all tests
```

### Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes following the code conventions
3. Write or update tests for any logic changes
4. Ensure all quality gates pass
5. Open a PR with a clear title and description

### PR Description Format

```markdown
## Summary
- What changed and why

## Test Plan
- How you verified the changes
```

### Code Conventions

- TypeScript strict mode, ESM only
- No `any` (Biome enforces this)
- 2-space indent, single quotes, trailing commas, semicolons
- Packages built with tsup (ESM + CJS)
- Workspace references use `"workspace:*"`

## Testing

| Layer | Engine | Docker | Purpose |
|-------|--------|--------|---------|
| PGlite | @electric-sql/pglite | No | Schema CRUD, FK constraints, business logic |
| Docker integration | pgvector/pgvector:pg16 | Yes | pgvector, connection pooling, real network |

Every commit with logic changes must include tests.

## Specs

For significant design decisions, we maintain specs in `specs/`. If your change alters architectural behavior, update or create the relevant spec. See [AGENTS.md](./AGENTS.md) for what belongs in a spec.

## Questions?

Open a [discussion](https://github.com/open-rush/lux/discussions) or an issue.
