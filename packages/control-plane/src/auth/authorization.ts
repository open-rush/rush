import type { ProjectMemberRole } from '@lux/contracts';

export interface MembershipInfo {
  userId: string;
  projectId: string;
  role: ProjectMemberRole;
}

export interface MembershipStore {
  getMembership(userId: string, projectId: string): Promise<MembershipInfo | null>;
}

export type Permission =
  | 'project:read'
  | 'project:write'
  | 'project:delete'
  | 'project:manage_members';

const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = Object.freeze({
  owner: Object.freeze([
    'project:read',
    'project:write',
    'project:delete',
    'project:manage_members',
  ] as const),
  admin: Object.freeze(['project:read', 'project:write', 'project:manage_members'] as const),
  member: Object.freeze(['project:read', 'project:write'] as const),
});

export function getRolePermissions(role: ProjectMemberRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: ProjectMemberRole, permission: Permission): boolean {
  return getRolePermissions(role).includes(permission);
}

export class AuthorizationGuard {
  constructor(private store: MembershipStore) {}

  async requireMembership(userId: string, projectId: string): Promise<MembershipInfo> {
    const membership = await this.store.getMembership(userId, projectId);
    if (!membership) {
      throw new AuthorizationError('Not a member of this project', userId, projectId);
    }
    return membership;
  }

  async requirePermission(
    userId: string,
    projectId: string,
    permission: Permission
  ): Promise<MembershipInfo> {
    const membership = await this.requireMembership(userId, projectId);
    if (!hasPermission(membership.role, permission)) {
      throw new AuthorizationError(
        `Missing permission: ${permission}`,
        userId,
        projectId,
        permission
      );
    }
    return membership;
  }

  async requireOwner(userId: string, projectId: string): Promise<MembershipInfo> {
    const membership = await this.requireMembership(userId, projectId);
    if (membership.role !== 'owner') {
      throw new AuthorizationError('Owner role required', userId, projectId);
    }
    return membership;
  }
}

export class AuthorizationError extends Error {
  public readonly userId: string;
  public readonly projectId: string;
  public readonly permission?: Permission;

  constructor(message: string, userId: string, projectId: string, permission?: Permission) {
    super(message);
    this.name = 'AuthorizationError';
    this.userId = userId;
    this.projectId = projectId;
    this.permission = permission;
  }
}
