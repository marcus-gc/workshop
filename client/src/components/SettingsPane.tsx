import { useState, useEffect } from 'react'
import {
  listProjects,
  createProject,
  updateProject,
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
  const [editingPortsId, setEditingPortsId] = useState<string | null>(null)
  const [portInput, setPortInput] = useState('')
  const [portError, setPortError] = useState<string | null>(null)
  const [savingPorts, setSavingPorts] = useState(false)

  const [showAddForm, setShowAddForm] = useState(false)
  const [addRepoUrl, setAddRepoUrl] = useState('')
  const [addName, setAddName] = useState('')
  const [addNameTouched, setAddNameTouched] = useState(false)
  const [addBranch, setAddBranch] = useState('main')
  const [addSetupCmd, setAddSetupCmd] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

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

  async function handleAddPort(projectId: string, currentPorts: number[]) {
    const num = Number(portInput)
    if (!Number.isInteger(num) || num < 1 || num > 65535) {
      setPortError('Port must be an integer between 1 and 65535')
      return
    }
    if (currentPorts.includes(num)) {
      setPortError('Port already exists')
      return
    }
    setPortError(null)
    setSavingPorts(true)
    try {
      const updated = await updateProject(projectId, { ports: [...currentPorts, num] })
      setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)))
      setPortInput('')
    } catch (err: unknown) {
      setPortError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingPorts(false)
    }
  }

  async function handleRemovePort(projectId: string, currentPorts: number[], port: number) {
    setSavingPorts(true)
    setPortError(null)
    try {
      const updated = await updateProject(projectId, { ports: currentPorts.filter((p) => p !== port) })
      setProjects((prev) => prev.map((p) => (p.id === projectId ? updated : p)))
    } catch (err: unknown) {
      setPortError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingPorts(false)
    }
  }

  function handleAddRepoUrlChange(url: string) {
    setAddRepoUrl(url)
    if (!addNameTouched) {
      const match = url.match(/\/([^/]+?)(?:\.git)?$/)
      setAddName(match ? match[1] : '')
    }
  }

  async function handleAddProject() {
    setAddError(null)
    if (!addRepoUrl.trim()) {
      setAddError('Repository URL is required')
      return
    }
    if (!addName.trim()) {
      setAddError('Project name is required')
      return
    }
    setAdding(true)
    try {
      await createProject({
        name: addName.trim(),
        repo_url: addRepoUrl.trim(),
        branch: addBranch.trim() || 'main',
        github_token: token || undefined,
        setup_cmd: addSetupCmd.trim() || undefined,
        ports: [],
      })
      await refreshProjects()
      onProjectsChanged()
      setShowAddForm(false)
      setAddRepoUrl('')
      setAddName('')
      setAddNameTouched(false)
      setAddBranch('main')
      setAddSetupCmd('')
      setAddError(null)
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
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
                      {editingPortsId === p.id ? (
                        <div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
                            {ports.map((port) => (
                              <span key={port} className="tag" style={{ marginRight: 0 }}>
                                :{port}
                                <button
                                  className="tag-remove"
                                  onClick={() => handleRemovePort(p.id, ports, port)}
                                  disabled={savingPorts}
                                  title={`Remove port ${port}`}
                                >
                                  x
                                </button>
                              </span>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input
                              className="form-input"
                              type="number"
                              min={1}
                              max={65535}
                              value={portInput}
                              onChange={(e) => { setPortInput(e.target.value); setPortError(null) }}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleAddPort(p.id, ports) }}
                              placeholder="Port"
                              style={{ width: 80, padding: '3px 6px', fontSize: 11 }}
                              disabled={savingPorts}
                            />
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => handleAddPort(p.id, ports)}
                              disabled={savingPorts || !portInput}
                            >
                              Add
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: '2px 8px' }}
                              onClick={() => { setEditingPortsId(null); setPortInput(''); setPortError(null) }}
                            >
                              Done
                            </button>
                          </div>
                          {portError && (
                            <div style={{ color: 'var(--status-error)', fontSize: 11, marginTop: 4 }}>{portError}</div>
                          )}
                          <div style={{ color: 'var(--text-dimmed)', fontSize: 10, marginTop: 4 }}>
                            Changes apply to newly created craftsmen only.
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {noPorts ? (
                            <span className="tag no-ports">No ports</span>
                          ) : (
                            ports.map((port) => (
                              <span key={port} className="tag" style={{ marginRight: 0 }}>:{port}</span>
                            ))
                          )}
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 10, padding: '1px 6px', marginLeft: 2 }}
                            onClick={() => { setEditingPortsId(p.id); setPortInput(''); setPortError(null) }}
                          >
                            Edit
                          </button>
                        </div>
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

        {!showAddForm ? (
          <button
            className="btn btn-primary"
            style={{ marginBottom: 8 }}
            onClick={() => setShowAddForm(true)}
          >
            Add Project
          </button>
        ) : (
          <div style={{ marginBottom: 8, padding: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                className="form-input"
                type="text"
                value={addRepoUrl}
                onChange={(e) => handleAddRepoUrlChange(e.target.value)}
                placeholder="Repository URL (e.g. https://github.com/owner/repo.git)"
                disabled={adding}
              />
              <input
                className="form-input"
                type="text"
                value={addName}
                onChange={(e) => { setAddName(e.target.value); setAddNameTouched(true) }}
                placeholder="Project name"
                disabled={adding}
              />
              <input
                className="form-input"
                type="text"
                value={addBranch}
                onChange={(e) => setAddBranch(e.target.value)}
                placeholder="Branch (default: main)"
                disabled={adding}
              />
              <input
                className="form-input"
                type="text"
                value={addSetupCmd}
                onChange={(e) => setAddSetupCmd(e.target.value)}
                placeholder="Setup command (optional)"
                disabled={adding}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleAddProject}
                  disabled={adding}
                >
                  {adding ? 'Adding…' : 'Add'}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowAddForm(false)
                    setAddRepoUrl('')
                    setAddName('')
                    setAddNameTouched(false)
                    setAddBranch('main')
                    setAddSetupCmd('')
                    setAddError(null)
                  }}
                  disabled={adding}
                >
                  Cancel
                </button>
                {addError && (
                  <span style={{ color: 'var(--status-error)', fontSize: 12 }}>{addError}</span>
                )}
              </div>
            </div>
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
