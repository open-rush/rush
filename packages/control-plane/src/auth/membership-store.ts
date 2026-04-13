import type { ProjectMemberRole } from '@lux/contracts';
import type { MembershipInfo, MembershipStore } from './authorization.js';

export interface MemberRecord {
  userId: string;
  projectId: string;
  role: string;
}

export interface MembershipDb {
  findMember(userId: string, projectId: string): Promise<MemberRecord | null>;
  listMembers(projectId: string): Promise<MemberRecord[]>;
  addMember(projectId: string, userId: string, role: ProjectMemberRole): Promise<MemberRecord>;
  updateRole(
    projectId: string,
    userId: string,
    role: ProjectMemberRole
  ): Promise<MemberRecord | null>;
  removeMember(projectId: string, userId: string): Promise<boolean>;
  countOwners(projectId: string): Promise<number>;
}

export class DbMembershipStore implements MembershipStore {
  constructor(private db: MembershipDb) {}

  async getMembership(userId: string, projectId: string): Promise<MembershipInfo | null> {
    const record = await this.db.findMember(userId, projectId);
    if (!record) return null;
    return {
      userId: record.userId,
      projectId: record.projectId,
      role: record.role as ProjectMemberRole,
    };
  }
}

export class ProjectMemberService {
  constructor(private db: MembershipDb) {}

  async addMember(
    projectId: string,
    userId: string,
    role: ProjectMemberRole = 'member'
  ): Promise<MemberRecord> {
    return this.db.addMember(projectId, userId, role);
  }

  async listMembers(projectId: string): Promise<MemberRecord[]> {
    return this.db.listMembers(projectId);
  }

  async updateRole(
    projectId: string,
    userId: string,
    role: ProjectMemberRole
  ): Promise<MemberRecord> {
    if (role !== 'owner') {
      const ownerCount = await this.db.countOwners(projectId);
      const current = await this.db.findMember(userId, projectId);
      if (current?.role === 'owner' && ownerCount <= 1) {
        throw new Error('Cannot remove the last owner of a project');
      }
    }

    const updated = await this.db.updateRole(projectId, userId, role);
    if (!updated) {
      throw new Error('Member not found');
    }
    return updated;
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    const current = await this.db.findMember(userId, projectId);
    if (!current) {
      throw new Error('Member not found');
    }

    if (current.role === 'owner') {
      const ownerCount = await this.db.countOwners(projectId);
      if (ownerCount <= 1) {
        throw new Error('Cannot remove the last owner of a project');
      }
    }

    const removed = await this.db.removeMember(projectId, userId);
    if (!removed) {
      throw new Error('Member not found (concurrent deletion)');
    }
  }
}

// NOTE: updateRole and removeMember owner-protection checks are not atomic.
// The InMemory implementation is single-threaded so this is safe for tests.
// The real Drizzle implementation MUST wrap check+write in a transaction
// with row-level locking to prevent concurrent owner demotion/removal.
