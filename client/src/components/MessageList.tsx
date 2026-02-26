import { useEffect, useRef } from 'react'
import type { Message } from '../types'

interface Props {
  messages: Message[]
  streamingContent: string | null
}

export default function MessageList({ messages, streamingContent }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingContent])

  return (
    <div className="messages-container">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {streamingContent !== null && (
        <div className="message assistant">
          <div className="streaming-bubble">
            {streamingContent}
            <span className="cursor" />
          </div>
        </div>
      )}

      {messages.length === 0 && streamingContent === null && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-dimmed)', fontSize: 13 }}>
            Send a message to get started
          </span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={`message ${message.role}`}>
      <div className="message-bubble">
        {message.content}
      </div>
      {!isUser && (message.cost_usd != null || message.duration_ms != null) && (
        <div className="message-meta">
          {message.duration_ms != null && `${(message.duration_ms / 1000).toFixed(1)}s`}
          {message.cost_usd != null && message.duration_ms != null && ' · '}
          {message.cost_usd != null && `$${message.cost_usd.toFixed(4)}`}
        </div>
      )}
    </div>
  )
}
