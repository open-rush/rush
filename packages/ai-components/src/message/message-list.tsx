import type { ChatMessage } from '../types.js';
import { MessageBubble } from './message-bubble.js';

export interface MessageListProps {
  messages: ChatMessage[];
  className?: string;
  renderContent?: (content: ChatMessage['content'][number]) => React.ReactNode;
}

export function MessageList({ messages, className = '', renderContent }: MessageListProps) {
  return (
    <div className={`flex flex-col gap-4 p-4 ${className}`}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} role={msg.role}>
          {msg.content.map((content, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: content has no unique id, order is stable
            <div key={`${msg.id}-${i}`}>
              {renderContent ? renderContent(content) : <span>{content.text}</span>}
            </div>
          ))}
        </MessageBubble>
      ))}
    </div>
  );
}
