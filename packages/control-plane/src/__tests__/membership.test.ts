import type { ProjectMemberRole } from '@lux/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthorizationGuard } from '../auth/authorization.js';
import {
  DbMembershipStore,
  type MemberRecord,
  type MembershipDb,
  ProjectMemberService,
} from '../auth/membership-store.js';

class InMemoryMembershipDb implements MembershipDb {
  private members: MemberRecord[] = [];

  async findMember(userId: string, projectId: string): Promise<MemberRecord | null> {
    return this.members.find((m) => m.userId === userId && m.projectId === projectId) ?? null;
  }

  async listMembers(projectId: string): Promise<MemberRecord[]> {
    return this.members.filter((m) => m.projectId === projectId);
  }

  async addMember(
    projectId: string,
    userId: string,
    role: ProjectMemberRole
  ): Promise<MemberRecord> {
    const existing = await this.findMember(userId, projectId);
    if (existing) throw new Error('Member already exists');
    const record: MemberRecord = { userId, projectId, role };
    this.members.push(record);
    return record;
  }

  async updateRole(
    projectId: string,
    userId: string,
    role: ProjectMemberRole
  ): Promise<MemberRecord | null> {
    const member = this.members.find((m) => m.userId === userId && m.projectId === projectId);
    if (!member) return null;
    member.role = role;
    return member;
  }

  async removeMember(projectId: string, userId: string): Promise<boolean> {
    const idx = this.members.findIndex((m) => m.userId === userId && m.projectId === projectId);
    if (idx === -1) return false;
    this.members.splice(idx, 1);
    return true;
  }

  async countOwners(projectId: string): Promise<number> {
    return this.members.filter((m) => m.projectId === projectId && m.role === 'owner').length;
  }
}

describe('DbMembershipStore', () => {
  let db: InMemoryMembershipDb;
  let store: DbMembershipStore;

  beforeEach(() => {
    db = new InMemoryMembershipDb();
    store = new DbMembershipStore(db);
  });

  it('returns membership for existing member', async () => {
    await db.addMember('p1', 'u1', 'owner');
    const info = await store.getMembership('u1', 'p1');
    expect(info).toEqual({ userId: 'u1', projectId: 'p1', role: 'owner' });
  });

  it('returns null for non-member', async () => {
    expect(await store.getMembership('u1', 'p1')).toBeNull();
  });

  it('integrates with AuthorizationGuard', async () => {
    await db.addMember('p1', 'u1', 'member');
    const guard = new AuthorizationGuard(store);
    const membership = await guard.requireMembership('u1', 'p1');
    expect(membership.role).toBe('member');
  });
});

describe('ProjectMemberService', () => {
  let db: InMemoryMembershipDb;
  let service: ProjectMemberService;

  beforeEach(() => {
    db = new InMemoryMembershipDb();
    service = new ProjectMemberService(db);
  });

  describe('addMember', () => {
    it('adds a member with default role', async () => {
      const record = await service.addMember('p1', 'u1');
      expect(record.role).toBe('member');
    });

    it('adds a member with specific role', async () => {
      const record = await service.addMember('p1', 'u1', 'owner');
      expect(record.role).toBe('owner');
    });
  });

  describe('listMembers', () => {
    it('lists all members of a project', async () => {
      await service.addMember('p1', 'u1', 'owner');
      await service.addMember('p1', 'u2', 'member');
      const members = await service.listMembers('p1');
      expect(members).toHaveLength(2);
    });

    it('does not include members from other projects', async () => {
      await service.addMember('p1', 'u1', 'owner');
      await service.addMember('p2', 'u2', 'owner');
      const members = await service.listMembers('p1');
      expect(members).toHaveLength(1);
    });
  });

  describe('updateRole', () => {
    it('updates member role', async () => {
      await service.addMember('p1', 'u1', 'member');
      const updated = await service.updateRole('p1', 'u1', 'admin');
      expect(updated.role).toBe('admin');
    });

    it('throws when member not found', async () => {
      await expect(service.updateRole('p1', 'u1', 'admin')).rejects.toThrow('Member not found');
    });

    it('prevents removing last owner', async () => {
      await service.addMember('p1', 'u1', 'owner');
      await expect(service.updateRole('p1', 'u1', 'member')).rejects.toThrow('last owner');
    });

    it('allows demoting owner when another owner exists', async () => {
      await service.addMember('p1', 'u1', 'owner');
      await service.addMember('p1', 'u2', 'owner');
      const updated = await service.updateRole('p1', 'u1', 'member');
      expect(updated.role).toBe('member');
    });
  });

  describe('removeMember', () => {
    it('removes a member', async () => {
      await service.addMember('p1', 'u1', 'owner');
      await service.addMember('p1', 'u2', 'member');
      await service.removeMember('p1', 'u2');
      const members = await service.listMembers('p1');
      expect(members).toHaveLength(1);
    });

    it('throws when member not found', async () => {
      await expect(service.removeMember('p1', 'u1')).rejects.toThrow('Member not found');
    });

    it('prevents removing last owner', async () => {
      await service.addMember('p1', 'u1', 'owner');
      await expect(service.removeMember('p1', 'u1')).rejects.toThrow('last owner');
    });

    it('allows removing owner when another owner exists', async () => {
      await service.addMember('p1', 'u1', 'owner');
      await service.addMember('p1', 'u2', 'owner');
      await service.removeMember('p1', 'u1');
      const members = await service.listMembers('p1');
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe('u2');
    });
  });
});
