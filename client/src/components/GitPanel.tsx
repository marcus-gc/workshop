import { useState, useEffect } from 'react'
import { getDiff, gitCommit, gitPush, openPR } from '../api'
import type { DiffResult } from '../types'

interface Props {
  craftsmanId: string
  onClose: () => void
}

type Step = 'diff' | 'commit' | 'push' | 'pr' | 'done'

export default function GitPanel({ craftsmanId, onClose }: Props) {
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('diff')
  const [commitMsg, setCommitMsg] = useState('')
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [actioning, setActioning] = useState(false)
  const [pushBranch, setPushBranch] = useState<string | null>(null)
  const [prUrl, setPrUrl] = useState<string | null>(null)

  useEffect(() => {
    getDiff(craftsmanId)
      .then((d) => { setDiff(d); setLoading(false) })
      .catch((err: Error) => { setError(err.message); setLoading(false) })
  }, [craftsmanId])

  async function handleCommit() {
    if (!commitMsg.trim()) return
    setActioning(true)
    setError(null)
    try {
      await gitCommit(craftsmanId, commitMsg.trim())
      setStep('push')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActioning(false)
    }
  }

  async function handlePush() {
    setActioning(true)
    setError(null)
    try {
      const result = await gitPush(craftsmanId)
      setPushBranch(result.branch)
      setStep('pr')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActioning(false)
    }
  }

  async function handlePR() {
    if (!prTitle.trim()) return
    setActioning(true)
    setError(null)
    try {
      const result = await openPR(craftsmanId, prTitle.trim(), prBody)
      setPrUrl(result.pr_url)
      setStep('done')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setActioning(false)
    }
  }

  return (
    <div className="git-panel-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="git-panel">
        <div className="git-panel-header">
          <h3>Git</h3>
          <button className="icon-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="git-panel-body">
          {error && <div className="error-banner" style={{ margin: '0 0 12px' }}>{error}</div>}

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <span className="spinner" />
            </div>
          ) : step === 'diff' || step === 'commit' ? (
            <>
              {diff && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    {diff.files_changed.length} file{diff.files_changed.length !== 1 ? 's' : ''} changed ·{' '}
                    <span style={{ color: '#4ade80' }}>+{diff.insertions}</span>{' '}
                    <span style={{ color: '#f87171' }}>-{diff.deletions}</span>
                  </div>
                  {diff.diff ? (
                    <DiffViewer diff={diff.diff} />
                  ) : (
                    <div style={{ color: 'var(--text-dimmed)', fontSize: 13, padding: '20px 0' }}>
                      No uncommitted changes
                    </div>
                  )}
                </div>
              )}
            </>
          ) : step === 'push' ? (
            <div style={{ padding: '20px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
              ✓ Committed. Ready to push.
            </div>
          ) : step === 'pr' ? (
            <>
              <div style={{ fontSize: 12, color: 'var(--status-running)', marginBottom: 12 }}>
                ✓ Pushed to branch: <code style={{ fontFamily: 'var(--font-mono)' }}>{pushBranch}</code>
              </div>
              <div className="form-group">
                <label className="form-label">PR Title</label>
                <input
                  className="form-input"
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  placeholder="Brief description of changes"
                />
              </div>
              <div className="form-group">
                <label className="form-label">PR Description (optional)</label>
                <textarea
                  className="form-input"
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  placeholder="What does this PR do?"
                  rows={4}
                  style={{ resize: 'vertical' }}
                />
              </div>
            </>
          ) : step === 'done' ? (
            <div style={{ padding: '20px 0' }}>
              <div style={{ color: 'var(--status-running)', fontSize: 14, marginBottom: 12 }}>
                ✓ Pull request created!
              </div>
              {prUrl && (
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="port-link"
                  style={{ display: 'inline-flex' }}
                >
                  View PR on GitHub ↗
                </a>
              )}
            </div>
          ) : null}
        </div>

        <div className="git-panel-footer">
          {(step === 'diff' || step === 'commit') && diff && diff.diff && (
            <>
              <input
                className="form-input"
                placeholder="Commit message…"
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
              />
              <button
                className="btn btn-primary"
                onClick={handleCommit}
                disabled={actioning || !commitMsg.trim()}
              >
                {actioning ? 'Committing…' : 'Commit All Changes'}
              </button>
            </>
          )}

          {step === 'push' && (
            <button className="btn btn-primary" onClick={handlePush} disabled={actioning}>
              {actioning ? 'Pushing…' : 'Push to Branch'}
            </button>
          )}

          {step === 'pr' && (
            <button
              className="btn btn-primary"
              onClick={handlePR}
              disabled={actioning || !prTitle.trim()}
            >
              {actioning ? 'Creating PR…' : 'Open Pull Request'}
            </button>
          )}

          {step === 'pr' && (
            <button className="btn btn-ghost" onClick={onClose}>
              Skip PR
            </button>
          )}

          {step === 'done' && (
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  )
}

function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  return (
    <div className="diff-viewer">
      {lines.map((line, i) => {
        let cls = ''
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-add'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-del'
        else if (line.startsWith('@@')) cls = 'diff-hunk'
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) cls = 'diff-file'
        return (
          <div key={i} className={cls || undefined}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}
