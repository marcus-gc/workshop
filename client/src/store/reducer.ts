import type { Craftsman, Project, StatsResult } from '../types';

export type Tab = 'terminal' | 'logs' | 'preview';
export type View = 'conversation' | 'settings';

export interface CraftsmanUiState {
  activeTab: Tab;
  logLines: string[];
  stats: StatsResult | null;
}

export interface AppState {
  craftsmen: Craftsman[];
  selectedCraftsmanId: string | null;
  projects: Project[];
  view: View;
  craftsmanUi: Record<string, CraftsmanUiState>;
}

export const initialUiState = (): CraftsmanUiState => ({
  activeTab: 'terminal',
  logLines: [],
  stats: null,
});

export const initialState: AppState = {
  craftsmen: [],
  selectedCraftsmanId: null,
  projects: [],
  view: 'conversation',
  craftsmanUi: {},
};

export type Action =
  | { type: 'SET_CRAFTSMEN'; craftsmen: Craftsman[] }
  | { type: 'SET_PROJECTS'; projects: Project[] }
  | { type: 'SELECT_CRAFTSMAN'; id: string | null }
  | { type: 'SET_VIEW'; view: View }
  | { type: 'UPDATE_CRAFTSMAN_STATUS'; id: string; status: Craftsman['status']; error_message?: string | null }
  | { type: 'ADD_CRAFTSMAN'; craftsman: Craftsman }
  | { type: 'REMOVE_CRAFTSMAN'; id: string }
  | { type: 'APPEND_LOG'; craftsmanId: string; line: string }
  | { type: 'CLEAR_LOGS'; craftsmanId: string }
  | { type: 'SET_ACTIVE_TAB'; craftsmanId: string; tab: Tab }
  | { type: 'SET_STATS'; craftsmanId: string; stats: StatsResult };

function ensureUi(
  state: AppState,
  craftsmanId: string
): Record<string, CraftsmanUiState> {
  if (state.craftsmanUi[craftsmanId]) return state.craftsmanUi;
  return { ...state.craftsmanUi, [craftsmanId]: initialUiState() };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_CRAFTSMEN': {
      // Preserve existing UI state for craftsmen we already know about
      const newUi = { ...state.craftsmanUi };
      for (const c of action.craftsmen) {
        if (!newUi[c.id]) newUi[c.id] = initialUiState();
      }
      return { ...state, craftsmen: action.craftsmen, craftsmanUi: newUi };
    }

    case 'SET_PROJECTS':
      return { ...state, projects: action.projects };

    case 'SELECT_CRAFTSMAN': {
      const ui = action.id ? ensureUi(state, action.id) : state.craftsmanUi;
      return { ...state, selectedCraftsmanId: action.id, craftsmanUi: ui };
    }

    case 'SET_VIEW':
      return { ...state, view: action.view };

    case 'UPDATE_CRAFTSMAN_STATUS':
      return {
        ...state,
        craftsmen: state.craftsmen.map((c) =>
          c.id === action.id
            ? { ...c, status: action.status, error_message: action.error_message ?? c.error_message }
            : c
        ),
      };

    case 'ADD_CRAFTSMAN': {
      const ui = ensureUi({ ...state, craftsmanUi: { ...state.craftsmanUi, [action.craftsman.id]: initialUiState() } }, action.craftsman.id);
      return {
        ...state,
        craftsmen: [...state.craftsmen, action.craftsman],
        craftsmanUi: ui,
      };
    }

    case 'REMOVE_CRAFTSMAN': {
      const newUi = { ...state.craftsmanUi };
      delete newUi[action.id];
      return {
        ...state,
        craftsmen: state.craftsmen.filter((c) => c.id !== action.id),
        selectedCraftsmanId:
          state.selectedCraftsmanId === action.id ? null : state.selectedCraftsmanId,
        craftsmanUi: newUi,
      };
    }

    case 'APPEND_LOG': {
      const ui = ensureUi(state, action.craftsmanId);
      const existing = ui[action.craftsmanId];
      return {
        ...state,
        craftsmanUi: {
          ...ui,
          [action.craftsmanId]: {
            ...existing,
            logLines: [...existing.logLines, action.line],
          },
        },
      };
    }

    case 'CLEAR_LOGS': {
      const ui = ensureUi(state, action.craftsmanId);
      return {
        ...state,
        craftsmanUi: {
          ...ui,
          [action.craftsmanId]: { ...ui[action.craftsmanId], logLines: [] },
        },
      };
    }

    case 'SET_ACTIVE_TAB': {
      const ui = ensureUi(state, action.craftsmanId);
      return {
        ...state,
        craftsmanUi: {
          ...ui,
          [action.craftsmanId]: { ...ui[action.craftsmanId], activeTab: action.tab },
        },
      };
    }

    case 'SET_STATS': {
      const ui = ensureUi(state, action.craftsmanId);
      return {
        ...state,
        craftsmanUi: {
          ...ui,
          [action.craftsmanId]: { ...ui[action.craftsmanId], stats: action.stats },
        },
      };
    }

    default:
      return state;
  }
}
