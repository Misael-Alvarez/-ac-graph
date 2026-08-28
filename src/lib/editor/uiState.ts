import type { Locale } from '@/lib/i18n/messages';
import { DEFAULT_VIEWPORT, type Viewport } from './viewport';
import type { BrandMode, ToolMode } from './types';

export interface ContextMenuTarget {
  /** Screen position where the menu opens. */
  x: number;
  y: number;
  /** What was right-clicked; absent means the canvas itself. */
  shapeId?: string;
  connectorId?: string;
  /** Canvas coordinates of the click, for actions that place something. */
  canvasX: number;
  canvasY: number;
}

export type ModalKind =
  'templates' | 'markdown' | 'shortcuts' | 'switchCloud' | 'ai' | 'share' | null;

export interface UiState {
  tool: ToolMode;
  selectedIds: Set<string>;
  selectedConnectorId: string | null;
  /** Set while the connector tool is waiting for its second click. */
  connectorSourceId: string | null;
  viewport: Viewport;
  gridSnap: boolean;
  dark: boolean;
  brand: BrandMode;
  locale: Locale;
  minimapOpen: boolean;
  paletteOpen: boolean;
  /** Split code/canvas view. */
  codeOpen: boolean;
  /** Version history panel. */
  versionsOpen: boolean;
  insightsOpen: boolean;
  /** Nodes the open comparison says are new or altered, for the canvas. */
  diffHighlight: { added: string[]; changed: string[] } | null;
  /**
   * Which view of the model is on screen. Null means the main one, which is
   * also what a diagram that was never split has.
   */
  activeViewId: string | null;
  /**
   * The shapes drilled through to get here, outermost first. Empty is the top.
   * Interface state, not content: where someone is looking is not part of the
   * architecture, and two people can be looking at different depths of one.
   */
  drillPath: string[];
  /** Service browser drawer. */
  browserOpen: boolean;
  inspectorPinned: boolean;
  modal: ModalKind;
  contextMenu: ContextMenuTarget | null;
  toast: string | null;
}

export const initialUiState: UiState = {
  tool: 'select',
  selectedIds: new Set(),
  selectedConnectorId: null,
  connectorSourceId: null,
  viewport: DEFAULT_VIEWPORT,
  gridSnap: true,
  // Dark by default: the chrome is meant to sit back behind the drawing.
  dark: true,
  brand: 'aion',
  locale: 'es',
  minimapOpen: true,
  paletteOpen: false,
  codeOpen: false,
  versionsOpen: false,
  insightsOpen: false,
  diffHighlight: null,
  activeViewId: null,
  drillPath: [],
  browserOpen: false,
  inspectorPinned: false,
  modal: null,
  contextMenu: null,
  toast: null,
};

export type UiAction =
  | { type: 'setTool'; tool: ToolMode }
  | { type: 'select'; ids: string[]; additive?: boolean }
  | { type: 'toggleSelected'; id: string }
  | { type: 'clearSelection' }
  | { type: 'selectConnector'; id: string | null }
  | { type: 'setConnectorSource'; id: string | null }
  | { type: 'setViewport'; viewport: Viewport }
  | { type: 'setActiveView'; id: string | null }
  | { type: 'drillInto'; id: string }
  | { type: 'drillUpTo'; depth: number }
  | { type: 'toggleGridSnap' }
  | { type: 'toggleDark' }
  | { type: 'setBrand'; brand: BrandMode }
  | { type: 'setLocale'; locale: Locale }
  | { type: 'toggleMinimap' }
  | { type: 'toggleCode' }
  | { type: 'toggleVersions' }
  | { type: 'toggleInsights' }
  | { type: 'setDiffHighlight'; highlight: UiState['diffHighlight'] }
  | { type: 'toggleBrowser' }
  | { type: 'setPaletteOpen'; open: boolean }
  | { type: 'toggleInspectorPinned' }
  | { type: 'setModal'; modal: ModalKind }
  | { type: 'openContextMenu'; target: ContextMenuTarget }
  | { type: 'closeContextMenu' }
  | { type: 'toast'; message: string | null };

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'setTool':
      // Changing tool always abandons a half-drawn connector.
      return { ...state, tool: action.tool, connectorSourceId: null };

    case 'select': {
      const ids = action.additive
        ? new Set([...state.selectedIds, ...action.ids])
        : new Set(action.ids);
      return { ...state, selectedIds: ids, selectedConnectorId: null };
    }

    case 'toggleSelected': {
      const ids = new Set(state.selectedIds);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ...state, selectedIds: ids, selectedConnectorId: null };
    }

    case 'clearSelection':
      return { ...state, selectedIds: new Set(), selectedConnectorId: null, contextMenu: null };

    case 'selectConnector':
      return { ...state, selectedConnectorId: action.id, selectedIds: new Set() };

    case 'setConnectorSource':
      return { ...state, connectorSourceId: action.id };

    case 'setViewport':
      return { ...state, viewport: action.viewport };

    case 'setActiveView':
      // The selection is dropped: the ids are still valid, but a shape the new
      // view does not show would stay selected and invisible, and the inspector
      // would keep editing something nobody can see.
      return {
        ...state,
        activeViewId: action.id,
        drillPath: [],
        selectedIds: new Set(),
        selectedConnectorId: null,
      };

    case 'drillInto':
      // Re-entering a shape already on the trail goes back to it rather than
      // stacking a second copy, so the breadcrumb can never repeat itself.
      return {
        ...state,
        drillPath: state.drillPath.includes(action.id)
          ? state.drillPath.slice(0, state.drillPath.indexOf(action.id) + 1)
          : [...state.drillPath, action.id],
        selectedIds: new Set(),
        selectedConnectorId: null,
      };

    case 'drillUpTo':
      return {
        ...state,
        drillPath: state.drillPath.slice(0, action.depth),
        selectedIds: new Set(),
        selectedConnectorId: null,
      };

    case 'toggleGridSnap':
      return { ...state, gridSnap: !state.gridSnap };

    case 'toggleDark':
      return { ...state, dark: !state.dark };

    case 'setBrand':
      return { ...state, brand: action.brand };

    case 'setLocale':
      return { ...state, locale: action.locale };

    case 'toggleMinimap':
      return { ...state, minimapOpen: !state.minimapOpen };

    case 'toggleCode':
      // The two side panels share the same column, so only one can be open.
      return { ...state, codeOpen: !state.codeOpen, versionsOpen: false, insightsOpen: false };

    case 'toggleVersions':
      return { ...state, versionsOpen: !state.versionsOpen, codeOpen: false, insightsOpen: false };

    // The three share one column, so opening one closes the others.
    case 'toggleInsights':
      return { ...state, insightsOpen: !state.insightsOpen, codeOpen: false, versionsOpen: false };

    case 'setDiffHighlight':
      return { ...state, diffHighlight: action.highlight };

    case 'toggleBrowser':
      return { ...state, browserOpen: !state.browserOpen };

    case 'setPaletteOpen':
      return { ...state, paletteOpen: action.open };

    case 'toggleInspectorPinned':
      return { ...state, inspectorPinned: !state.inspectorPinned };

    case 'setModal':
      return { ...state, modal: action.modal, contextMenu: null };

    case 'openContextMenu':
      return { ...state, contextMenu: action.target, paletteOpen: false };

    case 'closeContextMenu':
      return { ...state, contextMenu: null };

    case 'toast':
      return { ...state, toast: action.message };

    default:
      return state;
  }
}

/** Preferences worth remembering between sessions. */
export interface StoredPreferences {
  dark: boolean;
  gridSnap: boolean;
  brand: BrandMode;
  locale: Locale;
  minimapOpen: boolean;
  codeOpen: boolean;
  browserOpen: boolean;
}

export const PREFERENCES_KEY = 'aion-studio-preferences';

export function readPreferences(storage: Pick<Storage, 'getItem'>): Partial<StoredPreferences> {
  try {
    const raw = storage.getItem(PREFERENCES_KEY);
    return raw ? (JSON.parse(raw) as Partial<StoredPreferences>) : {};
  } catch {
    // Corrupt preferences must never stop the editor from opening.
    return {};
  }
}

export function toPreferences(state: UiState): StoredPreferences {
  return {
    dark: state.dark,
    gridSnap: state.gridSnap,
    brand: state.brand,
    locale: state.locale,
    minimapOpen: state.minimapOpen,
    codeOpen: state.codeOpen,
    browserOpen: state.browserOpen,
  };
}
