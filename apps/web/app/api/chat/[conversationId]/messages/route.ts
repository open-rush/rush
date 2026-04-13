/**
 * Messages API — GET/POST /api/chat/[conversationId]/messages
 *
 * GET: Load messages for a conversation
 * POST: Save messages for a conversation (used by auto-save)
 */

import { conversations, getDbClient, messages as messagesTable } from '@lux/db';
import { eq } from 'drizzle-orm';
import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

/** Verify the conversation exists and belongs to the current user. */
async function verifyConversationOwner(conversationId: string, userId: string) {
  const db = getDbClient();
  const [conv] = await db
    .select({ userId: conversations.userId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conv) return 'NOT_FOUND' as const;
  if (conv.userId !== userId) return 'FORBIDDEN' as const;
  return 'OK' as const;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { conversationId } = await params;

  const check = await verifyConversationOwner(conversationId, userId);
  if (check === 'NOT_FOUND') return apiError(404, 'NOT_FOUND', 'Conversation not found');
  if (check === 'FORBIDDEN') return apiError(403, 'FORBIDDEN', 'No access to this conversation');

  const db = getDbClient();
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(messagesTable.createdAt);

  const uiMessages = rows.map((row) => row.content);
  return apiSuccess(uiMessages);
}

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

  const check = await verifyConversationOwner(conversationId, userId);
  if (check === 'NOT_FOUND') return apiError(404, 'NOT_FOUND', 'Conversation not found');
  if (check === 'FORBIDDEN') return apiError(403, 'FORBIDDEN', 'No access to this conversation');

  const body = await request.json();
  const { messages, model } = body as {
    messages: Array<{ id: string; role: string; parts?: unknown[]; [key: string]: unknown }>;
    model?: string;
  };

  if (!Array.isArray(messages)) {
    return apiError(400, 'VALIDATION_ERROR', 'messages must be an array');
  }

  const db = getDbClient();

  // Atomic replace: delete + insert in a transaction
  await db.transaction(async (tx) => {
    await tx.delete(messagesTable).where(eq(messagesTable.conversationId, conversationId));

    if (messages.length > 0) {
      await tx.insert(messagesTable).values(
        messages.map((msg) => ({
          conversationId,
          role: msg.role,
          content: msg,
          model: model ?? null,
        }))
      );
    }
  });

  return apiSuccess({ saved: messages.length });
}
