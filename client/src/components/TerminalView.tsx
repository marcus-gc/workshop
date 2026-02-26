import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  craftsmanId: string
  isRunning: boolean
}

export default function TerminalView({ craftsmanId, isRunning }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    if (!isRunning || !containerRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Fit after a brief delay to let the DOM settle
    requestAnimationFrame(() => fitAddon.fit())

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${protocol}//${location.host}/api/craftsmen/${craftsmanId}/terminal`
    )
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.addEventListener('open', () => {
      fitAddon.fit()
      const dims = { type: 'resize', cols: terminal.cols, rows: terminal.rows }
      ws.send(JSON.stringify(dims))
    })

    ws.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data))
      }
    })

    ws.addEventListener('close', () => {
      terminal.write('\r\n\x1b[90m[Connection closed]\x1b[0m\r\n')
    })

    ws.addEventListener('error', () => {
      terminal.write('\r\n\x1b[31m[Connection error]\x1b[0m\r\n')
    })

    // Terminal input → WebSocket
    const dataDisposable = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        const encoder = new TextEncoder()
        ws.send(encoder.encode(data))
      }
    })

    // Terminal resize → WebSocket
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    // ResizeObserver → fit
    const observer = new ResizeObserver(() => {
      fitAddon.fit()
    })
    observer.observe(containerRef.current)
    observerRef.current = observer

    return () => {
      observer.disconnect()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      ws.close()
      terminal.dispose()
      terminalRef.current = null
      wsRef.current = null
      fitAddonRef.current = null
      observerRef.current = null
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
