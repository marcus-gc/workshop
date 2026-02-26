import { useState, useEffect } from 'react'
import {
  listProjects,
  createProject,
  deleteProject,
  validateGitHubToken,
  listGitHubRepos,
} from '../api'
import type { Project, GitHubRepo } from '../types'

const TOKEN_KEY = 'workshop_github_token'

interface Props {
  onBack: () => void
  onProjectsChanged: () => void
}

export default function SettingsPane({ onBack, onProjectsChanged }: Props) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [tokenInput, setTokenInput] = useState(() => localStorage.getItem(TOKEN_KEY) ?? '')
  const [tokenUser, setTokenUser] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [importingId, setImportingId] = useState<number | null>(null)

  useEffect(() => {
    refreshProjects()
    // Validate saved token on mount
    if (token) {
      validateGitHubToken(token)
        .then((u) => setTokenUser(u.login))
        .catch(() => setTokenUser(null))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshProjects() {
    try {
      const p = await listProjects()
      setProjects(p)
    } catch {}
  }

  async function handleSaveToken() {
    setTokenError(null)
    setTokenUser(null)
    try {
      const user = await validateGitHubToken(tokenInput)
      setToken(tokenInput)
      localStorage.setItem(TOKEN_KEY, tokenInput)
      setTokenUser(user.login)
    } catch {
      setTokenError('Invalid token — check it has the correct scopes (repo or read:user)')
    }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncError(null)
    try {
      const ghRepos = await listGitHubRepos(token)
      setRepos(ghRepos)
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  async function handleImportRepo(repo: GitHubRepo) {
    setImportingId(repo.id)
    try {
      await createProject({
        name: repo.name,
        repo_url: repo.clone_url,
        branch: repo.default_branch,
        github_token: token || undefined,
        ports: [],
      })
      await refreshProjects()
      onProjectsChanged()
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : String(err))
    } finally {
      setImportingId(null)
    }
  }

  async function handleDeleteProject(id: string) {
    if (!confirm('Delete this project? This cannot be undone.')) return
    try {
      await deleteProject(id)
      await refreshProjects()
      onProjectsChanged()
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : String(err))
    }
  }

  const syncedUrls = new Set(projects.map((p) => p.repo_url))
  const unsyncedRepos = repos.filter((r) => !syncedUrls.has(r.clone_url))

  return (
    <div className="settings-pane">
      <div className="settings-header">
        <button className="icon-btn" onClick={onBack} title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <h2>Settings</h2>
      </div>

      {/* GitHub Token */}
      <div className="settings-section">
        <h3>GitHub Token</h3>
        <p className="settings-section-desc">
          Personal access token for importing repositories and creating pull requests.
          Requires <code>repo</code> scope.
        </p>
        <div className="settings-row">
          <input
            className="form-input"
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="ghp_…"
            style={{ maxWidth: 340 }}
          />
          <button className="btn btn-primary" onClick={handleSaveToken}>
            Save
          </button>
          {tokenUser && (
            <span className="token-status valid">✓ @{tokenUser}</span>
          )}
          {tokenError && (
            <span className="token-status invalid">{tokenError}</span>
          )}
        </div>
      </div>

      <div className="divider" />

      {/* Projects */}
      <div className="settings-section">
        <h3>Projects</h3>
        <p className="settings-section-desc">
          GitHub repositories that craftsmen can work on.
        </p>

        {projects.length > 0 ? (
          <table className="projects-table" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Repository</th>
                <th>Branch</th>
                <th>Ports</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const ports: number[] = JSON.parse(p.ports)
                const noPorts = ports.length === 0
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a
                        href={p.repo_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12 }}
                      >
                        {p.repo_url.replace('https://github.com/', '')}
                      </a>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{p.branch}</td>
                    <td>
                      {noPorts ? (
                        <span className="tag no-ports">No ports</span>
                      ) : (
                        ports.map((port) => (
                          <span key={port} className="tag" style={{ marginRight: 3 }}>:{port}</span>
                        ))
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '2px 8px', color: 'var(--status-error)' }}
                        onClick={() => handleDeleteProject(p.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
            No projects yet. Import from GitHub or add one manually below.
          </div>
        )}

      </div>

      <div className="divider" />

      {/* Sync from GitHub */}
      <div className="settings-section">
        <h3>Import from GitHub</h3>
        <p className="settings-section-desc">
          Fetch your repositories and add them as projects.
        </p>

        {!token ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Save a GitHub token above to enable sync.
          </div>
        ) : (
          <>
            <button
              className="btn btn-primary"
              onClick={handleSync}
              disabled={syncing}
              style={{ marginBottom: 12 }}
            >
              {syncing ? (
                <>
                  <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2, display: 'inline-block', marginRight: 6 }} />
                  Fetching repos…
                </>
              ) : 'Fetch Repositories'}
            </button>

            {syncError && <div className="error-banner" style={{ margin: '0 0 12px' }}>{syncError}</div>}

            {repos.length > 0 && (
              <>
                {unsyncedRepos.length === 0 ? (
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    All {repos.length} repos are already imported.
                  </div>
                ) : (
                  <div className="repo-sync-list">
                    {unsyncedRepos.map((repo) => (
                      <div key={repo.id} className="repo-item">
                        <div className="repo-info">
                          <div className="repo-name">{repo.name}</div>
                          <div className="repo-url">{repo.full_name}</div>
                        </div>
                        {repo.private && <span className="tag">private</span>}
                        <button
                          className="btn btn-primary"
                          style={{ padding: '4px 12px', fontSize: 12 }}
                          onClick={() => handleImportRepo(repo)}
                          disabled={importingId === repo.id}
                        >
                          {importingId === repo.id ? 'Adding…' : 'Add'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
