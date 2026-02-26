import { useEffect, useRef } from 'react'
import { useTerminalStore } from '../store/terminalStore'
import '@xterm/xterm/css/xterm.css'

interface Props {
  craftsmanId: string
  isRunning: boolean
}

export default function TerminalView({ craftsmanId, isRunning }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isRunning || !containerRef.current) return

    const { element, fitAddon } = useTerminalStore.getState().getOrCreate(craftsmanId)

    // Reparent the persistent terminal element into our container
    containerRef.current.appendChild(element)
    requestAnimationFrame(() => fitAddon.fit())

    const observer = new ResizeObserver(() => fitAddon.fit())
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      // Detach from DOM but keep the element alive in the store
      element.remove()
    }
  }, [craftsmanId, isRunning])

  if (!isRunning) {
    return (
      <div className="terminal-placeholder">
        Craftsman is not running. Start it to access the terminal.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      style={{ flex: 1, minHeight: 0 }}
    />
  )
}
