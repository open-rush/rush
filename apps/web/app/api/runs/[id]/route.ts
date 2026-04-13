import { DrizzleRunDb, RunService } from '@lux/control-plane';
import { agents, getDbClient } from '@lux/db';
import { eq } from 'drizzle-orm';

import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res: unknown) {
    return res as Response;
  }

  const { id } = await params;

  const db = getDbClient();
  const runDb = new DrizzleRunDb(db);
  const runService = new RunService(runDb);

  const run = await runService.getById(id);
  if (!run) {
    return apiError(404, 'RUN_NOT_FOUND', `Run ${id} not found`);
  }

  // Verify user has access to the run's project (run → agent → project)
  const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
  if (!agent) {
    return apiError(404, 'RUN_NOT_FOUND', `Run ${id} not found`);
  }
  const hasAccess = await verifyProjectAccess(agent.projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this run');
  }

  return apiSuccess({
    id: run.id,
    status: run.status,
    agentId: run.agentId,
    prompt: run.prompt,
    activeStreamId: run.activeStreamId,
    retryCount: run.retryCount,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  });
}
