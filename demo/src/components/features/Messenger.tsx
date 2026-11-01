import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { MessageBubble } from '@/components/features/MessageBubble'
import { MessageSquare, Send } from 'lucide-react'
import type { ChatMessage, Member } from '@/types'
import { cn } from '@/lib/utils'

interface MessengerProps {
  members: Member[]
  messages: Record<string, ChatMessage[]>
  activeConversationId: string | null
  onSelectConversation: (memberId: string) => void
  onSendMessage: (memberId: string, body: string) => void
}

// Team messenger — adapted from the Krafton FDE clone's Tab2Messenger
// (1:1 DM thread + input/send), here as member-to-member conversations stored
// locally (no LLM) so workflows like "ask a teammate for their opinion" are testable.
export function Messenger({
  members,
  messages,
  activeConversationId,
  onSelectConversation,
  onSendMessage,
}: MessengerProps) {
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const activeMember = members.find((m) => m.id === activeConversationId) ?? null
  const thread = activeConversationId ? messages[activeConversationId] ?? [] : []

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread.length, activeConversationId])

  const send = () => {
    const text = input.trim()
    if (!text || !activeConversationId) return
    onSendMessage(activeConversationId, text)
    setInput('')
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <MessageSquare className="h-6 w-6" />
          Team Messenger
        </h2>
        <p className="text-muted-foreground">
          Direct-message a teammate — e.g. to ask for their opinion on a task.
        </p>
      </div>

      <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-0 rounded-lg border overflow-hidden h-[560px]">
        {/* Conversation list */}
        <div className="border-r bg-muted/20 overflow-y-auto min-h-0" data-agrune-demo="messenger-conversation-list">
          {members.map((member) => {
            const last = (messages[member.id] ?? []).slice(-1)[0]
            const online = member.status === 'active'
            const selected = member.id === activeConversationId
            return (
              <button
                key={member.id}
                type="button"
                data-agrune-demo="messenger-conversation"
                data-member-id={member.id}
                aria-label={`Conversation with ${member.name}`}
                onClick={() => onSelectConversation(member.id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b transition-colors',
                  selected ? 'bg-background' : 'hover:bg-background/60',
                )}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                    {member.avatar}
                  </div>
                  {online && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-background" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{member.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {last ? last.body : member.role}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Thread */}
        <div className="flex flex-col min-w-0 min-h-0">
          {activeMember ? (
            <>
              <div className="border-b px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                  {activeMember.avatar}
                </div>
                <div>
                  <p className="text-sm font-medium">{activeMember.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {activeMember.status === 'active' ? 'Online' : 'Offline'} · {activeMember.role}
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {thread.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground mt-8">
                    No messages yet. Say hello to {activeMember.name}.
                  </p>
                )}
                {thread.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} member={activeMember} />
                ))}
                <div ref={endRef} />
              </div>

              <div className="border-t p-3">
                <div className="flex gap-2">
                  <Input
                    id="messenger-input"
                    data-testid="messenger-input"
                    placeholder="Type a message..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        send()
                      }
                    }}
                  />
                  <Button
                    data-testid="messenger-send-button"
                    aria-label="Send message"
                    onClick={send}
                    disabled={!input.trim()}
                  >
                    <Send className="h-4 w-4" />
                    Send
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a teammate to start messaging.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
