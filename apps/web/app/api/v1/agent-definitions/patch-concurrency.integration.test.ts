/**
 * Integration test — real AgentDefinitionService + PGlite through the route
 * handler (only auth and membership are mocked). This satisfies the task-8
 * acceptance criterion: "集成测试覆盖乐观并发 409" which the fully-mocked
 * route unit tests can't fulfil on their own.
 *
 * Two PATCHers that both observed `current_version=1` race for the same agent.
 * The service's FOR UPDATE + version check guarantees exactly one bump; the
 * route maps the AgentDefinitionVersionConflictError raised on the loser side
 * to a `VERSION_CONFLICT` 409 envelope.
 */
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@open-rush/db';
import { agents, projects, users } from '@open-rush/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Shared PGlite instance + mocks bootstrapped BEFORE route import
// ---------------------------------------------------------------------------

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let pglite: PGlite;
let db: TestDb;

const { mockAuthenticate, mockHasScope, mockVerifyProjectAccess, mockGetDbClient } = vi.hoisted(
  () => ({
    mockAuthenticate: vi.fn(),
    mockHasScope: vi.fn(),
    mockVerifyProjectAccess: vi.fn(),
    mockGetDbClient: vi.fn(),
  })
);

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: (req: Request) => mockAuthenticate(req),
  hasScope: (ctx: unknown, scope: string) => mockHasScope(ctx, scope),
}));

vi.mock('@/lib/api-utils', () => ({
  verifyProjectAccess: (projectId: string, userId: string) =>
    mockVerifyProjectAccess(projectId, userId),
}));

// Real control-plane service, real Zod schemas, real helpers. Only the db
// client factory is swapped out to return our PGlite-backed Drizzle instance.
vi.mock('@open-rush/db', async () => {
  const actual = await vi.importActual<typeof import('@open-rush/db')>('@open-rush/db');
  return {
    ...actual,
    getDbClient: () => mockGetDbClient(),
  };
});

// ---------------------------------------------------------------------------
// Bootstrap schema + import route AFTER mocks
// ---------------------------------------------------------------------------

let PATCH: typeof import('./[id]/route')['PATCH'];
let POST_CREATE: typeof import('./route')['POST'];

beforeAll(async () => {
  pglite = new PGlite();
  db = drizzle(pglite, { schema });
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
      CONSTRAINT agent_definition_versions_agent_version_uniq UNIQUE(agent_id, version)
    )
  `);

  mockGetDbClient.mockReturnValue(db);
  const [idRoute, collRoute] = await Promise.all([import('./[id]/route'), import('./route')]);
  PATCH = idRoute.PATCH;
  POST_CREATE = collRoute.POST;
});

afterAll(async () => {
  await pglite.close();
});

let USER_ID = '';

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE agent_definition_versions, agents, projects, users RESTART IDENTITY CASCADE`
  );
  USER_ID = randomUUID();
  mockAuthenticate.mockResolvedValue({ userId: USER_ID, scopes: ['*'], authType: 'session' });
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
});

async function seedProject(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({ id: USER_ID, name: 'Alice', email: `a-${USER_ID}@ex.com` })
    .returning();
  const [p] = await db.insert(projects).values({ name: 'P', createdBy: u.id }).returning();
  return p.id;
}

async function createDefinition(projectId: string) {
  const req = new Request('https://t/api/v1/agent-definitions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId,
      name: 'A',
      providerType: 'claude-code',
      allowedTools: [],
      skills: [],
      mcpServers: [],
      maxSteps: 10,
      deliveryMode: 'chat',
    }),
  });
  const res = await POST_CREATE(req);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { data: { id: string; currentVersion: number } };
  return body.data;
}

function patchReq(id: string, name: string, ifMatch: number) {
  return new Request(`https://t/api/v1/agent-definitions/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'if-match': String(ifMatch),
    },
    body: JSON.stringify({ name }),
  });
}

describe('PATCH /api/v1/agent-definitions/:id — optimistic concurrency (integration)', () => {
  it('two concurrent PATCHers with the same If-Match: one wins (200), the other loses (409)', async () => {
    const projectId = await seedProject();
    const def = await createDefinition(projectId);
    expect(def.currentVersion).toBe(1);

    // Issue both PATCHes without awaiting, then Promise.all.
    const [resA, resB] = await Promise.all([
      PATCH(patchReq(def.id, 'A-wins', 1), { params: Promise.resolve({ id: def.id }) }),
      PATCH(patchReq(def.id, 'B-wins', 1), { params: Promise.resolve({ id: def.id }) }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const okRes = resA.status === 200 ? resA : resB;
    const conflictRes = resA.status === 409 ? resA : resB;

    const okBody = (await okRes.json()) as { data: { currentVersion: number; name: string } };
    expect(okBody.data.currentVersion).toBe(2);
    expect(['A-wins', 'B-wins']).toContain(okBody.data.name);

    const errBody = (await conflictRes.json()) as { error: { code: string; hint?: string } };
    expect(errBody.error.code).toBe('VERSION_CONFLICT');
    expect(errBody.error.hint).toMatch(/current is 2/);
  });

  it('sequential PATCHes with fresh If-Match both succeed (sanity — no false conflict)', async () => {
    const projectId = await seedProject();
    const def = await createDefinition(projectId);
    const res1 = await PATCH(patchReq(def.id, 'v2', 1), {
      params: Promise.resolve({ id: def.id }),
    });
    expect(res1.status).toBe(200);
    const res2 = await PATCH(patchReq(def.id, 'v3', 2), {
      params: Promise.resolve({ id: def.id }),
    });
    expect(res2.status).toBe(200);
    const body = (await res2.json()) as { data: { currentVersion: number } };
    expect(body.data.currentVersion).toBe(3);
  });

  it('stale If-Match returns 409 even without concurrency', async () => {
    const projectId = await seedProject();
    const def = await createDefinition(projectId);
    await PATCH(patchReq(def.id, 'v2', 1), { params: Promise.resolve({ id: def.id }) });
    const res = await PATCH(patchReq(def.id, 'v2-retry', 1), {
      params: Promise.resolve({ id: def.id }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// Regression — GET without projectId filter must NOT leak soft-deleted projects
// (Sparring MUST-FIX: listAccessibleProjectIds() previously didn't filter
//  deletedAt on the membership branch, so members would still see definitions
//  belonging to soft-deleted projects.)
// ---------------------------------------------------------------------------

import { projectMembers } from '@open-rush/db';

import { GET as COLLECTION_GET } from './route';

describe('GET /api/v1/agent-definitions — soft-deleted project exclusion', () => {
  it('excludes definitions of soft-deleted projects even when caller is a member', async () => {
    // Extra membership table for this test.
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

    const projectId = await seedProject();
    // Second project, owned by a different user, with caller as member.
    const [otherOwner] = await db
      .insert(users)
      .values({ name: 'Bob', email: `bob-${Math.random()}@ex.com` })
      .returning();
    const [otherProject] = await db
      .insert(projects)
      .values({ name: 'OP', createdBy: otherOwner.id })
      .returning();
    await db
      .insert(projectMembers)
      .values({ projectId: otherProject.id, userId: USER_ID, role: 'member' });

    // Two definitions, one per project.
    const _own = await createDefinition(projectId);
    // For the "other" project, insert directly via DB (createDefinition uses
    // POST which runs verifyProjectAccess, and we want the definition to
    // pre-exist).
    await db.insert(agents).values({ projectId: otherProject.id, name: 'OTHER' });

    // Soft-delete the OTHER project. Caller is still a member row, but the
    // verifyProjectAccess() guard treats deleted projects as no-access. The
    // list endpoint must mirror that.
    await db.execute(sql`UPDATE projects SET deleted_at = now() WHERE id = ${otherProject.id}`);

    const res = await COLLECTION_GET(new Request('https://t/api/v1/agent-definitions'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ projectId: string }> };
    // Only the live-project definition is visible. The soft-deleted project's
    // definition MUST NOT be in the list.
    expect(body.data.every((d) => d.projectId !== otherProject.id)).toBe(true);
  });
});
