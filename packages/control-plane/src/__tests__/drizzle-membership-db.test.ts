import { PGlite } from '@electric-sql/pglite';
import * as schema from '@lux/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleMembershipDb } from '../auth/drizzle-membership-db.js';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let pglite: PGlite;
let db: TestDb;
let membershipDb: DrizzleMembershipDb;
let testUserId: string;
let testUser2Id: string;
let testProjectId: string;

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
    CREATE TABLE IF NOT EXISTS project_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(project_id, user_id)
    )
  `);

  const [user1] = await db
    .insert(schema.users)
    .values({ name: 'User 1', email: 'user1@test.com' })
    .returning();
  testUserId = user1.id;

  const [user2] = await db
    .insert(schema.users)
    .values({ name: 'User 2', email: 'user2@test.com' })
    .returning();
  testUser2Id = user2.id;

  const [project] = await db
    .insert(schema.projects)
    .values({ name: 'Test Project', createdBy: testUserId })
    .returning();
  testProjectId = project.id;
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM project_members`);
  membershipDb = new DrizzleMembershipDb(db as never);
});

afterAll(async () => {
  await pglite.close();
});

describe('DrizzleMembershipDb', () => {
  describe('addMember + findMember', () => {
    it('adds a member and finds them', async () => {
      const member = await membershipDb.addMember(testProjectId, testUserId, 'owner');
      expect(member.userId).toBe(testUserId);
      expect(member.role).toBe('owner');

      const found = await membershipDb.findMember(testUserId, testProjectId);
      expect(found?.role).toBe('owner');
    });

    it('returns null for non-member', async () => {
      const found = await membershipDb.findMember(testUser2Id, testProjectId);
      expect(found).toBeNull();
    });
  });

  describe('listMembers', () => {
    it('lists all project members', async () => {
      await membershipDb.addMember(testProjectId, testUserId, 'owner');
      await membershipDb.addMember(testProjectId, testUser2Id, 'member');

      const members = await membershipDb.listMembers(testProjectId);
      expect(members).toHaveLength(2);
    });
  });

  describe('updateRole', () => {
    it('updates member role', async () => {
      await membershipDb.addMember(testProjectId, testUserId, 'member');
      const updated = await membershipDb.updateRole(testProjectId, testUserId, 'admin');
      expect(updated?.role).toBe('admin');
    });

    it('returns null for non-existent member', async () => {
      const updated = await membershipDb.updateRole(testProjectId, testUser2Id, 'admin');
      expect(updated).toBeNull();
    });
  });

  describe('removeMember', () => {
    it('removes a member', async () => {
      await membershipDb.addMember(testProjectId, testUserId, 'member');
      const removed = await membershipDb.removeMember(testProjectId, testUserId);
      expect(removed).toBe(true);

      const found = await membershipDb.findMember(testUserId, testProjectId);
      expect(found).toBeNull();
    });

    it('returns false for non-existent member', async () => {
      const removed = await membershipDb.removeMember(testProjectId, testUser2Id);
      expect(removed).toBe(false);
    });
  });

  describe('countOwners', () => {
    it('counts owners correctly', async () => {
      await membershipDb.addMember(testProjectId, testUserId, 'owner');
      await membershipDb.addMember(testProjectId, testUser2Id, 'member');

      const count = await membershipDb.countOwners(testProjectId);
      expect(count).toBe(1);
    });
  });
});
