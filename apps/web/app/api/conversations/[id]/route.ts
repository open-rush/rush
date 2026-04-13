import {
  ConversationService,
  DrizzleConversationDb,
  reconstructMessages,
} from '@lux/control-plane';
import { agents, getDbClient, runEvents, runs } from '@lux/db';
import { and, eq } from 'drizzle-orm';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  const db = getDbClient();
  const service = new ConversationService(new DrizzleConversationDb(db));

  const conversation = await service.getById(id);
  if (!conversation) {
    return apiError(404, 'NOT_FOUND', 'Conversation not found');
  }

  // Ownership check: only the conversation creator can view it
  if (conversation.userId !== userId) {
    return apiError(403, 'FORBIDDEN', 'No access to this conversation');
  }

  // Find runs associated with this conversation's agent within the same project
  const associatedRuns = conversation.agentId
    ? await db
        .select()
        .from(runs)
        .innerJoin(agents, eq(runs.agentId, agents.id))
        .where(
          and(eq(runs.agentId, conversation.agentId), eq(agents.projectId, conversation.projectId))
        )
        .orderBy(runs.createdAt)
    : [];

  // Reconstruct messages from each run's events
  const allMessages = [];
  for (const { runs: run } of associatedRuns) {
    const events = await db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, run.id))
      .orderBy(runEvents.seq);

    const messages = reconstructMessages(run.prompt, events);
    allMessages.push(...messages);
  }

  return apiSuccess({
    conversation,
    messages: allMessages,
    runCount: associatedRuns.length,
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  const db = getDbClient();
  const service = new ConversationService(new DrizzleConversationDb(db));

  const conversation = await service.getById(id);
  if (!conversation) {
    return apiError(404, 'NOT_FOUND', 'Conversation not found');
  }

  // Only conversation creator can delete
  if (conversation.userId !== userId) {
    return apiError(403, 'FORBIDDEN', 'No access to this conversation');
  }

  await service.remove(id);
  return apiSuccess({ deleted: true });
}
