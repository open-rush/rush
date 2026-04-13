import type { ProjectMemberRole } from '@lux/contracts';
import { type DbClient, projectMembers } from '@lux/db';
import { and, eq } from 'drizzle-orm';

import type { MemberRecord, MembershipDb } from './membership-store.js';

type MemberRow = typeof projectMembers.$inferSelect;

function mapRow(row: MemberRow): MemberRecord {
  return {
    userId: row.userId,
    projectId: row.projectId,
    role: row.role,
  };
}

// TODO: Owner protection (countOwners → updateRole/removeMember) is NOT atomic.
// ProjectMemberService checks owner count before writing, but under concurrent
// requests both could pass the check. For MVP this is acceptable (low concurrency).
// Production fix: wrap check+write in db.transaction() with row-level locking.
export class DrizzleMembershipDb implements MembershipDb {
  constructor(private db: DbClient) {}

  async findMember(userId: string, projectId: string): Promise<MemberRecord | null> {
    const [row] = await this.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async listMembers(projectId: string): Promise<MemberRecord[]> {
    const rows = await this.db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    return rows.map(mapRow);
  }

  async addMember(
    projectId: string,
    userId: string,
    role: ProjectMemberRole
  ): Promise<MemberRecord> {
    const [row] = await this.db
      .insert(projectMembers)
      .values({ projectId, userId, role })
      .returning();
    return mapRow(row);
  }

  async updateRole(
    projectId: string,
    userId: string,
    role: ProjectMemberRole
  ): Promise<MemberRecord | null> {
    const [row] = await this.db
      .update(projectMembers)
      .set({ role })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .returning();
    return row ? mapRow(row) : null;
  }

  async removeMember(projectId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .returning();
    return !!row;
  }

  async countOwners(projectId: string): Promise<number> {
    const rows = await this.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'owner')));
    return rows.length;
  }
}
