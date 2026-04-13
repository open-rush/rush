/**
 * Default Project API — GET /api/projects/default
 *
 * Returns the user's default project, creating one if none exists.
 * Used by the chat flow to ensure every conversation has a project.
 */

import { getDbClient, projects } from '@lux/db';
import { and, eq, isNull } from 'drizzle-orm';
import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

const DEFAULT_PROJECT_NAME = 'My Project';

export async function GET() {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const db = getDbClient();

  // Find first non-deleted project for this user
  const [existing] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.createdBy, userId), isNull(projects.deletedAt)))
    .orderBy(projects.createdAt)
    .limit(1);

  if (existing) {
    return apiSuccess({ id: existing.id, name: existing.name });
  }

  // Create default project
  const [created] = await db
    .insert(projects)
    .values({
      name: DEFAULT_PROJECT_NAME,
      createdBy: userId,
    })
    .returning();

  if (!created) {
    return apiError(500, 'INTERNAL_ERROR', 'Failed to create default project');
  }

  return apiSuccess({ id: created.id, name: created.name });
}
