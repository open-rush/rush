import { PGlite } from '@electric-sql/pglite';
import * as schema from '@lux/db';
import { projects, users } from '@lux/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleVaultDb } from '../vault/drizzle-vault-db.js';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let pglite: PGlite;
let db: TestDb;
let store: DrizzleVaultDb;
let projectId: string;

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
      CHECK ((scope = 'platform' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL)),
      UNIQUE(scope, project_id, name)
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vault_entries_platform_name_uniq
    ON vault_entries (scope, name) WHERE project_id IS NULL
  `);

  const [user] = await db.insert(users).values({ name: 'test', email: 'vault@test.com' }).returning();
  const [project] = await db
    .insert(projects)
    .values({ name: 'Vault Test', createdBy: user.id })
    .returning();
  projectId = project.id;

  store = new DrizzleVaultDb(db as never);
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM vault_entries`);
});

afterAll(async () => {
  await pglite.close();
});

describe('DrizzleVaultDb', () => {
  it('upsert creates a new entry', async () => {
    const entry = await store.upsert({
      scope: 'project',
      projectId,
      ownerId: null,
      name: 'API_KEY',
      credentialType: 'env_var',
      encryptedValue: 'encrypted-data',
      keyVersion: 1,
      injectionTarget: null,
    });

    expect(entry.name).toBe('API_KEY');
    expect(entry.scope).toBe('project');
    expect(entry.projectId).toBe(projectId);
  });

  it('upsert updates existing entry on conflict', async () => {
    await store.upsert({
      scope: 'project',
      projectId,
      ownerId: null,
      name: 'API_KEY',
      credentialType: 'env_var',
      encryptedValue: 'old-value',
      keyVersion: 1,
      injectionTarget: null,
    });

    await store.upsert({
      scope: 'project',
      projectId,
      ownerId: null,
      name: 'API_KEY',
      credentialType: 'env_var',
      encryptedValue: 'new-value',
      keyVersion: 2,
      injectionTarget: 'MY_KEY',
    });

    const found = await store.findByName('project', 'API_KEY', projectId);
    expect(found?.encryptedValue).toBe('new-value');
  });

  it('findByName returns null for missing entry', async () => {
    const result = await store.findByName('project', 'NOPE', projectId);
    expect(result).toBeNull();
  });

  it('listByScope returns entries sorted by name', async () => {
    await store.upsert({
      scope: 'project',
      projectId,
      ownerId: null,
      name: 'B_KEY',
      credentialType: 'env_var',
      encryptedValue: 'b',
      keyVersion: 1,
      injectionTarget: null,
    });
    await store.upsert({
      scope: 'project',
      projectId,
      ownerId: null,
      name: 'A_KEY',
      credentialType: 'env_var',
      encryptedValue: 'a',
      keyVersion: 1,
      injectionTarget: null,
    });

    const entries = await store.listByScope('project', projectId);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name)).toEqual(['A_KEY', 'B_KEY']);
  });

  it('remove deletes entry and returns true', async () => {
    await store.upsert({
      scope: 'project',
      projectId,
      ownerId: null,
      name: 'TO_DELETE',
      credentialType: 'env_var',
      encryptedValue: 'x',
      keyVersion: 1,
      injectionTarget: null,
    });

    expect(await store.remove('project', 'TO_DELETE', projectId)).toBe(true);
    expect(await store.findByName('project', 'TO_DELETE', projectId)).toBeNull();
  });

  it('remove returns false for missing entry', async () => {
    expect(await store.remove('project', 'NOPE', projectId)).toBe(false);
  });

  it('countByScope tracks correctly', async () => {
    expect(await store.countByScope('project', projectId)).toBe(0);

    await store.upsert({
      scope: 'project',
      projectId,
      ownerId: null,
      name: 'X',
      credentialType: 'env_var',
      encryptedValue: 'v',
      keyVersion: 1,
      injectionTarget: null,
    });

    expect(await store.countByScope('project', projectId)).toBe(1);
  });

  it('findAllForInjection returns platform + project entries', async () => {
    await store.upsert({
      scope: 'platform',
      projectId: null,
      ownerId: null,
      name: 'GLOBAL_KEY',
      credentialType: 'env_var',
      encryptedValue: 'global-enc',
      keyVersion: 1,
      injectionTarget: null,
    });
    await store.upsert({
      scope: 'project',
      projectId,
      ownerId: null,
      name: 'PROJECT_KEY',
      credentialType: 'env_var',
      encryptedValue: 'project-enc',
      keyVersion: 1,
      injectionTarget: 'MY_VAR',
    });

    const entries = await store.findAllForInjection(projectId);
    expect(entries).toHaveLength(2);

    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['GLOBAL_KEY', 'PROJECT_KEY']);

    const pe = entries.find((e) => e.name === 'PROJECT_KEY');
    expect(pe?.injectionTarget).toBe('MY_VAR');
    expect(pe?.scope).toBe('project');
  });
});
