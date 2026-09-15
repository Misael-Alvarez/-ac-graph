import type { CommentAnchor } from '@/lib/domain';
import type { Locale } from '@/lib/i18n/messages';
import { DEFAULT_VIEWPORT, type Viewport } from './viewport';
import type { BrandMode, ExportTheme, ToolMode } from './types';

/**
 * The interface's tone: which colour every accent, selection and focus ring
 * takes. Violet is AION's; the others are for readers who live in the tool
 * all day and want it in their own key. The brand mark keeps its gradient.
 */
export const ACCENTS = ['violet', 'indigo', 'graphite', 'ocean', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

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
  'templates' | 'markdown' | 'shortcuts' | 'switchCloud' | 'ai' | 'share' | 'icons' | null;

/** The top bar menus. One open at a time; opening another closes the first. */
export type MenuKind = 'export' | 'account' | 'more' | null;

export interface UiState {
  tool: ToolMode;
  selectedIds: Set<string>;
  selectedConnectorId: string | null;
  /** Set while the connector tool is waiting for its second click. */
  connectorSourceId: string | null;
  viewport: Viewport;
  /** Whether the last viewport change should be animated on screen. */
  viewportSmooth: boolean;
  gridSnap: boolean;
  /**
   * The theme as chosen: the system's, or one of the two by name. `dark` is
   * what that resolves to right now, and is what everything that draws reads.
   */
  theme: ThemeMode;
  dark: boolean;
  accent: Accent;
  brand: BrandMode;
  /** Exports: which theme to draw on, and whether metadata chips travel along. */
  exportTheme: ExportTheme;
  exportMeta: boolean;
  locale: Locale;
  minimapOpen: boolean;
  paletteOpen: boolean;
  /** The find bar over the canvas (⌘F). */
  findOpen: boolean;
  /** Split code/canvas view. */
  codeOpen: boolean;
  /**
   * Presenting: no chrome, the canvas full-bleed, arrow keys walk the views.
   * Never stored — a reload lands back in the editor.
   */
  presenting: boolean;
  /** Version history panel. */
  versionsOpen: boolean;
  insightsOpen: boolean;
  /** The conversations panel; shares the column with the three above. */
  commentsOpen: boolean;
  /**
   * Where the next comment will be pinned, chosen from the context menu: a
   * shape or a point on the sheet. Null means "whatever is selected".
   */
  commentDraft: CommentAnchor | null;
  /** The thread the panel should scroll to and light up, after a pin was pressed. */
  commentFocus: string | null;
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
  menu: MenuKind;
  contextMenu: ContextMenuTarget | null;
  toast: string | null;
}

export const initialUiState: UiState = {
  tool: 'select',
  selectedIds: new Set(),
  selectedConnectorId: null,
  connectorSourceId: null,
  viewport: DEFAULT_VIEWPORT,
  viewportSmooth: false,
  gridSnap: true,
  // The system's theme unless the reader picks one; dark until the system has
  // been asked, which happens on mount — the markup ships dark for that reason.
  theme: 'system',
  dark: true,
  accent: 'violet',
  brand: 'aion',
  exportTheme: 'editor',
  exportMeta: true,
  locale: 'es',
  minimapOpen: true,
  paletteOpen: false,
  findOpen: false,
  codeOpen: false,
  presenting: false,
  versionsOpen: false,
  insightsOpen: false,
  commentsOpen: false,
  commentDraft: null,
  commentFocus: null,
  diffHighlight: null,
  activeViewId: null,
  drillPath: [],
  browserOpen: false,
  inspectorPinned: false,
  modal: null,
  menu: null,
  contextMenu: null,
  toast: null,
};

/**
 * What a lasso does to the selection: `replace` it, as a plain drag does;
 * `add` to it with Shift held; `subtract` from it with Alt held.
 */
export type SelectionMode = 'replace' | 'add' | 'subtract';

export type UiAction =
  | { type: 'setTool'; tool: ToolMode }
  | { type: 'select'; ids: string[]; additive?: boolean }
  | { type: 'modifySelection'; ids: string[]; mode: SelectionMode }
  | { type: 'toggleSelected'; id: string }
  | { type: 'clearSelection' }
  | { type: 'selectConnector'; id: string | null }
  | { type: 'setConnectorSource'; id: string | null }
  /** `smooth` asks the canvas to glide there rather than jump: fit, reset, drill. */
  | { type: 'setViewport'; viewport: Viewport; smooth?: boolean }
  | { type: 'setActiveView'; id: string | null }
  | { type: 'drillInto'; id: string }
  | { type: 'drillUpTo'; depth: number }
  | { type: 'toggleGridSnap' }
  /** Flips between light and dark by name — a choice, so the system's no longer applies. */
  | { type: 'toggleDark' }
  /** `systemDark` is what the system says right now, for a return to `system` to take effect at once. */
  | { type: 'setTheme'; theme: ThemeMode; systemDark?: boolean }
  /** What the operating system prefers right now; honoured only while `theme` is `system`. */
  | { type: 'setSystemDark'; dark: boolean }
  | { type: 'setAccent'; accent: Accent }
  | { type: 'setBrand'; brand: BrandMode }
  | { type: 'setExportTheme'; theme: ExportTheme }
  | { type: 'toggleExportMeta' }
  | { type: 'setPresenting'; on: boolean }
  | { type: 'setLocale'; locale: Locale }
  | { type: 'toggleMinimap' }
  | { type: 'toggleCode' }
  | { type: 'toggleVersions' }
  | { type: 'toggleInsights' }
  | { type: 'toggleComments' }
  /** Opens the panel — on a thread, or with a comment ready to write somewhere. */
  | { type: 'openComments'; threadId?: string; draft?: CommentAnchor }
  | { type: 'setCommentDraft'; anchor: CommentAnchor | null }
  | { type: 'setCommentFocus'; threadId: string | null }
  | { type: 'setDiffHighlight'; highlight: UiState['diffHighlight'] }
  | { type: 'toggleBrowser' }
  | { type: 'setPaletteOpen'; open: boolean }
  | { type: 'setFindOpen'; open: boolean }
  | { type: 'toggleInspectorPinned' }
  | { type: 'setModal'; modal: ModalKind }
  | { type: 'setMenu'; menu: MenuKind }
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

    case 'modifySelection': {
      const ids = new Set(action.mode === 'replace' ? [] : state.selectedIds);
      for (const id of action.ids) {
        if (action.mode === 'subtract') ids.delete(id);
        else ids.add(id);
      }
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
      return { ...state, viewport: action.viewport, viewportSmooth: action.smooth === true };

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
      return { ...state, theme: state.dark ? 'light' : 'dark', dark: !state.dark };

    case 'setTheme':
      return {
        ...state,
        theme: action.theme,
        dark: resolveDark(action.theme, action.systemDark ?? state.dark),
      };

    case 'setSystemDark':
      return state.theme === 'system' && state.dark !== action.dark
        ? { ...state, dark: action.dark }
        : state;

    case 'setAccent':
      return { ...state, accent: action.accent };

    case 'setBrand':
      return { ...state, brand: action.brand };

    case 'setExportTheme':
      return { ...state, exportTheme: action.theme };

    case 'toggleExportMeta':
      return { ...state, exportMeta: !state.exportMeta };

    case 'setPresenting':
      // Whatever was open or selected belongs to editing; the room starts clean.
      return {
        ...state,
        presenting: action.on,
        menu: null,
        contextMenu: null,
        paletteOpen: false,
        findOpen: false,
        selectedIds: new Set(),
        selectedConnectorId: null,
        connectorSourceId: null,
        tool: 'select',
      };

    case 'setLocale':
      return { ...state, locale: action.locale };

    case 'toggleMinimap':
      return { ...state, minimapOpen: !state.minimapOpen };

    // The four side panels share one column, so opening one closes the others.
    case 'toggleCode':
      return {
        ...state,
        codeOpen: !state.codeOpen,
        versionsOpen: false,
        insightsOpen: false,
        commentsOpen: false,
      };

    case 'toggleVersions':
      return {
        ...state,
        versionsOpen: !state.versionsOpen,
        codeOpen: false,
        insightsOpen: false,
        commentsOpen: false,
      };

    case 'toggleInsights':
      return {
        ...state,
        insightsOpen: !state.insightsOpen,
        codeOpen: false,
        versionsOpen: false,
        commentsOpen: false,
      };

    case 'toggleComments':
      return {
        ...state,
        commentsOpen: !state.commentsOpen,
        codeOpen: false,
        versionsOpen: false,
        insightsOpen: false,
        // Closing the panel drops what was about to be written there.
        commentDraft: state.commentsOpen ? null : state.commentDraft,
        commentFocus: null,
      };

    case 'openComments':
      return {
        ...state,
        commentsOpen: true,
        codeOpen: false,
        versionsOpen: false,
        insightsOpen: false,
        contextMenu: null,
        commentDraft: action.draft ?? state.commentDraft,
        commentFocus: action.threadId ?? null,
      };

    case 'setCommentDraft':
      return { ...state, commentDraft: action.anchor };

    case 'setCommentFocus':
      return { ...state, commentFocus: action.threadId };

    case 'setDiffHighlight':
      return { ...state, diffHighlight: action.highlight };

    case 'toggleBrowser':
      return { ...state, browserOpen: !state.browserOpen };

    case 'setPaletteOpen':
      return { ...state, paletteOpen: action.open, menu: action.open ? null : state.menu };

    case 'setFindOpen':
      return { ...state, findOpen: action.open };

    case 'toggleInspectorPinned':
      return { ...state, inspectorPinned: !state.inspectorPinned };

    case 'setModal':
      return { ...state, modal: action.modal, contextMenu: null, menu: null };

    case 'setMenu':
      return { ...state, menu: action.menu, contextMenu: null };

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

/** The theme as a choice. `system` follows the operating system, live. */
export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

/** What `theme` says on screen given what the system prefers. */
export function resolveDark(theme: ThemeMode, systemDark: boolean): boolean {
  return theme === 'system' ? systemDark : theme === 'dark';
}

/** Preferences worth remembering between sessions. */
export interface StoredPreferences {
  theme: ThemeMode;
  accent: Accent;
  gridSnap: boolean;
  brand: BrandMode;
  exportTheme: ExportTheme;
  exportMeta: boolean;
  locale: Locale;
  minimapOpen: boolean;
  codeOpen: boolean;
  browserOpen: boolean;
}

export const PREFERENCES_KEY = 'aion-studio-preferences';

/** What older builds wrote: one boolean, dark being the default nobody chose. */
export type StoredPreferencesOnDisk = Partial<StoredPreferences> & { dark?: boolean };

export function readPreferences(storage: Pick<Storage, 'getItem'>): StoredPreferencesOnDisk {
  try {
    const raw = storage.getItem(PREFERENCES_KEY);
    return raw ? (JSON.parse(raw) as StoredPreferencesOnDisk) : {};
  } catch {
    // Corrupt preferences must never stop the editor from opening.
    return {};
  }
}

/**
 * The theme a stored preference means. A `theme` written by this build is
 * taken as is. Before it, one boolean was written on every change, dark by
 * default: `false` was a choice (light), `true` almost never was — so `true`
 * and nothing at all both mean "the system's".
 */
export function storedTheme(prefs: StoredPreferencesOnDisk): ThemeMode {
  if (prefs.theme && THEME_MODES.includes(prefs.theme)) return prefs.theme;
  return prefs.dark === false ? 'light' : 'system';
}

export function toPreferences(state: UiState): StoredPreferences {
  return {
    theme: state.theme,
    accent: state.accent,
    gridSnap: state.gridSnap,
    brand: state.brand,
    exportTheme: state.exportTheme,
    exportMeta: state.exportMeta,
    locale: state.locale,
    minimapOpen: state.minimapOpen,
    codeOpen: state.codeOpen,
    browserOpen: state.browserOpen,
  };
}
