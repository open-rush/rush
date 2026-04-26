/**
 * End-to-end integration test for the full `/api/v1/*` surface.
 *
 * Covers the 6 scenarios called out in `specs/managed-agents-api.md §E2E 测试`:
 *
 *   1. Service Token 鉴权        — token presence / scope gating
 *   2. AgentDefinition CRUD      — If-Match versioning + snapshot + archive
 *   3. Agent + Run + Event 闭环  — POST /agents → SSE /events → POST /runs
 *                                   → SSE resume → POST /cancel
 *   4. 幂等性                     — POST /runs Idempotency-Key replay + 409
 *   5. Vault                      — encrypted storage, wire strip,
 *                                   injectionTarget persistence
 *   6. 乐观并发                   — two concurrent PATCHers, one wins / one 409
 *
 * Strategy (why an in-process PGlite driver instead of a container):
 *   - The unit tests for each route are already fully-mocked — this file's
 *     job is to wire the real contract validators, real RunService /
 *     AgentDefinitionService / VaultService, and real unified-auth
 *     middleware together behind an in-memory Postgres (PGlite).
 *   - PGlite supports `pg_advisory_xact_lock` / `hashtext(...)` (confirmed
 *     by `patch-concurrency.integration.test.ts` + `drizzle-event-store.test.ts`),
 *     which are the two primitives the idempotent run create + SSE seq
 *     allocator rely on.
 *   - CI doesn't need docker-compose to exercise these scenarios — the
 *     driver is bundled with `@electric-sql/pglite` (dev dep already on
 *     apps/web), so the test runs anywhere `pnpm test` runs.
 *   - The only piece we mock is NextAuth session resolution (`@/auth`):
 *     service-token auth goes through the real DB path.
 */
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@open-rush/db';
import {
  agentDefinitionVersions,
  agents as agentsTable,
  projectMembers,
  projects,
  runEvents,
  runs,
  serviceTokens,
  tasks,
  users,
  vaultEntries,
} from '@open-rush/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashServiceToken } from '@/lib/auth/service-token-service';

// ---------------------------------------------------------------------------
// PGlite bootstrap — shared across all 6 scenarios. TRUNCATE between tests
// keeps isolation. Schema bootstrap mirrors the columns/constraints
// exercised by the routes (kept in sync with `packages/db/src/schema/*`).
// ---------------------------------------------------------------------------

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let pglite: PGlite;
let db: TestDb;

const { mockSession, mockGetDbClient } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockGetDbClient: vi.fn(),
}));

// Replace NextAuth's session factory. The real `authenticate()` middleware
// (unified-auth) calls `auth()` from `@/auth` when no Bearer token is
// present — we return a minimal Session shape here so session-mode paths
// work in tests. Service-token paths bypass this entirely (they resolve
// via the real DB lookup + hash comparison).
vi.mock('@/auth', () => ({
  auth: () => mockSession(),
}));

vi.mock('@open-rush/db', async () => {
  const actual = await vi.importActual<typeof import('@open-rush/db')>('@open-rush/db');
  return {
    ...actual,
    getDbClient: () => mockGetDbClient(),
  };
});

// We DO need to lazy-import the routes AFTER the mocks above are installed,
// otherwise their top-level `import { getDbClient } from '@open-rush/db'`
// captures the real client factory before the mock takes effect.
//
// Type-only aliases keep each route call-site type-checked against the real
// route signatures.
type AgentDefPost = typeof import('@/app/api/v1/agent-definitions/route')['POST'];
type AgentDefGet = typeof import('@/app/api/v1/agent-definitions/route')['GET'];
type AgentDefByIdGet = typeof import('@/app/api/v1/agent-definitions/[id]/route')['GET'];
type AgentDefByIdPatch = typeof import('@/app/api/v1/agent-definitions/[id]/route')['PATCH'];
type AgentDefVersionsGet =
  typeof import('@/app/api/v1/agent-definitions/[id]/versions/route')['GET'];
type AgentDefArchivePost =
  typeof import('@/app/api/v1/agent-definitions/[id]/archive/route')['POST'];
type AgentsPost = typeof import('@/app/api/v1/agents/route')['POST'];
type AgentRunsPost = typeof import('@/app/api/v1/agents/[agentId]/runs/route')['POST'];
type AgentRunEventsGet =
  typeof import('@/app/api/v1/agents/[agentId]/runs/[runId]/events/route')['GET'];
type AgentRunCancelPost =
  typeof import('@/app/api/v1/agents/[agentId]/runs/[runId]/cancel/route')['POST'];
type VaultPost = typeof import('@/app/api/v1/vaults/entries/route')['POST'];
type VaultGet = typeof import('@/app/api/v1/vaults/entries/route')['GET'];

let createAgentDefinition: AgentDefPost;
let listAgentDefinitions: AgentDefGet;
let getAgentDefinitionById: AgentDefByIdGet;
let patchAgentDefinition: AgentDefByIdPatch;
let listAgentDefinitionVersions: AgentDefVersionsGet;
let archiveAgentDefinition: AgentDefArchivePost;
let createAgent: AgentsPost;
let appendRun: AgentRunsPost;
let getRunEvents: AgentRunEventsGet;
let cancelRun: AgentRunCancelPost;
let createVaultEntry: VaultPost;
let listVaultEntries: VaultGet;

beforeAll(async () => {
  // VaultService requires a 32-byte base64 key at service-resolution time.
  process.env.VAULT_MASTER_KEY ??= 'y5yPxvWNZHZx6JBn280nbmleA+zfQaO6kAl4rtlJYVA=';

  pglite = new PGlite();
  db = drizzle(pglite, { schema });
  mockGetDbClient.mockReturnValue(db);

  // Create just the tables the v1 routes touch. Keeping this inline (rather
  // than running the full drizzle-kit push) lets the test start in <200ms
  // without a filesystem migration round-trip.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT,
      email TEXT UNIQUE,
      email_verified_at TIMESTAMPTZ,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      sandbox_provider VARCHAR(50) NOT NULL DEFAULT 'opensandbox',
      default_model VARCHAR(255),
      default_connection_mode VARCHAR(50) DEFAULT 'anthropic',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(project_id, user_id)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS service_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash TEXT NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      name VARCHAR(120) NOT NULL DEFAULT 'New Agent',
      description TEXT,
      icon VARCHAR(50),
      provider_type VARCHAR(50) NOT NULL DEFAULT 'claude-code',
      model VARCHAR(255),
      system_prompt TEXT,
      append_system_prompt TEXT,
      allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
      skills JSONB NOT NULL DEFAULT '[]'::jsonb,
      mcp_servers JSONB NOT NULL DEFAULT '[]'::jsonb,
      max_steps INTEGER NOT NULL DEFAULT 30,
      delivery_mode VARCHAR(20) NOT NULL DEFAULT 'chat',
      is_builtin BOOLEAN NOT NULL DEFAULT false,
      custom_title VARCHAR(200),
      config JSONB,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      active_stream_id TEXT,
      current_version INTEGER NOT NULL DEFAULT 1,
      archived_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_definition_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      snapshot JSONB NOT NULL,
      change_note TEXT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(agent_id, version)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      handoff_summary TEXT,
      head_run_id UUID,
      active_run_id UUID,
      definition_version INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
      conversation_id UUID,
      parent_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'queued',
      prompt TEXT NOT NULL,
      provider VARCHAR(50) NOT NULL DEFAULT 'claude-code',
      connection_mode VARCHAR(50) NOT NULL DEFAULT 'anthropic',
      model_id VARCHAR(255),
      trigger_source VARCHAR(20) NOT NULL DEFAULT 'user',
      active_stream_id TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error_message TEXT,
      attachments_json JSONB,
      agent_definition_version INTEGER,
      idempotency_key VARCHAR(255),
      idempotency_request_hash VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS run_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      payload JSONB,
      seq BIGINT NOT NULL,
      schema_version VARCHAR(10) NOT NULL DEFAULT '1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(run_id, seq)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vault_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope VARCHAR(20) NOT NULL,
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
      owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      credential_type VARCHAR(50) NOT NULL DEFAULT 'env_var',
      encrypted_value TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      injection_target VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT vault_scope_project_check CHECK (
        (scope = 'platform' AND project_id IS NULL) OR
        (scope = 'project' AND project_id IS NOT NULL)
      ),
      CONSTRAINT vault_entries_scope_project_name_idx UNIQUE(scope, project_id, name)
    )
  `);

  // Lazy-import routes after mocks are installed.
  const [
    defs,
    defById,
    defVersions,
    defArchive,
    agentsRoute,
    runsRoute,
    eventsRoute,
    cancelRoute,
    vaults,
  ] = await Promise.all([
    import('@/app/api/v1/agent-definitions/route'),
    import('@/app/api/v1/agent-definitions/[id]/route'),
    import('@/app/api/v1/agent-definitions/[id]/versions/route'),
    import('@/app/api/v1/agent-definitions/[id]/archive/route'),
    import('@/app/api/v1/agents/route'),
    import('@/app/api/v1/agents/[agentId]/runs/route'),
    import('@/app/api/v1/agents/[agentId]/runs/[runId]/events/route'),
    import('@/app/api/v1/agents/[agentId]/runs/[runId]/cancel/route'),
    import('@/app/api/v1/vaults/entries/route'),
  ]);
  createAgentDefinition = defs.POST;
  listAgentDefinitions = defs.GET;
  getAgentDefinitionById = defById.GET;
  patchAgentDefinition = defById.PATCH;
  listAgentDefinitionVersions = defVersions.GET;
  archiveAgentDefinition = defArchive.POST;
  createAgent = agentsRoute.POST;
  appendRun = runsRoute.POST;
  getRunEvents = eventsRoute.GET;
  cancelRun = cancelRoute.POST;
  createVaultEntry = vaults.POST;
  listVaultEntries = vaults.GET;
}, 30000);

afterAll(async () => {
  await pglite.close();
}, 30000);

// ---------------------------------------------------------------------------
// Seeded-per-test fixture data. Each scenario resets the world and gets a
// fresh (user, project) pair + optional service token.
// ---------------------------------------------------------------------------

const BASE = 'https://t.example.com';

let ALICE_ID = '';
let PROJECT_ID = '';

beforeEach(async () => {
  // TRUNCATE in FK-safe order. `RESTART IDENTITY CASCADE` resets default
  // sequences and cascades dependencies so the test fixture is truly clean.
  await db.execute(sql`
    TRUNCATE TABLE
      run_events, runs, tasks, vault_entries, service_tokens,
      agent_definition_versions, agents, project_members, projects, users
    RESTART IDENTITY CASCADE
  `);

  ALICE_ID = randomUUID();
  const [u] = await db
    .insert(users)
    .values({ id: ALICE_ID, name: 'Alice', email: `a-${ALICE_ID}@ex.com` })
    .returning();
  ALICE_ID = u.id;

  const [p] = await db.insert(projects).values({ name: 'P', createdBy: ALICE_ID }).returning();
  PROJECT_ID = p.id;

  // Default session: authenticated as Alice. Individual tests override as
  // needed (e.g. scenario 1 wipes this before the first request).
  mockSession.mockResolvedValue({
    user: { id: ALICE_ID },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Helpers — request builders + service-token seeding.
// ---------------------------------------------------------------------------

/** Seed a service token with `scopes`; returns `{ plaintext, id }`. */
async function seedServiceToken(scopes: string[]): Promise<{ plaintext: string; id: string }> {
  const plaintext = `sk_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
  const hash = hashServiceToken(plaintext);
  const [row] = await db
    .insert(serviceTokens)
    .values({
      tokenHash: hash,
      name: `tok-${scopes.join('-') || 'empty'}`,
      ownerUserId: ALICE_ID,
      scopes,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    })
    .returning();
  return { plaintext, id: row.id };
}

interface ReqInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  query?: Record<string, string>;
}

/** Build a Request targeting one of the /api/v1/* endpoints. */
function req(path: string, init: ReqInit = {}): Request {
  const url = new URL(path, BASE);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) url.searchParams.set(k, v);
  }
  const headers = new Headers(init.headers ?? {});
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Request(url, {
    method: init.method ?? 'GET',
    body: init.body === undefined ? null : JSON.stringify(init.body),
    headers,
    signal: init.signal,
  });
}

/** Promise-based params factory (Next.js 16 passes `params` as a promise). */
function params<T>(data: T): Promise<T> {
  return Promise.resolve(data);
}

/** Read + JSON-parse the response body. */
async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Drain every `\n\n`-separated SSE frame from a response body. */
async function readAllSseFrames(res: Response): Promise<string[]> {
  if (!res.body) throw new Error('response has no body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      frames.push(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf('\n\n');
    }
  }
  if (buffer.length > 0) frames.push(buffer);
  return frames;
}

/** Extract the `id: <n>` prefix from an SSE frame. */
function frameSeq(frame: string): number {
  const match = /^id: (\d+)\n/.exec(frame);
  if (!match) throw new Error(`frame is missing 'id:' line: ${JSON.stringify(frame)}`);
  return Number(match[1]);
}

/** Parse the `data:` payload JSON from an SSE frame. */
function framePayload(frame: string): unknown {
  const lines = frame.split('\n');
  const dataLine = lines.find((l) => l.startsWith('data: '));
  if (!dataLine) throw new Error(`frame is missing 'data:' line: ${JSON.stringify(frame)}`);
  return JSON.parse(dataLine.slice('data: '.length));
}

// Minimal body for `createAgentDefinitionRequestSchema`.
const MINIMAL_DEFINITION_BODY = {
  name: 'Echo',
  providerType: 'claude-code' as const,
  allowedTools: [],
  skills: [],
  mcpServers: [],
  maxSteps: 10,
  deliveryMode: 'chat' as const,
};

/** Convenience: create a definition via the POST route, return its id+version. */
async function createDefinitionViaApi(extra: Record<string, unknown> = {}): Promise<{
  id: string;
  currentVersion: number;
}> {
  const res = await createAgentDefinition(
    req('/api/v1/agent-definitions', {
      method: 'POST',
      body: { projectId: PROJECT_ID, ...MINIMAL_DEFINITION_BODY, ...extra },
    })
  );
  expect(res.status).toBe(201);
  const body = (await readJson<{ data: { id: string; currentVersion: number } }>(res)).data;
  return body;
}

// ---------------------------------------------------------------------------
// Scenario 1 — Service Token 鉴权
// ---------------------------------------------------------------------------

describe('E2E — Scenario 1: Service Token auth', () => {
  it('no Authorization header and no session → 401', async () => {
    mockSession.mockResolvedValue(null);
    const res = await listAgentDefinitions(req('/api/v1/agent-definitions'));
    expect(res.status).toBe(401);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('malformed Bearer sk_* token → 401 (no matching DB row)', async () => {
    mockSession.mockResolvedValue(null);
    const res = await listAgentDefinitions(
      req('/api/v1/agent-definitions', {
        headers: { authorization: 'Bearer sk_totally_bogus_token' },
      })
    );
    expect(res.status).toBe(401);
  });

  it('valid token with matching scope → 200', async () => {
    mockSession.mockResolvedValue(null);
    const { plaintext } = await seedServiceToken(['agent-definitions:read']);
    const res = await listAgentDefinitions(
      req('/api/v1/agent-definitions', {
        headers: { authorization: `Bearer ${plaintext}` },
      })
    );
    expect(res.status).toBe(200);
    const body = await readJson<{ data: unknown[]; nextCursor: string | null }>(res);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('valid token missing the required scope → 403', async () => {
    mockSession.mockResolvedValue(null);
    // Token only has `agents:read`, but we're hitting agent-definitions:read.
    const { plaintext } = await seedServiceToken(['agents:read']);
    const res = await listAgentDefinitions(
      req('/api/v1/agent-definitions', {
        headers: { authorization: `Bearer ${plaintext}` },
      })
    );
    expect(res.status).toBe(403);
    const body = await readJson<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('revoked token → 401 (treated as if absent)', async () => {
    mockSession.mockResolvedValue(null);
    const { plaintext, id } = await seedServiceToken(['agent-definitions:read']);
    await db.execute(sql`UPDATE service_tokens SET revoked_at = now() WHERE id = ${id}`);
    const res = await listAgentDefinitions(
      req('/api/v1/agent-definitions', {
        headers: { authorization: `Bearer ${plaintext}` },
      })
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — AgentDefinition CRUD + 版本化
// ---------------------------------------------------------------------------

describe('E2E — Scenario 2: AgentDefinition versioning', () => {
  it('POST creates v1; PATCH with correct If-Match bumps to v2; GET ?version=1 still returns v1 snapshot', async () => {
    // 2.1 POST → v1
    const created = await createDefinitionViaApi({
      name: 'Translator',
      systemPrompt: 'You translate text.',
    });
    expect(created.currentVersion).toBe(1);

    // 2.2 PATCH If-Match: 1 → v2
    const patchRes = await patchAgentDefinition(
      req(`/api/v1/agent-definitions/${created.id}`, {
        method: 'PATCH',
        headers: { 'if-match': '1' },
        body: { name: 'Translator-Pro', changeNote: 'Upgraded prompt' },
      }),
      { params: params({ id: created.id }) }
    );
    expect(patchRes.status).toBe(200);
    const patched = (await readJson<{ data: { currentVersion: number; name: string } }>(patchRes))
      .data;
    expect(patched.currentVersion).toBe(2);
    expect(patched.name).toBe('Translator-Pro');

    // 2.3 PATCH If-Match: 1 again (stale) → 409 VERSION_CONFLICT
    const stale = await patchAgentDefinition(
      req(`/api/v1/agent-definitions/${created.id}`, {
        method: 'PATCH',
        headers: { 'if-match': '1' },
        body: { name: 'Translator-Stale' },
      }),
      { params: params({ id: created.id }) }
    );
    expect(stale.status).toBe(409);
    const staleBody = await readJson<{ error: { code: string; hint?: string } }>(stale);
    expect(staleBody.error.code).toBe('VERSION_CONFLICT');
    expect(staleBody.error.hint).toMatch(/current is 2/);

    // 2.4 GET ?version=1 → v1 snapshot (historical name)
    const v1Res = await getAgentDefinitionById(
      req(`/api/v1/agent-definitions/${created.id}`, { query: { version: '1' } }),
      { params: params({ id: created.id }) }
    );
    expect(v1Res.status).toBe(200);
    const v1Data = (await readJson<{ data: { name: string; currentVersion: number } }>(v1Res)).data;
    expect(v1Data.name).toBe('Translator');

    // 2.5 GET /versions → two rows (v1, v2) most-recent first
    const versionsRes = await listAgentDefinitionVersions(
      req(`/api/v1/agent-definitions/${created.id}/versions`),
      { params: params({ id: created.id }) }
    );
    expect(versionsRes.status).toBe(200);
    const versionsBody = await readJson<{ data: Array<{ version: number }> }>(versionsRes);
    expect(versionsBody.data.map((v) => v.version)).toEqual([2, 1]);

    // 2.6 POST /archive → archivedAt set, idempotent
    const archiveRes = await archiveAgentDefinition(
      req(`/api/v1/agent-definitions/${created.id}/archive`, { method: 'POST' }),
      { params: params({ id: created.id }) }
    );
    expect(archiveRes.status).toBe(200);
    const archiveBody = await readJson<{ data: { archivedAt: string } }>(archiveRes);
    expect(archiveBody.data.archivedAt).toBeTruthy();
    // GET returns the archived definition with archivedAt populated.
    const afterRes = await getAgentDefinitionById(req(`/api/v1/agent-definitions/${created.id}`), {
      params: params({ id: created.id }),
    });
    const afterBody = await readJson<{ data: { archivedAt: string | null } }>(afterRes);
    expect(afterBody.data.archivedAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Agent + Run + Event 闭环
//
// The SSE protocol rules (from docs/execution/progress/
// agent-b-relay2-task18-notes.md) we assert here:
//   - every frame carries `id: <seq>` (monotonically increasing)
//   - Last-Event-ID (header only) replays `seq > N`
//   - a terminal run closes the stream after replay
//   - cancelled runs appear as status='cancelled' on the wire
// ---------------------------------------------------------------------------

describe('E2E — Scenario 3: Agent + Run + Event loop', () => {
  it('POST /agents with initialInput creates both Agent and first Run; then events stream replays seq-labelled frames', async () => {
    const def = await createDefinitionViaApi();
    const createAgentRes = await createAgent(
      req('/api/v1/agents', {
        method: 'POST',
        body: {
          projectId: PROJECT_ID,
          definitionId: def.id,
          mode: 'chat',
          initialInput: 'Hello',
        },
      })
    );
    expect(createAgentRes.status).toBe(201);
    const createdBody = (
      await readJson<{
        data: { agent: { id: string; activeRunId: string | null }; firstRunId: string | null };
      }>(createAgentRes)
    ).data;
    const agentId = createdBody.agent.id;
    const firstRunId = createdBody.firstRunId;
    if (!firstRunId) throw new Error('expected firstRunId to be set by createAgent');

    // Seed a set of canonical UIMessageChunk events + the openrush
    // `data-openrush-run-done` marker. This is what the control-worker
    // would write in production; for the E2E we emulate it by directly
    // inserting via run_events (same path the production writer uses,
    // just inlined into the test so we don't need to spin up a real
    // control-worker + agent-worker).
    await db.execute(sql`
      UPDATE runs SET status = 'completed', completed_at = now() WHERE id = ${firstRunId}
    `);
    await db.insert(runEvents).values([
      {
        runId: firstRunId,
        eventType: 'text-delta',
        payload: { type: 'text-delta', id: 'msg_1', delta: 'Hi' },
        seq: 1,
      },
      {
        runId: firstRunId,
        eventType: 'tool-input-available',
        payload: {
          type: 'tool-input-available',
          toolCallId: 'call_1',
          toolName: 'Read',
          input: { path: '/tmp/x' },
        },
        seq: 2,
      },
      {
        runId: firstRunId,
        eventType: 'tool-output-available',
        payload: {
          type: 'tool-output-available',
          toolCallId: 'call_1',
          output: 'ok',
        },
        seq: 3,
      },
      {
        runId: firstRunId,
        eventType: 'data-openrush-run-done',
        payload: {
          type: 'data-openrush-run-done',
          data: { status: 'success' },
        },
        seq: 4,
      },
    ]);

    // Full replay (no Last-Event-ID) → all 4 frames, stream closes.
    const eventsRes = await getRunEvents(
      req(`/api/v1/agents/${agentId}/runs/${firstRunId}/events`),
      { params: params({ agentId, runId: firstRunId }) }
    );
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.headers.get('Content-Type')).toBe('text/event-stream');

    const frames = await readAllSseFrames(eventsRes);
    expect(frames).toHaveLength(4);
    // Every frame has an `id:` line with a monotonic seq.
    expect(frames.map(frameSeq)).toEqual([1, 2, 3, 4]);
    // Required event types show up.
    const types = frames.map((f) => {
      const payload = framePayload(f) as { type: string };
      return payload.type;
    });
    expect(types).toContain('text-delta');
    expect(types.some((t) => t.startsWith('tool-'))).toBe(true);
    expect(types[types.length - 1]).toBe('data-openrush-run-done');
  });

  it('POST /runs creates a new Run distinct from the first; Last-Event-ID reconnect replays only seq > N', async () => {
    const def = await createDefinitionViaApi();
    const createAgentRes = await createAgent(
      req('/api/v1/agents', {
        method: 'POST',
        body: {
          projectId: PROJECT_ID,
          definitionId: def.id,
          mode: 'chat',
          initialInput: 'first',
        },
      })
    );
    const { agent, firstRunId } = (
      await readJson<{ data: { agent: { id: string }; firstRunId: string | null } }>(createAgentRes)
    ).data;
    const agentId = agent.id;

    // Follow-up message → new Run id.
    const runRes = await appendRun(
      req(`/api/v1/agents/${agentId}/runs`, {
        method: 'POST',
        body: { input: 'second' },
      }),
      { params: params({ agentId }) }
    );
    expect(runRes.status).toBe(201);
    const runBody = (await readJson<{ data: { id: string } }>(runRes)).data;
    const secondRunId = runBody.id;
    expect(secondRunId).not.toBe(firstRunId);

    // Mark the second run terminal + seed 5 events.
    await db.execute(sql`
      UPDATE runs SET status = 'completed', completed_at = now() WHERE id = ${secondRunId}
    `);
    for (let seq = 1; seq <= 5; seq++) {
      await db.insert(runEvents).values({
        runId: secondRunId,
        eventType: 'text-delta',
        payload: { type: 'text-delta', id: 'msg_2', delta: `chunk-${seq}` },
        seq,
      });
    }

    // First connection: read all 5.
    const first = await getRunEvents(req(`/api/v1/agents/${agentId}/runs/${secondRunId}/events`), {
      params: params({ agentId, runId: secondRunId }),
    });
    const firstFrames = await readAllSseFrames(first);
    expect(firstFrames.map(frameSeq)).toEqual([1, 2, 3, 4, 5]);

    // Reconnect with Last-Event-ID: 2 → only seq 3..5 should replay.
    const second = await getRunEvents(
      req(`/api/v1/agents/${agentId}/runs/${secondRunId}/events`, {
        headers: { 'last-event-id': '2' },
      }),
      { params: params({ agentId, runId: secondRunId }) }
    );
    const secondFrames = await readAllSseFrames(second);
    expect(secondFrames.map(frameSeq)).toEqual([3, 4, 5]);
    // Confirm no re-replay of seq ≤ 2.
    expect(secondFrames.some((f) => frameSeq(f) <= 2)).toBe(false);

    // Reconnect with Last-Event-ID AT the final seq → 0 frames, stream closes.
    const empty = await getRunEvents(
      req(`/api/v1/agents/${agentId}/runs/${secondRunId}/events`, {
        headers: { 'last-event-id': '5' },
      }),
      { params: params({ agentId, runId: secondRunId }) }
    );
    const emptyFrames = await readAllSseFrames(empty);
    expect(emptyFrames).toEqual([]);

    // Malformed Last-Event-ID variants → 400 VALIDATION_ERROR. The spec
    // (specs/managed-agents-api.md §断线重连 + route comments at
    // events/route.ts L89-113) enumerates four reject cases: empty, whitespace,
    // negative, non-numeric. `z.coerce.number()` would otherwise silently
    // clobber '' / '   ' to 0 — we lock the explicit-rejection behaviour here.
    for (const bad of ['', '   ', '-1', 'not-a-number']) {
      const res = await getRunEvents(
        req(`/api/v1/agents/${agentId}/runs/${secondRunId}/events`, {
          headers: { 'last-event-id': bad },
        }),
        { params: params({ agentId, runId: secondRunId }) }
      );
      expect(res.status).toBe(400);
      const body = await readJson<{ error: { code: string } }>(res);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    }

    // Query cursor MUST be ignored — protocol is header-only (spec §断线重连).
    const cursorAttempt = await getRunEvents(
      req(`/api/v1/agents/${agentId}/runs/${secondRunId}/events`, {
        query: { cursor: '3' },
      }),
      { params: params({ agentId, runId: secondRunId }) }
    );
    const cursorFrames = await readAllSseFrames(cursorAttempt);
    // Full replay despite the query param (the route pins to Last-Event-ID).
    expect(cursorFrames.map(frameSeq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('POST /cancel on a running run flips status to cancelled on the wire and SSE replay shows terminal marker', async () => {
    const def = await createDefinitionViaApi();
    const createAgentRes = await createAgent(
      req('/api/v1/agents', {
        method: 'POST',
        body: {
          projectId: PROJECT_ID,
          definitionId: def.id,
          mode: 'chat',
          initialInput: 'long task',
        },
      })
    );
    const { agent, firstRunId } = (
      await readJson<{ data: { agent: { id: string }; firstRunId: string | null } }>(createAgentRes)
    ).data;
    const agentId = agent.id;
    if (!firstRunId) throw new Error('expected firstRunId to be set by createAgent');
    const runId = firstRunId;

    // Force the run into `running` so cancel has a legal transition target.
    await db.execute(sql`
      UPDATE runs SET status = 'running', started_at = now() WHERE id = ${runId}
    `);

    const cancelRes = await cancelRun(
      req(`/api/v1/agents/${agentId}/runs/${runId}/cancel`, { method: 'POST' }),
      { params: params({ agentId, runId }) }
    );
    expect(cancelRes.status).toBe(200);
    const cancelBody = (await readJson<{ data: { status: string; id: string } }>(cancelRes)).data;
    expect(cancelBody.status).toBe('cancelled');
    expect(cancelBody.id).toBe(runId);

    // Seed a terminal marker + one post-cancel event so the events stream
    // has a well-defined shape.
    await db.insert(runEvents).values([
      {
        runId,
        eventType: 'data-openrush-run-done',
        payload: {
          type: 'data-openrush-run-done',
          data: { status: 'cancelled' },
        },
        seq: 1,
      },
    ]);

    const eventsRes = await getRunEvents(req(`/api/v1/agents/${agentId}/runs/${runId}/events`), {
      params: params({ agentId, runId }),
    });
    const frames = await readAllSseFrames(eventsRes);
    expect(frames).toHaveLength(1);
    const payload = framePayload(frames[0]) as {
      type: string;
      data: { status: string };
    };
    expect(payload.type).toBe('data-openrush-run-done');
    expect(payload.data.status).toBe('cancelled');
  });

  it('live run: poll loop drains events appended after the initial replay, then closes on terminal', async () => {
    // Exercises events/route.ts §Liveness (500ms tick → drain → terminal
    // detect → second drain → close). The "second drain" is the race guard
    // described in handoff notes §1.5 — events written in the window between
    // the last tick's drain and the status transition must still be
    // delivered. We simulate that by inserting seq=3 AFTER flipping status
    // to completed but BEFORE the next tick fires.
    const def = await createDefinitionViaApi();
    const createAgentRes = await createAgent(
      req('/api/v1/agents', {
        method: 'POST',
        body: {
          projectId: PROJECT_ID,
          definitionId: def.id,
          mode: 'chat',
          initialInput: 'stream-me',
        },
      })
    );
    const { agent, firstRunId } = (
      await readJson<{ data: { agent: { id: string }; firstRunId: string | null } }>(createAgentRes)
    ).data;
    if (!firstRunId) throw new Error('expected firstRunId to be set');
    const agentId = agent.id;

    // Start run as running + seed one event for initial replay.
    await db.execute(sql`
      UPDATE runs SET status = 'running', started_at = now() WHERE id = ${firstRunId}
    `);
    await db.insert(runEvents).values({
      runId: firstRunId,
      eventType: 'text-delta',
      payload: { type: 'text-delta', delta: 'before' },
      seq: 1,
    });

    // Open SSE connection — route's start() will drain seq=1 immediately,
    // then install a 500ms poll interval.
    const sseRes = await getRunEvents(req(`/api/v1/agents/${agentId}/runs/${firstRunId}/events`), {
      params: params({ agentId, runId: firstRunId }),
    });
    expect(sseRes.status).toBe(200);

    const collected: string[] = [];
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Start a reader loop that drains frames as they arrive.
    const readerLoop = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n\n');
        while (idx !== -1) {
          collected.push(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 2);
          idx = buffer.indexOf('\n\n');
        }
      }
    })();

    // Give the initial replay a chance to land.
    await new Promise((r) => setTimeout(r, 100));
    expect(collected.map(frameSeq)).toEqual([1]);

    // Append a live event while the poll interval is active. Next tick
    // (within 500ms) should drain it.
    await db.insert(runEvents).values({
      runId: firstRunId,
      eventType: 'text-delta',
      payload: { type: 'text-delta', delta: 'mid' },
      seq: 2,
    });

    // Wait for at least one poll tick.
    await new Promise((r) => setTimeout(r, 700));
    expect(collected.map(frameSeq)).toEqual([1, 2]);

    // Flip status + write the final event between drains to exercise the
    // post-terminal race guard (handoff notes §1.5). The stream should
    // deliver seq=3 then close.
    await db.execute(sql`
      UPDATE runs SET status = 'completed', completed_at = now() WHERE id = ${firstRunId}
    `);
    await db.insert(runEvents).values({
      runId: firstRunId,
      eventType: 'data-openrush-run-done',
      payload: { type: 'data-openrush-run-done', data: { status: 'success' } },
      seq: 3,
    });

    // Wait for the reader loop to complete (stream closes after drain).
    // Bound the wait so a regression doesn't hang the suite — 3s covers
    // several poll intervals + the post-terminal drain.
    const loopDone = await Promise.race([
      readerLoop.then(() => 'done' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000)),
    ]);
    expect(loopDone).toBe('done');

    expect(collected.map(frameSeq)).toEqual([1, 2, 3]);
    const terminal = framePayload(collected[2]) as { type: string };
    expect(terminal.type).toBe('data-openrush-run-done');
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — 幂等性
// ---------------------------------------------------------------------------

describe('E2E — Scenario 4: Idempotency-Key', () => {
  it('same key + same body → replays the same run; same key + different body → 409 IDEMPOTENCY_CONFLICT', async () => {
    const def = await createDefinitionViaApi();
    const createAgentRes = await createAgent(
      req('/api/v1/agents', {
        method: 'POST',
        body: {
          projectId: PROJECT_ID,
          definitionId: def.id,
          mode: 'chat',
          initialInput: 'boot',
        },
      })
    );
    const { agent } = (await readJson<{ data: { agent: { id: string } } }>(createAgentRes)).data;
    const agentId = agent.id;

    const IDEM_KEY = `idem-${randomUUID()}`;

    // 4.1 First call → 201 create.
    const first = await appendRun(
      req(`/api/v1/agents/${agentId}/runs`, {
        method: 'POST',
        headers: { 'idempotency-key': IDEM_KEY },
        body: { input: 'do-the-thing' },
      }),
      { params: params({ agentId }) }
    );
    expect(first.status).toBe(201);
    const firstBody = (await readJson<{ data: { id: string } }>(first)).data;
    const originalRunId = firstBody.id;

    // 4.2 Same key + same body → replay returns the same run id.
    const replay = await appendRun(
      req(`/api/v1/agents/${agentId}/runs`, {
        method: 'POST',
        headers: { 'idempotency-key': IDEM_KEY },
        body: { input: 'do-the-thing' },
      }),
      { params: params({ agentId }) }
    );
    expect(replay.status).toBe(201);
    const replayBody = (await readJson<{ data: { id: string } }>(replay)).data;
    expect(replayBody.id).toBe(originalRunId);

    // 4.3 Same key + different body → 409 IDEMPOTENCY_CONFLICT.
    const conflict = await appendRun(
      req(`/api/v1/agents/${agentId}/runs`, {
        method: 'POST',
        headers: { 'idempotency-key': IDEM_KEY },
        body: { input: 'DIFFERENT' },
      }),
      { params: params({ agentId }) }
    );
    expect(conflict.status).toBe(409);
    const conflictBody = await readJson<{ error: { code: string } }>(conflict);
    expect(conflictBody.error.code).toBe('IDEMPOTENCY_CONFLICT');

    // 4.4 DB side-effects: the 2nd (replay) and 3rd (conflict) calls must
    // NOT have created a new row. We match on the user-provided key as a
    // LIKE suffix (the service double-scopes it internally —
    // `agent:<defId>|task:<taskId>|<userKey>`), which decouples the
    // assertion from createAgent's row layout (Sparring SHOULD-FIX).
    // Spec §幂等性 only guarantees the "no duplicate on replay" shape;
    // we don't pin an absolute global run count.
    const keyRows = await db
      .select()
      .from(runs)
      .where(sql`${runs.idempotencyKey} LIKE ${`%|${IDEM_KEY}`}`);
    expect(keyRows).toHaveLength(1);
    expect(keyRows[0].id).toBe(originalRunId);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Vault encrypted storage + wire strip + injectionTarget
// ---------------------------------------------------------------------------

describe('E2E — Scenario 5: Vault', () => {
  it('POST encrypts at rest; GET strips encryptedValue; injectionTarget persists for env-var injection', async () => {
    const PLAINTEXT = 'super-secret-api-key';
    const postRes = await createVaultEntry(
      req('/api/v1/vaults/entries', {
        method: 'POST',
        body: {
          scope: 'project',
          projectId: PROJECT_ID,
          name: 'ANTHROPIC_API_KEY',
          credentialType: 'env_var',
          value: PLAINTEXT,
          injectionTarget: 'ANTHROPIC_API_KEY',
        },
      })
    );
    expect(postRes.status).toBe(201);
    const created = (
      await readJson<{
        data: { id: string; name: string; injectionTarget: string | null };
      }>(postRes)
    ).data;
    expect(created.injectionTarget).toBe('ANTHROPIC_API_KEY');

    // Encrypted at rest: DB row's encrypted_value is NOT the plaintext.
    const [row] = await db.select().from(vaultEntries);
    expect(row.encryptedValue).not.toBe(PLAINTEXT);
    expect(row.encryptedValue.length).toBeGreaterThan(10);

    // GET strips encryptedValue — serialise as text so we can assert the
    // column name never appears anywhere on the wire.
    const listRes = await listVaultEntries(req('/api/v1/vaults/entries'));
    expect(listRes.status).toBe(200);
    const rawText = await listRes.text();
    expect(rawText).not.toContain('encryptedValue');
    expect(rawText).not.toContain('encrypted_value');
    expect(rawText).not.toContain(PLAINTEXT);
    const parsed = JSON.parse(rawText) as {
      data: Array<{
        id: string;
        name: string;
        injectionTarget: string | null;
        keyVersion: number;
      }>;
    };
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].name).toBe('ANTHROPIC_API_KEY');
    expect(parsed.data[0].injectionTarget).toBe('ANTHROPIC_API_KEY');
    expect(parsed.data[0].keyVersion).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — 乐观并发冲突
// ---------------------------------------------------------------------------

describe('E2E — Scenario 6: Optimistic concurrency (PATCH definitions)', () => {
  it('two concurrent PATCHers with the same If-Match: exactly one 200, the other 409', async () => {
    const def = await createDefinitionViaApi();
    expect(def.currentVersion).toBe(1);

    // Kick off both PATCHes without awaiting. The AgentDefinitionService's
    // `SELECT … FOR UPDATE + version check` (task-7) + the route's
    // VERSION_CONFLICT mapping (task-8) is what we're locking in here.
    const [resA, resB] = await Promise.all([
      patchAgentDefinition(
        req(`/api/v1/agent-definitions/${def.id}`, {
          method: 'PATCH',
          headers: { 'if-match': '1' },
          body: { name: 'A-wins' },
        }),
        { params: params({ id: def.id }) }
      ),
      patchAgentDefinition(
        req(`/api/v1/agent-definitions/${def.id}`, {
          method: 'PATCH',
          headers: { 'if-match': '1' },
          body: { name: 'B-wins' },
        }),
        { params: params({ id: def.id }) }
      ),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = resA.status === 200 ? resA : resB;
    const loser = resA.status === 409 ? resA : resB;

    const winBody = (await readJson<{ data: { currentVersion: number; name: string } }>(winner))
      .data;
    expect(winBody.currentVersion).toBe(2);
    expect(['A-wins', 'B-wins']).toContain(winBody.name);

    const loseBody = await readJson<{ error: { code: string; hint?: string } }>(loser);
    expect(loseBody.error.code).toBe('VERSION_CONFLICT');
    expect(loseBody.error.hint).toMatch(/current is 2/);

    // DB reflects exactly one version bump.
    const [defRow] = await db
      .select({ currentVersion: agentsTable.currentVersion })
      .from(agentsTable)
      .where(sql`${agentsTable.id} = ${def.id}`);
    expect(defRow?.currentVersion).toBe(2);
    const versionRows = await db
      .select()
      .from(agentDefinitionVersions)
      .where(sql`${agentDefinitionVersions.agentId} = ${def.id}`);
    expect(versionRows.map((r) => r.version).sort()).toEqual([1, 2]);
  });
});

// Silence unused import warnings for tables referenced only by the schema
// bootstrap CREATE TABLE statements.
void projectMembers;
void tasks;
