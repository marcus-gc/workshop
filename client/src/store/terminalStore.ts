import { create } from 'zustand'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

interface TerminalSession {
  terminal: Terminal
  fitAddon: FitAddon
  ws: WebSocket
  element: HTMLDivElement
}

interface TerminalStore {
  sessions: Record<string, TerminalSession>
  getOrCreate: (craftsmanId: string) => TerminalSession
  destroy: (craftsmanId: string) => void
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: {},

  getOrCreate(craftsmanId: string) {
    const existing = get().sessions[craftsmanId]
    if (existing && existing.ws.readyState <= WebSocket.OPEN) {
      return existing
    }

    // Clean up stale session if any
    if (existing) {
      existing.ws.close()
      existing.terminal.dispose()
    }

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

    // Persistent DOM element — opened once, reparented on attach/detach
    const element = document.createElement('div')
    element.style.width = '100%'
    element.style.height = '100%'
    terminal.open(element)

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${protocol}//${location.host}/api/craftsmen/${craftsmanId}/terminal`
    )
    ws.binaryType = 'arraybuffer'

    ws.addEventListener('open', () => {
      fitAddon.fit()
      ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
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

    const encoder = new TextEncoder()
    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data))
      }
    })

    terminal.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    const session: TerminalSession = { terminal, fitAddon, ws, element }
    set((state) => ({ sessions: { ...state.sessions, [craftsmanId]: session } }))
    return session
  },

  destroy(craftsmanId: string) {
    const session = get().sessions[craftsmanId]
    if (!session) return
    session.ws.close()
    session.terminal.dispose()
    set((state) => {
      const { [craftsmanId]: _, ...rest } = state.sessions
      return { sessions: rest }
    })
  },
}))
