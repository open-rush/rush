/**
 * Chat API — POST /api/chat
 *
 * Streams AI responses via Claude Code SDK (supports Anthropic API / AWS Bedrock / custom endpoint).
 */

import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { createLogger } from '@lux/observability';
import { registerAbortController, unregisterAbortController } from '@/lib/ai/stream-abort-registry';
import { requireAuth } from '@/lib/api-utils';

const logger = createLogger({ service: 'web:chat-api' });

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Claude Code model — env vars forwarded to the CLI subprocess
// ---------------------------------------------------------------------------

const ENV_PASSTHROUGH_KEYS = [
  // Bedrock
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'ANTHROPIC_MODEL',
  // Direct API / custom endpoint
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  // Network proxy
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
] as const;

function buildClaudeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_PASSTHROUGH_KEYS) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  return env;
}

const modelId = process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || 'sonnet';

const model = claudeCode(modelId, {
  permissionMode: 'bypassPermissions',
  maxTurns: 30,
  env: buildClaudeEnv(),
});

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function errorResponse(error: string, status: number, details?: unknown): Response {
  return Response.json(
    { error, timestamp: new Date().toISOString(), ...(details ? { details } : {}) },
    { status }
  );
}

function classifyStreamError(error: unknown): 'aborted' | '429' | 'unknown' {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'aborted';
    if (error.message.includes('429') || error.message.includes('rate limit')) return '429';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || `chat-${Date.now()}`;

  logger.info({ requestId }, '📨 Chat API request received');

  // Auth
  let userId: string;
  try {
    userId = await requireAuth();
    logger.info({ requestId, userId }, '✅ Auth successful');
  } catch (res) {
    logger.warn({ requestId }, '🚫 Auth failed');
    return res as Response;
  }

  // 1. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (err) {
    logger.error({ requestId, error: err }, '❌ Invalid JSON in request body');
    return errorResponse('Invalid JSON in request body', 400);
  }

  // 2. Validate
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    logger.warn({ requestId }, '⚠️ No messages provided');
    return errorResponse('At least one message is required', 422);
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined;
  const abortKey = conversationId ?? projectId ?? `req-${Date.now()}`;

  logger.info(
    {
      requestId,
      userId,
      projectId,
      conversationId,
      messagesCount: messages.length,
      abortKey,
    },
    '📝 Chat request validated'
  );

  // 3. AbortController
  const abortController = new AbortController();
  registerAbortController(abortKey, abortController);
  logger.info({ requestId, abortKey }, '🎯 AbortController registered');

  try {
    // 4. Convert UIMessage → CoreMessage
    logger.info({ requestId, messagesCount: messages.length }, '🔄 Converting messages...');
    const modelMessages = await convertToModelMessages(messages as UIMessage[]);
    logger.info(
      { requestId, modelMessagesCount: modelMessages.length },
      '✅ Messages converted successfully'
    );

    // 5. Stream
    logger.info({ requestId, modelId }, '🚀 Starting streamText...');
    const result = streamText({
      model,
      messages: modelMessages,
      abortSignal: abortController.signal,
    });

    // 6. Return UIMessageStream — clean up abort registry when stream finishes
    const response = result.toUIMessageStreamResponse();
    logger.info({ requestId }, '✅ Stream response created, returning to client');

    result.usage.then(
      (usage) => {
        logger.info({ requestId, usage }, '✅ Stream completed successfully');
        unregisterAbortController(abortKey, abortController);
      },
      (err) => {
        logger.error({ requestId, error: err }, '❌ Stream failed');
        unregisterAbortController(abortKey, abortController);
      }
    );
    return response;
  } catch (error) {
    unregisterAbortController(abortKey, abortController);

    const errorType = classifyStreamError(error);
    logger.error(
      {
        requestId,
        errorType,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      '❌ Chat API error'
    );

    if (errorType === 'aborted') {
      return errorResponse('Stream aborted', 499);
    }
    if (errorType === '429') {
      return errorResponse('Rate limited — please try again later', 429);
    }

    return errorResponse(
      'Failed to process message',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}
