import { useState, useRef, useEffect } from 'react'

interface Props {
  craftsmanId: string
  isRunning: boolean
  isStreaming: boolean
  onSend: (content: string) => Promise<void>
}

export default function MessageInput({ isRunning, isStreaming, onSend }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  async function handleSend() {
    const content = value.trim()
    if (!content || isStreaming || !isRunning) return
    setValue('')
    setError(null)
    try {
      await onSend(content)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const disabled = !isRunning || isStreaming
  let placeholder = 'Send a message to the craftsman… (Enter to send, Shift+Enter for newline)'
  if (!isRunning) placeholder = 'Craftsman is not running'
  if (isStreaming) placeholder = 'Waiting for response…'

  return (
    <div className="message-input-area">
      {error && <div className="error-banner" style={{ marginBottom: 8, margin: '0 0 8px 0' }}>{error}</div>}
      <div className="message-input-wrapper">
        <textarea
          ref={textareaRef}
          className="message-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
        >
          {isStreaming ? (
            <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
          ) : (
            'Send'
          )}
        </button>
      </div>
      <div className="input-hint">Enter to send · Shift+Enter for new line</div>
    </div>
  )
}
