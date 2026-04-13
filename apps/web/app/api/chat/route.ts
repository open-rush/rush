/**
 * Chat API — POST /api/chat
 *
 * Streams AI responses via Claude Code SDK (supports Anthropic API / AWS Bedrock / custom endpoint).
 */

import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { registerAbortController, unregisterAbortController } from '@/lib/ai/stream-abort-registry';
import { requireAuth } from '@/lib/api-utils';

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
    { status },
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
  try {
    await requireAuth();
  } catch (res) {
    return res as Response;
  }

  // 1. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON in request body', 400);
  }

  // 2. Validate
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse('At least one message is required', 422);
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId : undefined;
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : undefined;
  const abortKey = conversationId ?? projectId ?? `req-${Date.now()}`;

  // 3. AbortController
  const abortController = new AbortController();
  registerAbortController(abortKey, abortController);

  try {
    // 4. Convert UIMessage → CoreMessage
    const modelMessages = await convertToModelMessages(messages as UIMessage[]);

    // 5. Stream
    const result = streamText({
      model,
      messages: modelMessages,
      abortSignal: abortController.signal,
    });

    // 6. Return UIMessageStream — clean up abort registry when stream finishes
    const response = result.toUIMessageStreamResponse();
    result.usage.then(
      () => unregisterAbortController(abortKey, abortController),
      () => unregisterAbortController(abortKey, abortController)
    );
    return response;
  } catch (error) {
    unregisterAbortController(abortKey, abortController);

    const errorType = classifyStreamError(error);
    if (errorType === 'aborted') {
      return errorResponse('Stream aborted', 499);
    }
    if (errorType === '429') {
      return errorResponse('Rate limited — please try again later', 429);
    }

    console.error('[Chat API] Error:', error);
    return errorResponse(
      'Failed to process message',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}
