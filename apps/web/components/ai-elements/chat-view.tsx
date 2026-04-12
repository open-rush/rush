'use client';

import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';
import { useCallback, useMemo, useState } from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { LoadingDots } from '@/components/ui/loading-dots';
import { PartRenderer } from './part-renderer';
import { PromptInput } from './chat-input';

export function ChatView() {
  const transport = useMemo(() => new TextStreamChatTransport({ api: '/api/chat' }), []);

  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    transport,
  });

  const [input, setInput] = useState('');

  const isLoading = status === 'submitted' || status === 'streaming';

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    clearError();
    sendMessage({ text });
  }, [input, isLoading, sendMessage, clearError]);

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="mx-4 mt-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error.message || 'An error occurred. Please try again.'}
        </div>
      )}

      <Conversation className="flex-1">
        <ConversationContent className="max-w-3xl mx-auto">
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Rush"
              description="Start a conversation with the AI agent."
            />
          )}

          {messages.map((message, messageIndex) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                {message.parts.map((part, partIndex) => (
                  <PartRenderer
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable message parts
                    key={`${message.id}-${partIndex}`}
                    part={part}
                    message={message}
                    index={partIndex}
                    status={status}
                    isLastMessage={messageIndex === messages.length - 1}
                  />
                ))}

                {/* Loading indicator for assistant response */}
                {isLoading && messageIndex === messages.length - 1 && message.role === 'user' && (
                  <div className="flex items-center gap-2 py-2 text-muted-foreground">
                    <LoadingDots size="md" label="Thinking" />
                  </div>
                )}
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
      </Conversation>

      <div className="border-t border-border p-4">
        <div className="max-w-3xl mx-auto">
          <PromptInput
            input={input}
            isLoading={isLoading}
            onInputChange={setInput}
            onSubmit={handleSubmit}
            onStop={stop}
          />
        </div>
      </div>
    </div>
  );
}
