import type { RunEvent } from '@lux/contracts';

export interface ReconstructedMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCallInfo[];
  timestamp: Date;
}

export interface ToolCallInfo {
  toolName: string;
  input: unknown;
  output: string | null;
  error: string | null;
}

/**
 * Reconstruct a human-readable message list from raw run_events.
 * Groups events into user prompt + assistant response with tool calls.
 */
export function reconstructMessages(prompt: string, events: RunEvent[]): ReconstructedMessage[] {
  const messages: ReconstructedMessage[] = [];

  // User message (the original prompt)
  messages.push({
    role: 'user',
    content: prompt,
    toolCalls: [],
    timestamp: events[0]?.createdAt ?? new Date(),
  });

  // Assistant response: accumulate text deltas + tool calls
  let textContent = '';
  const toolCalls: ToolCallInfo[] = [];
  let currentTool: Partial<ToolCallInfo> | null = null;
  let assistantTimestamp: Date | null = null;

  for (const event of events) {
    const payload = event.payload as Record<string, unknown> | null;
    if (!payload) continue;

    const type = payload.type as string;

    if (!assistantTimestamp) {
      assistantTimestamp = event.createdAt;
    }

    switch (type) {
      case 'text-delta':
        textContent += (payload.content as string) ?? (payload.delta as string) ?? '';
        break;
      case 'tool-input-start':
        currentTool = {
          toolName: (payload.toolName as string) ?? 'unknown',
          input: null,
          output: null,
          error: null,
        };
        break;
      case 'tool-input-available':
        if (currentTool) {
          currentTool.input = payload.input ?? payload.content;
        }
        break;
      case 'tool-output-available':
        if (currentTool) {
          currentTool.output = (payload.output as string) ?? (payload.content as string) ?? null;
          toolCalls.push(currentTool as ToolCallInfo);
          currentTool = null;
        }
        break;
      case 'tool-output-error':
        if (currentTool) {
          currentTool.error = (payload.errorText as string) ?? (payload.content as string) ?? null;
          toolCalls.push(currentTool as ToolCallInfo);
          currentTool = null;
        }
        break;
    }
  }

  // Flush any incomplete tool call
  if (currentTool?.toolName) {
    toolCalls.push(currentTool as ToolCallInfo);
  }

  if (textContent || toolCalls.length > 0) {
    messages.push({
      role: 'assistant',
      content: textContent,
      toolCalls,
      timestamp: assistantTimestamp ?? new Date(),
    });
  }

  return messages;
}
