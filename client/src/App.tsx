import { useState } from 'react'
import { useAppState, useAppDispatch } from './store/AppContext'
import { useCraftsmen } from './hooks/useCraftsmen'
import { useCraftsmanEvents } from './hooks/useCraftsmanEvents'
import Sidebar from './components/Sidebar'
import ConversationPane from './components/ConversationPane'
import SettingsPane from './components/SettingsPane'
import NewCraftsmanModal from './components/NewCraftsmanModal'

export default function App() {
  const state = useAppState()
  const dispatch = useAppDispatch()
  const [showNewModal, setShowNewModal] = useState(false)

  // Initial data load + 30s polling
  const refetch = useCraftsmen(dispatch)

  // Subscribe to status events for selected craftsman
  useCraftsmanEvents(state.selectedCraftsmanId, dispatch)

  return (
    <div className="app">
      <Sidebar
        craftsmen={state.craftsmen}
        projects={state.projects}
        selectedId={state.selectedCraftsmanId}
        onSelect={(id) => dispatch({ type: 'SELECT_CRAFTSMAN', id })}
        onNew={() => setShowNewModal(true)}
        onSettings={() => dispatch({ type: 'SET_VIEW', view: 'settings' })}
      />

      <main className="main-content">
        {state.view === 'settings' ? (
          <SettingsPane
            onBack={() => dispatch({ type: 'SET_VIEW', view: 'conversation' })}
            onProjectsChanged={refetch}
          />
        ) : state.selectedCraftsmanId ? (
          <ConversationPane craftsmanId={state.selectedCraftsmanId} />
        ) : (
          <div className="empty-state">
            <h2>Workshop</h2>
            <p>Select a craftsman or create a new one to get started.</p>
          </div>
        )}
      </main>

      {showNewModal && (
        <NewCraftsmanModal
          projects={state.projects}
          onClose={() => setShowNewModal(false)}
          onCreated={(craftsman) => {
            dispatch({ type: 'ADD_CRAFTSMAN', craftsman })
            dispatch({ type: 'SELECT_CRAFTSMAN', id: craftsman.id })
            setShowNewModal(false)
          }}
        />
      )}
    </div>
  )
}
