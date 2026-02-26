import { useEffect, useState } from 'react'
import { useAppState, useAppDispatch } from '../store/AppContext'
import { useContainerLogs } from '../hooks/useContainerLogs'
import { useMessageStream } from '../hooks/useMessageStream'
import { listMessages, stopCraftsman, startCraftsman, deleteCraftsman, getStats } from '../api'
import type { Tab } from '../store/reducer'
import MessageList from './MessageList'
import MessageInput from './MessageInput'
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

  const craftsman = state.craftsmen.find((c) => c.id === craftsmanId)
  const project = craftsman ? state.projects.find((p) => p.id === craftsman.project_id) : null
  const ui = state.craftsmanUi[craftsmanId]
  const activeTab: Tab = ui?.activeTab ?? 'chat'

  // Load messages on mount / craftsman change
  useEffect(() => {
    if (!craftsmanId) return
    listMessages(craftsmanId)
      .then((messages) => dispatch({ type: 'SET_MESSAGES', craftsmanId, messages }))
      .catch(() => {})
  }, [craftsmanId, dispatch])

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

  // Message streaming
  const sendMessage = useMessageStream(craftsmanId, dispatch)

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
    if (!confirm(`Relieve craftsman "${craftsman?.name}"? This will remove the container and all message history.`)) return
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
            <button
              className="header-btn primary"
              onClick={handleStart}
              disabled={isActioning}
            >
              Start
            </button>
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

      {actionError && <div className="error-banner">{actionError}</div>}
      {craftsman.error_message && (
        <div className="error-banner">Error: {craftsman.error_message}</div>
      )}

      {/* Tabs */}
      <div className="tab-bar">
        {(['chat', 'logs', 'terminal', 'preview'] as Tab[]).map((tab) => {
          const labels: Record<Tab, string> = {
            chat: 'Conversation',
            logs: 'Logs',
            terminal: 'Terminal',
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
      {activeTab === 'chat' && (
        <>
          <MessageList
            messages={ui?.messages ?? []}
            streamingContent={ui?.streamingContent ?? null}
          />
          <MessageInput
            craftsmanId={craftsmanId}
            isRunning={isRunning}
            isStreaming={ui?.isStreaming ?? false}
            onSend={sendMessage}
          />
        </>
      )}

      {activeTab === 'logs' && (
        <LogsViewer
          craftsmanId={craftsmanId}
          logLines={ui?.logLines ?? []}
          onClear={() => dispatch({ type: 'CLEAR_LOGS', craftsmanId })}
        />
      )}

      {activeTab === 'terminal' && (
        <TerminalView craftsmanId={craftsmanId} isRunning={isRunning} />
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
