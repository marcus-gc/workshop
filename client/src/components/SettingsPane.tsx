import { useState, useEffect } from 'react'
import {
  listProjects,
  createProject,
  deleteProject,
  updateProject,
  validateGitHubToken,
  listGitHubRepos,
  getMcpServers,
  restartMcpBridges,
} from '../api'
import type { Project, GitHubRepo, McpServer } from '../types'

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
  const [portsInput, setPortsInput] = useState('')
  const [portsSaving, setPortsSaving] = useState(false)
  const [portsError, setPortsError] = useState<string | null>(null)
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpRestarting, setMcpRestarting] = useState(false)
  const [mcpError, setMcpError] = useState<string | null>(null)

  useEffect(() => {
    refreshProjects()
    refreshMcpServers()
    // Validate saved token on mount
    if (token) {
      validateGitHubToken(token)
        .then((u) => setTokenUser(u.login))
        .catch(() => setTokenUser(null))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshMcpServers() {
    setMcpLoading(true)
    setMcpError(null)
    try {
      const res = await getMcpServers()
      setMcpServers(res.servers)
    } catch (err: unknown) {
      setMcpError(err instanceof Error ? err.message : String(err))
    } finally {
      setMcpLoading(false)
    }
  }

  async function handleRestartMcp() {
    setMcpRestarting(true)
    setMcpError(null)
    try {
      const res = await restartMcpBridges()
      setMcpServers(res.servers)
    } catch (err: unknown) {
      setMcpError(err instanceof Error ? err.message : String(err))
    } finally {
      setMcpRestarting(false)
    }
  }

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

  function startEditingPorts(project: Project) {
    const ports: number[] = JSON.parse(project.ports)
    setEditingPortsId(project.id)
    setPortsInput(ports.join(', '))
    setPortsError(null)
  }

  async function handleSavePorts(projectId: string) {
    setPortsError(null)
    const parsed = portsInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number)

    if (parsed.some(isNaN)) {
      setPortsError('Invalid port numbers')
      return
    }

    setPortsSaving(true)
    try {
      await updateProject(projectId, { ports: parsed })
      await refreshProjects()
      onProjectsChanged()
      setEditingPortsId(null)
    } catch (err: unknown) {
      setPortsError(err instanceof Error ? err.message : String(err))
    } finally {
      setPortsSaving(false)
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

      {/* MCP Servers */}
      <div className="settings-section">
        <h3>MCP Servers</h3>
        <p className="settings-section-desc">
          MCP servers from your host machine are bridged into craftsman containers via SSE.
          Re-authenticate on your host, then resync to pick up new tokens.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            className="btn btn-primary"
            onClick={handleRestartMcp}
            disabled={mcpRestarting}
          >
            {mcpRestarting ? (
              <>
                <span className="spinner-inline" />
                Resyncing…
              </>
            ) : 'Resync MCP Auth'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={refreshMcpServers}
            disabled={mcpLoading}
          >
            Refresh
          </button>
        </div>

        {mcpError && <div className="error-banner" style={{ margin: '0 0 12px' }}>{mcpError}</div>}

        {mcpLoading && mcpServers.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</div>
        ) : mcpServers.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            No MCP servers found. Configure MCP servers in your host's <code>~/.claude.json</code> and rebuild Workshop.
          </div>
        ) : (
          <div className="mcp-server-list">
            {mcpServers.map((s) => (
              <div key={s.name} className="mcp-server-item">
                <div className="mcp-server-info">
                  <div className="mcp-server-name">
                    {s.name}
                    <span className={`mcp-status-dot ${s.status === 'running' ? 'running' : s.status === 'passthrough' ? 'passthrough' : 'error'}`} />
                  </div>
                  <div className="mcp-server-detail">
                    {s.type === 'bridge' ? (
                      <span className="tag" style={{ marginRight: 6 }}>bridge</span>
                    ) : (
                      <span className="tag" style={{ marginRight: 6 }}>passthrough</span>
                    )}
                    <span style={{ color: 'var(--text-dimmed)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {s.command || s.url}
                    </span>
                  </div>
                  {s.error && (
                    <div style={{ color: 'var(--status-error)', fontSize: 11, marginTop: 2 }}>{s.error}</div>
                  )}
                </div>
                <span className={`tag ${s.status === 'running' || s.status === 'passthrough' ? 'synced' : ''}`}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        )}
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
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            className="form-input"
                            style={{ width: 120, fontSize: 12, padding: '2px 6px' }}
                            value={portsInput}
                            onChange={(e) => setPortsInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSavePorts(p.id)
                              if (e.key === 'Escape') setEditingPortsId(null)
                            }}
                            onBlur={() => handleSavePorts(p.id)}
                            autoFocus
                            disabled={portsSaving}
                            placeholder="3000, 8080"
                          />
                          {portsError && <span style={{ color: 'var(--status-error)', fontSize: 11 }}>{portsError}</span>}
                        </span>
                      ) : (
                        <span
                          style={{ cursor: 'pointer' }}
                          onClick={() => startEditingPorts(p)}
                          title="Click to edit ports"
                        >
                          {noPorts ? (
                            <span className="tag no-ports">No ports</span>
                          ) : (
                            ports.map((port) => (
                              <span key={port} className="tag" style={{ marginRight: 3 }}>:{port}</span>
                            ))
                          )}
                        </span>
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
