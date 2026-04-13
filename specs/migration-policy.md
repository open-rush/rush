# Schema Migration Policy

## Decisions

### Tool: Drizzle Kit

All migrations are generated and managed by `drizzle-kit`. Hand-written SQL is allowed only for data migrations that Drizzle cannot express.

### Migration Workflow

```
1. Edit schema in packages/db/src/schema/
2. Generate: pnpm --filter @lux/db db:generate (auto-builds before generating)
3. Review the generated SQL in packages/db/drizzle/
4. Test: pnpm --filter @lux/db test (PGlite) + test:integration (Docker)
5. Commit schema + migration together
```

> `db:generate` auto-runs `tsup` build before `drizzle-kit generate` because drizzle-kit resolves from `dist/`. This ensures the migration always reflects the latest schema source.

### Naming Convention

Drizzle auto-generates names (`0000_xxx.sql`, `0001_xxx.sql`). We don't rename them — the numeric prefix is the version.

### Forward-Only in Production

We use Drizzle's forward-only migration model:
- Each migration is an up-only SQL file
- Rollback = create a new migration that reverses the change
- No automatic down migrations (they're error-prone for data-destructive changes)

### Destructive Change Protocol

For column drops, table drops, or type changes:
1. Add new column/table first (migration N)
2. Deploy code that writes to both old and new
3. Backfill data (migration N+1)
4. Deploy code that reads from new only
5. Drop old column/table (migration N+2)

### CI Gate

CI runs migrations on a clean database to verify the migration chain is replayable:

```bash
# In CI: start fresh PG, apply all migrations, verify schema
docker run --rm -e POSTGRES_DB=rush -e POSTGRES_USER=rush -e POSTGRES_PASSWORD=rush \
  pgvector/pgvector:pg16 &
DATABASE_URL=postgresql://rush:rush@localhost:5432/rush pnpm --filter @lux/db db:migrate
```

### Production Backup

Before running migrations in production:

```bash
pg_dump -Fc $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).dump
```

This is the operator's responsibility, not automated by Lux (self-hosted = operator controls infrastructure).

### Required PostgreSQL Extensions

The Docker Compose init script (`docker/init-db/01-extensions.sql`) ensures these extensions are available:
- `uuid-ossp` — UUID generation functions
- `pgcrypto` — cryptographic functions (includes `gen_random_uuid()` for PG < 13)
- `vector` — pgvector for future memory/embedding features

`gen_random_uuid()` is built into PostgreSQL 13+, but we keep the pgcrypto extension for backward compatibility.

### Schema + Migration Must Be Committed Together

A PR that changes `packages/db/src/schema/` must include the corresponding migration in `packages/db/drizzle/`. CI will fail if schema changes don't have matching migrations.
