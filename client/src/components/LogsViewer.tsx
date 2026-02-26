import { useEffect, useRef } from 'react'

interface Props {
  craftsmanId: string
  logLines: string[]
  onClear: () => void
}

export default function LogsViewer({ logLines, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logLines.length])

  return (
    <div className="logs-pane">
      <div className="logs-toolbar">
        <span>{logLines.length} lines</span>
        <button
          className="btn btn-ghost"
          style={{ padding: '3px 10px', fontSize: 12 }}
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <div className="logs-output">
        {logLines.length === 0 ? (
          <div className="logs-empty" style={{ color: 'var(--text-dimmed)', padding: '20px 0' }}>
            No logs yet…
          </div>
        ) : (
          logLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
