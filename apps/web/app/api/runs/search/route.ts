import { getDbClient, runs } from '@lux/db';
import { and, desc, ilike } from 'drizzle-orm';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function GET(request: Request) {
  try {
    await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const url = new URL(request.url);
  const q = url.searchParams.get('q');
  const rawLimit = Number(url.searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

  if (!q || q.trim().length < 2) {
    return apiError(400, 'VALIDATION_ERROR', 'Query must be at least 2 characters');
  }

  const db = getDbClient();
  const conditions = [ilike(runs.prompt, `%${q}%`)];
  // If projectId provided, filter by agent's project (simplified: filter runs directly isn't possible without join)
  // For MVP, return all matching runs

  const results = await db
    .select({
      id: runs.id,
      prompt: runs.prompt,
      status: runs.status,
      agentId: runs.agentId,
      createdAt: runs.createdAt,
    })
    .from(runs)
    .where(and(...conditions))
    .orderBy(desc(runs.createdAt))
    .limit(limit);

  return apiSuccess(results);
}
