import { useState } from 'react'
import type { Craftsman } from '../types'
import type { Action } from '../store/reducer'
import { addPort, removePort, getCraftsman } from '../api'

interface Props {
  craftsman: Craftsman
  dispatch: React.Dispatch<Action>
}

export default function ServerPreview({ craftsman, dispatch }: Props) {
  const [showIframe, setShowIframe] = useState(false)
  const [activePort, setActivePort] = useState<string | null>(null)
  const [portInput, setPortInput] = useState('')
  const [showAddPort, setShowAddPort] = useState(false)
  const [portError, setPortError] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const portMappings: Record<string, number> = JSON.parse(craftsman.port_mappings)
  const dynamicPorts = new Set<number>(JSON.parse(craftsman.dynamic_ports || '[]'))
  const ports = Object.keys(portMappings)

  async function refreshCraftsman() {
    const updated = await getCraftsman(craftsman.id)
    dispatch({ type: 'UPDATE_CRAFTSMAN', craftsman: updated })
  }

  async function handleAddPort() {
    const port = parseInt(portInput, 10)
    if (isNaN(port) || port <= 0 || port > 65535) {
      setPortError('Enter a valid port (1-65535)')
      return
    }
    setPortError(null)
    setIsAdding(true)
    try {
      await addPort(craftsman.id, port)
      await refreshCraftsman()
      setPortInput('')
      setShowAddPort(false)
    } catch (err: unknown) {
      setPortError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsAdding(false)
    }
  }

  async function handleRemovePort(port: number) {
    try {
      await removePort(craftsman.id, port)
      await refreshCraftsman()
    } catch (err: unknown) {
      setPortError(err instanceof Error ? err.message : String(err))
    }
  }

  const selectedPort = activePort ?? ports[0]
  const hostPort = selectedPort ? portMappings[selectedPort] : undefined
  const proxyUrl = hostPort
    ? `${window.location.protocol}//${window.location.hostname}:${hostPort}/`
    : ''

  return (
    <div className="preview-pane">
      <div className="preview-toolbar">
        {ports.map((port) => {
          const isDynamic = dynamicPorts.has(parseInt(port, 10))
          const portProxyUrl = `${window.location.protocol}//${window.location.hostname}:${portMappings[port]}/`
          return (
            <span key={port} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <a
                href={portProxyUrl}
                target="_blank"
                rel="noreferrer"
                className="port-link"
                onClick={(e) => {
                  if (port !== selectedPort) {
                    e.preventDefault()
                    setActivePort(port)
                  }
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                :{port}
                {isDynamic && (
                  <span style={{ fontSize: 10, color: 'var(--text-dimmed)', marginLeft: 3 }}>dynamic</span>
                )}
              </a>
              {isDynamic && (
                <button
                  className="preview-toggle-btn"
                  style={{ padding: '0 4px', fontSize: 14, lineHeight: 1, minWidth: 'auto' }}
                  onClick={() => handleRemovePort(parseInt(port, 10))}
                  title="Remove port forward"
                >
                  &times;
                </button>
              )}
            </span>
          )
        })}

        {showAddPort ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number"
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddPort()
                if (e.key === 'Escape') { setShowAddPort(false); setPortError(null) }
              }}
              placeholder="port"
              style={{
                width: 70,
                padding: '2px 6px',
                fontSize: 12,
                border: '1px solid var(--border)',
                borderRadius: 4,
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
              autoFocus
              disabled={isAdding}
            />
            <button
              className="preview-toggle-btn"
              onClick={handleAddPort}
              disabled={isAdding}
              style={{ fontSize: 12 }}
            >
              {isAdding ? '...' : 'Add'}
            </button>
            <button
              className="preview-toggle-btn"
              onClick={() => { setShowAddPort(false); setPortError(null) }}
              style={{ fontSize: 12 }}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="preview-toggle-btn"
            onClick={() => setShowAddPort(true)}
            style={{ fontSize: 12 }}
          >
            + Add Port
          </button>
        )}

        {proxyUrl && (
          <a
            href={proxyUrl}
            target="_blank"
            rel="noreferrer"
            className="preview-toggle-btn"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15,3 21,3 21,9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Open
          </a>
        )}

        <button
          className="preview-toggle-btn"
          onClick={() => setShowIframe((v) => !v)}
        >
          {showIframe ? 'Hide Preview' : 'Show Preview'}
        </button>
      </div>

      {portError && (
        <div style={{ padding: '4px 12px', fontSize: 12, color: '#f44', background: 'var(--bg-secondary)' }}>
          {portError}
        </div>
      )}

      {ports.length === 0 && !showAddPort ? (
        <div className="preview-no-ports">
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            No ports are configured for this craftsman's project.
          </p>
          <p style={{ color: 'var(--text-dimmed)', fontSize: 12, marginTop: 6 }}>
            Click "+ Add Port" to forward a container port, or ask the craftsman to set up a server.
          </p>
        </div>
      ) : showIframe && proxyUrl ? (
        <div className="preview-iframe-container">
          <iframe
            key={`${craftsman.id}-${selectedPort}`}
            src={proxyUrl}
            className="preview-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title={`Preview port ${selectedPort}`}
          />
        </div>
      ) : ports.length > 0 ? (
        <div className="preview-placeholder">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-dimmed)' }}>
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
          <p>Click "Show Preview" to embed the running server</p>
          <p style={{ fontSize: 12, color: 'var(--text-dimmed)' }}>
            Or use "Open" to view in a new tab
          </p>
        </div>
      ) : null}
    </div>
  )
}
