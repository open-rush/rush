# Rush Documentation

## Quick Start

```bash
git clone https://github.com/open-rush/rush.git
cd rush
pnpm install
docker compose -f docker/docker-compose.dev.yml up -d
pnpm build
pnpm dev
```

## Architecture

See [AGENTS.md](../AGENTS.md) for the full architecture guide.

### Three-Layer Architecture

```
Browser → apps/web (Next.js) → apps/control-worker (pg-boss) → apps/agent-worker (Hono)
```

### Packages

| Package | Purpose |
|---------|---------|
| contracts | Zod schemas + enums + state machine |
| db | Drizzle ORM schema + PostgreSQL |
| control-plane | Business logic services |
| sandbox | SandboxProvider interface |
| agent-runtime | Budget, retry, rate limiting |
| stream | Redis-backed SSE |
| observability | Logging + OTEL |
| integrations | S3 storage |
| skills | reskill-based skill management |
| mcp | MCP server registry |
| memory | pgvector + hybrid search |

## API Reference

API documentation will be generated from the TypeScript types when the web layer is implemented.

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md).
