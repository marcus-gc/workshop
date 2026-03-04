import type { Craftsman, Project } from '../types'

interface Props {
  craftsmen: Craftsman[]
  projects: Project[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onNewTask: () => void
  onSettings: () => void
}

function getProjectName(projects: Project[], projectId: string): string {
  return projects.find((p) => p.id === projectId)?.name ?? '…'
}

export default function Sidebar({ craftsmen, projects, selectedId, onSelect, onNew, onNewTask, onSettings }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          Work<span>shop</span>
        </div>
        <button
          className="icon-btn"
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
          </svg>
        </button>
      </div>

      <div className="sidebar-actions">
        <button className="btn-new" onClick={onNew}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New Craftsman
        </button>
        <button className="btn-new" onClick={onNewTask}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New Task
        </button>
      </div>

      <div className="craftsmen-list">
        {craftsmen.length === 0 ? (
          <div style={{ padding: '20px 10px', fontSize: 12, color: 'var(--text-dimmed)', textAlign: 'center' }}>
            No craftsmen yet
          </div>
        ) : (
          craftsmen.map((c) => (
            <CraftsmanItem
              key={c.id}
              craftsman={c}
              projectName={getProjectName(projects, c.project_id)}
              selected={c.id === selectedId}
              onClick={() => onSelect(c.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function CraftsmanItem({
  craftsman,
  projectName,
  selected,
  onClick,
}: {
  craftsman: Craftsman
  projectName: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <div
      className={`craftsman-item${selected ? ' selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <span className={`status-dot ${craftsman.status}`} title={craftsman.status} />
      <div className="craftsman-info">
        <div className="craftsman-name">{craftsman.name}</div>
        <div className="craftsman-project">{projectName}</div>
        {craftsman.task && (
          <div className="craftsman-task" style={{ fontSize: 11, color: 'var(--text-dimmed)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {craftsman.task.length > 60 ? craftsman.task.slice(0, 60) + '…' : craftsman.task}
          </div>
        )}
      </div>
    </div>
  )
}
