import type { ChatMessage, Member } from '@/types'
import { cn } from '@/lib/utils'

interface MessageBubbleProps {
  message: ChatMessage
  member: Member
}

// Adapted from the Krafton FDE clone's ChatBubble (src/components/ChatBubble.tsx):
// 1:1 DM bubble — mine on the right, the member's on the left with avatar + name.
export function MessageBubble({ message, member }: MessageBubbleProps) {
  const isMe = message.from === 'me'
  const time = new Date(message.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      data-agrune-demo="messenger-message"
      data-message-id={message.id}
      className={cn('flex', isMe ? 'justify-end' : 'justify-start')}
    >
      <div className={cn('flex items-end gap-2 max-w-[75%]', isMe && 'flex-row-reverse')}>
        {!isMe && (
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
            {member.avatar}
          </div>
        )}
        <div>
          {!isMe && <p className="text-xs text-muted-foreground mb-1 ml-1">{member.name}</p>}
          <div
            className={cn(
              'px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
              isMe
                ? 'bg-primary text-primary-foreground rounded-br-md'
                : 'bg-muted text-foreground rounded-bl-md',
            )}
          >
            {message.body}
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground flex-shrink-0 pb-1">{time}</span>
      </div>
    </div>
  )
}
