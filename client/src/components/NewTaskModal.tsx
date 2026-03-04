import { useState, useEffect, useRef } from 'react'
import { createCraftsman } from '../api'
import type { Project, Craftsman } from '../types'

interface Props {
  projects: Project[]
  onClose: () => void
  onCreated: (craftsman: Craftsman) => void
}

type Step = 'form' | 'starting'

function generateTaskName(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`
  const rand = Math.random().toString(36).slice(2, 6)
  return `task-${date}-${time}-${rand}`
}

export default function NewTaskModal({ projects, onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>('form')
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [task, setTask] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [craftsman, setCraftsman] = useState<Craftsman | null>(null)
  const [status, setStatus] = useState<Craftsman['status']>('pending')
  const [statusError, setStatusError] = useState<string | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const logsRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const logsEsRef = useRef<EventSource | null>(null)

  // Auto-scroll startup logs
  useEffect(() => {
    logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight })
  }, [logLines])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      esRef.current?.close()
      logsEsRef.current?.close()
    }
  }, [])

  async function handleCreate() {
    const trimmedTask = task.trim()
    if (!trimmedTask || !projectId) return

    setCreating(true)
    setError(null)
    try {
      const name = generateTaskName()
      const c = await createCraftsman({ name, project_id: projectId, task: trimmedTask })
      setCraftsman(c)
      setStep('starting')
      subscribeToEvents(c)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  function subscribeToEvents(c: Craftsman) {
    const es = new EventSource(`/api/craftsmen/${c.id}/events`)
    esRef.current = es

    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { id: string; status: Craftsman['status']; error_message?: string }
        setStatus(data.status)
        if (data.error_message) setStatusError(data.error_message)

        if (data.status === 'running') {
          es.close()
          logsEsRef.current?.close()
          setTimeout(() => onCreated({ ...c, status: 'running' }), 1000)
        } else if (data.status === 'error') {
          es.close()
          logsEsRef.current?.close()
        }

        if (data.status !== 'pending' && !logsEsRef.current) {
          startLogsStream(c.id)
        }
      } catch {}
    })

    es.onerror = () => {}
  }

  function startLogsStream(craftsmanId: string, attempt = 0) {
    const logsEs = new EventSource(`/api/craftsmen/${craftsmanId}/logs`)
    logsEsRef.current = logsEs

    logsEs.onmessage = (e: MessageEvent) => {
      setLogLines((prev) => [...prev, e.data])
    }

    logsEs.onerror = () => {
      logsEs.close()
      logsEsRef.current = null
      if (attempt < 5 && status !== 'running' && status !== 'error') {
        setTimeout(() => startLogsStream(craftsmanId, attempt + 1), 1000 * (attempt + 1))
      }
    }
  }

  const selectedProject = projects.find((p) => p.id === projectId)

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        {step === 'form' ? (
          <>
            <h3>New Task</h3>

            {projects.length === 0 ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
                No projects found. Add a project in Settings first.
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">Project</label>
                  <select
                    className="form-select"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {selectedProject && (
                    <div style={{ fontSize: 11, color: 'var(--text-dimmed)', marginTop: 4 }}>
                      {selectedProject.repo_url} · {selectedProject.branch}
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">Task</label>
                  <textarea
                    className="form-input"
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    placeholder="Describe what Claude should work on..."
                    rows={5}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>

                {error && <div className="error-banner" style={{ margin: '0 0 12px' }}>{error}</div>}
              </>
            )}

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={creating || !task.trim() || !projectId || projects.length === 0}
              >
                {creating ? 'Starting…' : 'Start Task'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>Starting {craftsman?.name}…</h3>

            <div className="startup-progress">
              <div className={`startup-status ${status}`}>
                {status === 'running' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                ) : status === 'error' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                ) : (
                  <span className="spinner" />
                )}
                <span>
                  {status === 'pending' && 'Pending…'}
                  {status === 'starting' && 'Starting container…'}
                  {status === 'running' && 'Running! Redirecting…'}
                  {status === 'error' && `Error: ${statusError ?? 'Unknown error'}`}
                  {status === 'stopped' && 'Stopped'}
                </span>
              </div>

              {logLines.length > 0 && (
                <div className="startup-logs" ref={logsRef}>
                  {logLines.join('\n')}
                </div>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={onClose}>
                {status === 'error' ? 'Close' : 'Cancel'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
