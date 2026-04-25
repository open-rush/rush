import type { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestAgent, createTestProject, createTestUser } from '../../test/factories.js';
import { closeTestDb, createTestDb, type TestDb, truncateAll } from '../../test/pglite-helpers.js';
import { agentDefinitionVersions, agents, users } from '../schema/index.js';

let db: TestDb;
let pglite: PGlite;

beforeAll(async () => {
  const result = await createTestDb();
  db = result.db;
  pglite = result.pglite;
});

afterAll(async () => {
  await closeTestDb(pglite);
});

beforeEach(async () => {
  await truncateAll(db);
});

async function seedAgent() {
  const user = await createTestUser(db);
  const project = await createTestProject(db, user.id);
  const agent = await createTestAgent(db, project.id, user.id);
  return { user, project, agent };
}

describe('agent_definition_versions schema', () => {
  describe('column defaults & shape', () => {
    it('defaults current_version to 1 and archived_at to null on new agents', async () => {
      const { agent } = await seedAgent();
      const [row] = await db.select().from(agents).where(eq(agents.id, agent.id));
      expect(row.currentVersion).toBe(1);
      expect(row.archivedAt).toBeNull();
    });

    it('persists a version row with snapshot and change_note', async () => {
      const { user, agent } = await seedAgent();
      const snapshot = {
        name: 'Test Agent',
        systemPrompt: 'You are helpful',
        maxSteps: 30,
      };
      const [version] = await db
        .insert(agentDefinitionVersions)
        .values({
          agentId: agent.id,
          version: 1,
          snapshot,
          changeNote: 'initial',
          createdBy: user.id,
        })
        .returning();

      expect(version.agentId).toBe(agent.id);
      expect(version.version).toBe(1);
      expect(version.snapshot).toEqual(snapshot);
      expect(version.changeNote).toBe('initial');
      expect(version.createdBy).toBe(user.id);
      expect(version.createdAt).toBeInstanceOf(Date);
      expect(version.id).toBeTruthy();
    });

    it('allows change_note and created_by to be null', async () => {
      const { agent } = await seedAgent();
      const [version] = await db
        .insert(agentDefinitionVersions)
        .values({
          agentId: agent.id,
          version: 1,
          snapshot: { name: 'x' },
        })
        .returning();

      expect(version.changeNote).toBeNull();
      expect(version.createdBy).toBeNull();
    });
  });

  describe('unique (agent_id, version) constraint', () => {
    it('rejects duplicate version numbers for the same agent', async () => {
      const { agent } = await seedAgent();
      await db
        .insert(agentDefinitionVersions)
        .values({ agentId: agent.id, version: 1, snapshot: {} });
      await expect(
        db.insert(agentDefinitionVersions).values({
          agentId: agent.id,
          version: 1,
          snapshot: {},
        })
      ).rejects.toThrow();
    });

    it('allows the same version number across different agents', async () => {
      const { project, user } = await seedAgent();
      const agentA = await createTestAgent(db, project.id, user.id);
      const agentB = await createTestAgent(db, project.id, user.id);

      await db
        .insert(agentDefinitionVersions)
        .values({ agentId: agentA.id, version: 1, snapshot: {} });
      await db
        .insert(agentDefinitionVersions)
        .values({ agentId: agentB.id, version: 1, snapshot: {} });

      const rows = await db.select().from(agentDefinitionVersions);
      expect(rows).toHaveLength(2);
    });

    it('allows monotonically increasing versions for the same agent', async () => {
      const { agent } = await seedAgent();
      for (const v of [1, 2, 3]) {
        await db
          .insert(agentDefinitionVersions)
          .values({ agentId: agent.id, version: v, snapshot: { v } });
      }
      const rows = await db
        .select()
        .from(agentDefinitionVersions)
        .where(eq(agentDefinitionVersions.agentId, agent.id));
      expect(rows.map((r) => r.version).sort()).toEqual([1, 2, 3]);
    });
  });

  describe('foreign key cascade + set null', () => {
    it('cascades delete from agent → version rows removed', async () => {
      const { agent } = await seedAgent();
      await db
        .insert(agentDefinitionVersions)
        .values({ agentId: agent.id, version: 1, snapshot: {} });
      await db
        .insert(agentDefinitionVersions)
        .values({ agentId: agent.id, version: 2, snapshot: {} });

      await db.delete(agents).where(eq(agents.id, agent.id));

      const rows = await db
        .select()
        .from(agentDefinitionVersions)
        .where(eq(agentDefinitionVersions.agentId, agent.id));
      expect(rows).toHaveLength(0);
    });

    it('sets created_by to null when the authoring user is deleted', async () => {
      const { user, agent } = await seedAgent();
      const [version] = await db
        .insert(agentDefinitionVersions)
        .values({
          agentId: agent.id,
          version: 1,
          snapshot: {},
          createdBy: user.id,
        })
        .returning();
      expect(version.createdBy).toBe(user.id);

      await db.delete(users).where(eq(users.id, user.id));

      const [after] = await db
        .select()
        .from(agentDefinitionVersions)
        .where(eq(agentDefinitionVersions.id, version.id));
      // agent was created_by this user too, so agent row was also removed via set-null
      // on agent.created_by; but the version row itself uses set-null for created_by.
      expect(after?.createdBy).toBeNull();
    });

    it('rejects insert with non-existent agent_id (FK violation)', async () => {
      await expect(
        db.insert(agentDefinitionVersions).values({
          agentId: '00000000-0000-0000-0000-000000000000',
          version: 1,
          snapshot: {},
        })
      ).rejects.toThrow();
    });
  });

  describe('agents.current_version + archived_at bookkeeping', () => {
    it('allows incrementing current_version', async () => {
      const { agent } = await seedAgent();
      await db.update(agents).set({ currentVersion: 2 }).where(eq(agents.id, agent.id));
      const [row] = await db.select().from(agents).where(eq(agents.id, agent.id));
      expect(row.currentVersion).toBe(2);
    });

    it('allows setting archived_at and reading it back', async () => {
      const { agent } = await seedAgent();
      const archivedAt = new Date('2024-01-01T00:00:00Z');
      await db.update(agents).set({ archivedAt }).where(eq(agents.id, agent.id));
      const [row] = await db.select().from(agents).where(eq(agents.id, agent.id));
      expect(row.archivedAt).toEqual(archivedAt);
    });
  });
});
