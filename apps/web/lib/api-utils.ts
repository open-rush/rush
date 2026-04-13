import { DbMembershipStore, DrizzleMembershipDb } from '@lux/control-plane';
import { getDbClient, projects } from '@lux/db';
import { eq } from 'drizzle-orm';

import { auth } from '@/auth';

/**
 * Require authenticated session. Returns userId or throws 401 Response.
 */
export async function requireAuth(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    throw Response.json(
      { success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }
  return userId;
}

/**
 * Verify user has access to a project.
 * Checks: project_members first, then createdBy as fallback (for legacy projects without membership rows).
 */
export async function verifyProjectAccess(projectId: string, userId: string): Promise<boolean> {
  const db = getDbClient();

  // Check project exists and is not soft-deleted
  const [project] = await db
    .select({ createdBy: projects.createdBy, deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.deletedAt) return false;

  // Check membership
  const membershipDb = new DrizzleMembershipDb(db);
  const store = new DbMembershipStore(membershipDb);
  const membership = await store.getMembership(userId, projectId);
  if (membership) return true;

  // Fallback: creator access for projects without membership rows
  return project.createdBy === userId;
}

/**
 * Get the user's role in a project, or null if not a member.
 * Falls back to 'owner' if user is project creator without membership row.
 */
export async function getProjectRole(projectId: string, userId: string): Promise<string | null> {
  const db = getDbClient();

  // Check project exists and is not soft-deleted
  const [project] = await db
    .select({ createdBy: projects.createdBy, deletedAt: projects.deletedAt })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.deletedAt) return null;

  // Check membership
  const membershipDb = new DrizzleMembershipDb(db);
  const store = new DbMembershipStore(membershipDb);
  const membership = await store.getMembership(userId, projectId);
  if (membership) return membership.role;

  // Fallback: creator is implicitly owner
  if (project.createdBy === userId) return 'owner';

  return null;
}

/**
 * Standard API error response.
 */
export function apiError(status: number, code: string, message: string): Response {
  return Response.json({ success: false, error: message, code }, { status });
}

/**
 * Standard API success response.
 */
export function apiSuccess(data: unknown, status = 200): Response {
  return Response.json({ success: true, data }, { status });
}
