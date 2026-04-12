'use client';

import type { UIMessage } from 'ai';
import { cn } from '@/lib/utils';
import { CodeBlock } from './inline-code-block';
import { ToolCard } from './tool-card';

interface MessageBubbleProps {
  message: UIMessage;
}

/** Parse markdown-style code blocks from text content. */
function renderTextWithCodeBlocks(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    const codeMatch = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
    if (codeMatch) {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable text parts
        <CodeBlock key={i} language={codeMatch[1] || undefined} code={codeMatch[2].trimEnd()} />
      );
    }
    if (part.trim()) {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable text parts
        <span key={i} className="whitespace-pre-wrap break-words">
          {part}
        </span>
      );
    }
    return null;
  });
}

function mapToolState(state: string): 'partial-call' | 'call' | 'result' | 'error' {
  switch (state) {
    case 'input-streaming':
      return 'partial-call';
    case 'input-available':
    case 'approval-requested':
    case 'approval-responded':
      return 'call';
    case 'output-available':
      return 'result';
    case 'output-error':
    case 'output-denied':
      return 'error';
    default:
      return 'call';
  }
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn(isUser ? 'max-w-[80%] bg-secondary rounded-lg px-4 py-3' : 'w-full')}>
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            const key = `${message.id}-text-${i}`;
            return (
              <div key={key} className="text-sm leading-relaxed">
                {renderTextWithCodeBlocks(part.text)}
              </div>
            );
          }
          if (part.type === 'dynamic-tool') {
            return (
              <ToolCard
                key={part.toolCallId}
                toolName={part.toolName}
                state={mapToolState(part.state)}
                args={part.input as Record<string, unknown> | undefined}
                result={
                  'output' in part
                    ? (part.output as unknown)
                    : 'errorText' in part
                      ? part.errorText
                      : undefined
                }
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
