/**
 * Generate Title API — POST /api/chat/[conversationId]/generate-title
 *
 * Auto-generates conversation title from the first user message.
 */

import { ConversationService, DrizzleConversationDb } from '@lux/control-plane';
import { getDbClient } from '@lux/db';
import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { conversationId } = await params;
  const db = getDbClient();
  const service = new ConversationService(new DrizzleConversationDb(db));

  // Verify ownership
  const conv = await service.getById(conversationId);
  if (!conv) return apiError(404, 'NOT_FOUND', 'Conversation not found');
  if (conv.userId !== userId) return apiError(403, 'FORBIDDEN', 'No access to this conversation');

  const body = await request.json();
  const { firstMessage } = body as { firstMessage?: string };

  if (!firstMessage || typeof firstMessage !== 'string') {
    return apiError(400, 'VALIDATION_ERROR', 'firstMessage is required');
  }

  const title = await service.generateTitle(conversationId, firstMessage);
  return apiSuccess({ title });
}
