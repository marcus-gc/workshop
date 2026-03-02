import { useEffect, useState } from 'react'
import { useAppState, useAppDispatch } from '../store/AppContext'
import { useContainerLogs } from '../hooks/useContainerLogs'
import { stopCraftsman, startCraftsman, deleteCraftsman, updateCraftsman, getStats } from '../api'
import type { Tab } from '../store/reducer'
import LogsViewer from './LogsViewer'
import ServerPreview from './ServerPreview'
import TerminalView from './TerminalView'
import { useTerminalStore } from '../store/terminalStore'
import GitPanel from './GitPanel'

interface Props {
  craftsmanId: string
}

export default function ConversationPane({ craftsmanId }: Props) {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [showGit, setShowGit] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isActioning, setIsActioning] = useState(false)
  const [editingPorts, setEditingPorts] = useState(false)
  const [editPorts, setEditPorts] = useState<number[]>([])
  const [portInput, setPortInput] = useState('')
  const [portError, setPortError] = useState<string | null>(null)
  const [portSaving, setPortSaving] = useState(false)

  const craftsman = state.craftsmen.find((c) => c.id === craftsmanId)
  const project = craftsman ? state.projects.find((p) => p.id === craftsman.project_id) : null
  const ui = state.craftsmanUi[craftsmanId]
  const activeTab: Tab = ui?.activeTab ?? 'terminal'

  // Poll stats every 5s when running
  useEffect(() => {
    if (craftsman?.status !== 'running') return
    const poll = () => {
      getStats(craftsmanId)
        .then((stats) => dispatch({ type: 'SET_STATS', craftsmanId, stats }))
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [craftsmanId, craftsman?.status, dispatch])

  // Subscribe to container logs when Logs tab is active
  useContainerLogs(craftsmanId, activeTab === 'logs', dispatch)

  async function handleStop() {
    setActionError(null)
    setIsActioning(true)
    try {
      await stopCraftsman(craftsmanId)
      useTerminalStore.getState().destroy(craftsmanId)
      dispatch({ type: 'UPDATE_CRAFTSMAN_STATUS', id: craftsmanId, status: 'stopped' })
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsActioning(false)
    }
  }

  async function handleStart() {
    setActionError(null)
    setIsActioning(true)
    try {
      await startCraftsman(craftsmanId)
      dispatch({ type: 'UPDATE_CRAFTSMAN_STATUS', id: craftsmanId, status: 'starting' })
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsActioning(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Relieve craftsman "${craftsman?.name}"? This will remove the container and all data.`)) return
    setActionError(null)
    setIsActioning(true)
    try {
      await deleteCraftsman(craftsmanId)
      useTerminalStore.getState().destroy(craftsmanId)
      dispatch({ type: 'REMOVE_CRAFTSMAN', id: craftsmanId })
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err))
      setIsActioning(false)
    }
  }

  function handleEditPorts() {
    if (!craftsman) return
    const currentPorts: number[] = craftsman.ports
      ? JSON.parse(craftsman.ports)
      : (project ? JSON.parse(project.ports) : [])
    setEditPorts(currentPorts)
    setPortInput('')
    setPortError(null)
    setEditingPorts(true)
  }

  function handleAddPort() {
    const num = Number(portInput)
    if (!Number.isInteger(num) || num < 1 || num > 65535) {
      setPortError('Port must be an integer between 1 and 65535')
      return
    }
    if (editPorts.includes(num)) {
      setPortError('Port already exists')
      return
    }
    setPortError(null)
    setEditPorts([...editPorts, num])
    setPortInput('')
  }

  async function handleSavePorts() {
    if (!confirm('This will recreate the container with a fresh clone and setup. Continue?')) return
    setPortSaving(true)
    setPortError(null)
    try {
      const updated = await updateCraftsman(craftsmanId, { ports: editPorts })
      dispatch({ type: 'UPDATE_CRAFTSMAN', craftsman: updated })
      setEditingPorts(false)
    } catch (err: unknown) {
      setPortError(err instanceof Error ? err.message : String(err))
    } finally {
      setPortSaving(false)
    }
  }

  if (!craftsman) return null

  const stats = ui?.stats
  const isRunning = craftsman.status === 'running'

  return (
    <div className="conversation-pane">
      {/* Header */}
      <div className="conversation-header">
        <span className={`status-dot ${craftsman.status}`} />
        <h2>{craftsman.name}</h2>
        {project && <span className="project-label">{project.name}</span>}
        <span className={`status-badge ${craftsman.status}`}>{craftsman.status}</span>

        {stats && (
          <span className="stats-bar">
            {stats.cpu_percent.toFixed(1)}% CPU · {Math.round(stats.memory_mb)} MB
          </span>
        )}

        <div className="conversation-header-right">
          <button className="header-btn" onClick={() => setShowGit(true)}>
            Git
          </button>
          {isRunning ? (
            <button
              className="header-btn danger"
              onClick={handleStop}
              disabled={isActioning}
            >
              Stop
            </button>
          ) : craftsman.status === 'stopped' ? (
            <>
              <button
                className="header-btn"
                onClick={handleEditPorts}
                disabled={isActioning || editingPorts}
              >
                Edit Ports
              </button>
              <button
                className="header-btn primary"
                onClick={handleStart}
                disabled={isActioning}
              >
                Start
              </button>
            </>
          ) : null}
          {(craftsman.status === 'stopped' || craftsman.status === 'error') && (
            <button
              className="header-btn danger"
              onClick={handleDelete}
              disabled={isActioning}
            >
              Relieve
            </button>
          )}
        </div>
      </div>

      {editingPorts && (
        <div className="port-editor-row" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {editPorts.map((port) => (
            <span key={port} className="tag" style={{ marginRight: 0 }}>
              :{port}
              <button
                className="tag-remove"
                onClick={() => setEditPorts(editPorts.filter((p) => p !== port))}
                disabled={portSaving}
                title={`Remove port ${port}`}
              >
                x
              </button>
            </span>
          ))}
          <input
            className="form-input"
            type="number"
            min={1}
            max={65535}
            value={portInput}
            onChange={(e) => { setPortInput(e.target.value); setPortError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddPort() } }}
            placeholder="Port"
            style={{ width: 80, padding: '3px 6px', fontSize: 11 }}
            disabled={portSaving}
          />
          <button
            className="btn btn-primary"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={handleAddPort}
            disabled={portSaving || !portInput}
          >
            Add
          </button>
          <button
            className="btn btn-primary"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={handleSavePorts}
            disabled={portSaving}
          >
            {portSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => { setEditingPorts(false); setPortError(null) }}
            disabled={portSaving}
          >
            Cancel
          </button>
          {portError && (
            <div style={{ color: 'var(--status-error)', fontSize: 11, width: '100%' }}>{portError}</div>
          )}
        </div>
      )}

      {actionError && <div className="error-banner">{actionError}</div>}
      {craftsman.error_message && (
        <div className="error-banner">Error: {craftsman.error_message}</div>
      )}

      {/* Tabs */}
      <div className="tab-bar">
        {(['terminal', 'logs', 'preview'] as Tab[]).map((tab) => {
          const labels: Record<Tab, string> = {
            terminal: 'Terminal',
            logs: 'Logs',
            preview: 'Preview',
          }
          return (
            <button
              key={tab}
              className={`tab-btn${activeTab === tab ? ' active' : ''}`}
              onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', craftsmanId, tab })}
            >
              {labels[tab]}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'terminal' && (
        <TerminalView craftsmanId={craftsmanId} isRunning={isRunning} />
      )}

      {activeTab === 'logs' && (
        <LogsViewer
          craftsmanId={craftsmanId}
          logLines={ui?.logLines ?? []}
          onClear={() => dispatch({ type: 'CLEAR_LOGS', craftsmanId })}
        />
      )}

      {activeTab === 'preview' && (
        <ServerPreview craftsman={craftsman} />
      )}

      {showGit && (
        <GitPanel craftsmanId={craftsmanId} onClose={() => setShowGit(false)} />
      )}
    </div>
  )
}
