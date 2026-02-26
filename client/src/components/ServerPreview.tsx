import { useState } from 'react'
import type { Craftsman } from '../types'

interface Props {
  craftsman: Craftsman
}

export default function ServerPreview({ craftsman }: Props) {
  const [showIframe, setShowIframe] = useState(false)
  const [activePort, setActivePort] = useState<string | null>(null)

  const portMappings: Record<string, number> = JSON.parse(craftsman.port_mappings)
  const ports = Object.keys(portMappings)

  if (ports.length === 0) {
    return (
      <div className="preview-pane">
        <div className="preview-no-ports">
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            No ports are configured for this craftsman's project.
          </p>
          <p style={{ color: 'var(--text-dimmed)', fontSize: 12, marginTop: 6 }}>
            Configure ports in Settings or ask the craftsman to set up the server.
          </p>
        </div>
      </div>
    )
  }

  const selectedPort = activePort ?? ports[0]
  const hostPort = portMappings[selectedPort]
  const proxyUrl = `${window.location.protocol}//${window.location.hostname}:${hostPort}/`

  return (
    <div className="preview-pane">
      <div className="preview-toolbar">
        {ports.map((port) => (
          <a
            key={port}
            href={proxyUrl}
            target="_blank"
            rel="noreferrer"
            className="port-link"
            onClick={(e) => {
              // Only follow the link if clicking the external link icon area or it's a different port
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
          </a>
        ))}

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

        <button
          className="preview-toggle-btn"
          onClick={() => setShowIframe((v) => !v)}
        >
          {showIframe ? 'Hide Preview' : 'Show Preview'}
        </button>
      </div>

      {showIframe ? (
        <div className="preview-iframe-container">
          <iframe
            key={`${craftsman.id}-${selectedPort}`}
            src={proxyUrl}
            className="preview-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title={`Preview port ${selectedPort}`}
          />
        </div>
      ) : (
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
      )}
    </div>
  )
}
