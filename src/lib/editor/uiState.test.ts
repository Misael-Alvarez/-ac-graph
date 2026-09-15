import { describe, expect, it } from 'vitest';
import {
  PREFERENCES_KEY,
  initialUiState,
  readPreferences,
  toPreferences,
  uiReducer,
  type UiState,
} from './uiState';

const ids = (s: UiState) => [...s.selectedIds].sort();

describe('selection', () => {
  it('replaces the selection by default', () => {
    let s = uiReducer(initialUiState, { type: 'select', ids: ['a', 'b'] });
    s = uiReducer(s, { type: 'select', ids: ['c'] });
    expect(ids(s)).toEqual(['c']);
  });

  it('adds to the selection when additive', () => {
    let s = uiReducer(initialUiState, { type: 'select', ids: ['a'] });
    s = uiReducer(s, { type: 'select', ids: ['b'], additive: true });
    expect(ids(s)).toEqual(['a', 'b']);
  });

  it('a lasso replaces, adds to or subtracts from the selection', () => {
    let s = uiReducer(initialUiState, { type: 'select', ids: ['a', 'b'] });
    s = uiReducer(s, { type: 'modifySelection', ids: ['b', 'c'], mode: 'add' });
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    s = uiReducer(s, { type: 'modifySelection', ids: ['a', 'zz'], mode: 'subtract' });
    expect(ids(s)).toEqual(['b', 'c']);
    s = uiReducer(s, { type: 'modifySelection', ids: ['d'], mode: 'replace' });
    expect(ids(s)).toEqual(['d']);
  });

  it('a lasso in any mode lets go of a selected connector', () => {
    let s = uiReducer(initialUiState, { type: 'selectConnector', id: 'c1' });
    s = uiReducer(s, { type: 'modifySelection', ids: ['a'], mode: 'add' });
    expect(s.selectedConnectorId).toBeNull();
    expect(ids(s)).toEqual(['a']);
  });

  it('toggles a single shape in and out', () => {
    let s = uiReducer(initialUiState, { type: 'toggleSelected', id: 'a' });
    expect(ids(s)).toEqual(['a']);
    s = uiReducer(s, { type: 'toggleSelected', id: 'a' });
    expect(ids(s)).toEqual([]);
  });

  it('clears shape selection when a connector is picked, and the reverse', () => {
    let s = uiReducer(initialUiState, { type: 'select', ids: ['a'] });
    s = uiReducer(s, { type: 'selectConnector', id: 'c1' });
    expect(ids(s)).toEqual([]);
    expect(s.selectedConnectorId).toBe('c1');

    s = uiReducer(s, { type: 'select', ids: ['b'] });
    expect(s.selectedConnectorId).toBeNull();
  });

  it('clears everything', () => {
    let s = uiReducer(initialUiState, { type: 'select', ids: ['a', 'b'] });
    s = uiReducer(s, { type: 'clearSelection' });
    expect(ids(s)).toEqual([]);
    expect(s.selectedConnectorId).toBeNull();
  });
});

describe('tools', () => {
  it('abandons a half-drawn connector when the tool changes', () => {
    let s = uiReducer(initialUiState, { type: 'setTool', tool: 'connector' });
    s = uiReducer(s, { type: 'setConnectorSource', id: 'a' });
    expect(s.connectorSourceId).toBe('a');

    s = uiReducer(s, { type: 'setTool', tool: 'select' });
    expect(s.connectorSourceId).toBeNull();
  });
});

describe('toggles', () => {
  it('flips the boolean preferences', () => {
    const dark = uiReducer(initialUiState, { type: 'toggleDark' });
    expect(dark.dark).toBe(!initialUiState.dark);
    expect(uiReducer(initialUiState, { type: 'toggleGridSnap' }).gridSnap).toBe(false);
    expect(uiReducer(initialUiState, { type: 'toggleMinimap' }).minimapOpen).toBe(false);
  });

  it('presenting starts a clean room and is never remembered', () => {
    const busy = {
      ...initialUiState,
      selectedIds: new Set(['a']),
      menu: 'export' as const,
      paletteOpen: true,
      findOpen: true,
      tool: 'group' as const,
    };
    const on = uiReducer(busy, { type: 'setPresenting', on: true });
    expect(on.presenting).toBe(true);
    expect(on.selectedIds.size).toBe(0);
    expect(on.menu).toBeNull();
    expect(on.paletteOpen).toBe(false);
    expect(on.findOpen).toBe(false);
    expect(on.tool).toBe('select');
    expect(uiReducer(on, { type: 'setPresenting', on: false }).presenting).toBe(false);
    expect('presenting' in toPreferences(on)).toBe(false);
  });

  it('the four side panels share one column', () => {
    const versions = uiReducer(initialUiState, { type: 'toggleVersions' });
    const comments = uiReducer(versions, { type: 'toggleComments' });
    expect(comments.commentsOpen).toBe(true);
    expect(comments.versionsOpen).toBe(false);
    const code = uiReducer(comments, { type: 'toggleCode' });
    expect(code.codeOpen).toBe(true);
    expect(code.commentsOpen).toBe(false);
    expect(uiReducer(code, { type: 'toggleInsights' }).codeOpen).toBe(false);
    expect('commentsOpen' in toPreferences(comments)).toBe(false);
  });

  it('opens the comments on a thread, or with a place to write, and forgets on close', () => {
    const draft = { shapeId: 'itm_1', x: 10, y: 20 };
    const withMenu = {
      ...initialUiState,
      insightsOpen: true,
      contextMenu: { x: 1, y: 2, canvasX: 3, canvasY: 4 },
    };
    const writing = uiReducer(withMenu, { type: 'openComments', draft });
    expect(writing.commentsOpen).toBe(true);
    expect(writing.insightsOpen).toBe(false);
    expect(writing.contextMenu).toBeNull();
    expect(writing.commentDraft).toEqual(draft);
    expect(writing.commentFocus).toBeNull();

    // A pin: the thread comes into focus, and a draft in progress stays.
    const focused = uiReducer(writing, { type: 'openComments', threadId: 'thr_1' });
    expect(focused.commentFocus).toBe('thr_1');
    expect(focused.commentDraft).toEqual(draft);
    expect(uiReducer(focused, { type: 'setCommentFocus', threadId: null }).commentFocus).toBeNull();
    expect(uiReducer(focused, { type: 'setCommentDraft', anchor: null }).commentDraft).toBeNull();

    const closed = uiReducer(focused, { type: 'toggleComments' });
    expect(closed.commentsOpen).toBe(false);
    expect(closed.commentDraft).toBeNull();
    expect(closed.commentFocus).toBeNull();
  });

  it('stores viewport, brand and locale', () => {
    const vp = { x: 10, y: 20, zoom: 1.5 };
    expect(uiReducer(initialUiState, { type: 'setViewport', viewport: vp }).viewport).toEqual(vp);
    expect(uiReducer(initialUiState, { type: 'setBrand', brand: 'none' }).brand).toBe('none');
    expect(uiReducer(initialUiState, { type: 'setLocale', locale: 'en' }).locale).toBe('en');
  });
});

describe('preferences', () => {
  it('extracts only the durable fields', () => {
    const prefs = toPreferences({ ...initialUiState, dark: true, tool: 'connector' });
    expect(prefs).toEqual({
      dark: true,
      accent: 'violet',
      gridSnap: true,
      brand: 'aion',
      exportTheme: 'editor',
      exportMeta: true,
      locale: 'es',
      minimapOpen: true,
      codeOpen: false,
      browserOpen: false,
    });
    expect('tool' in prefs).toBe(false);
  });

  it('reads what it wrote', () => {
    const stored = JSON.stringify(toPreferences({ ...initialUiState, locale: 'en' }));
    expect(readPreferences({ getItem: () => stored })).toMatchObject({ locale: 'en' });
  });

  it('falls back to empty preferences on corrupt or missing data', () => {
    expect(readPreferences({ getItem: () => '{oops' })).toEqual({});
    expect(readPreferences({ getItem: () => null })).toEqual({});
  });

  it('uses a stable storage key', () => {
    expect(PREFERENCES_KEY).toBe('aion-studio-preferences');
  });
});

describe('top bar menus', () => {
  it('opens one menu at a time and closes it when a modal or the palette opens', () => {
    let s = uiReducer(initialUiState, { type: 'setMenu', menu: 'export' });
    expect(s.menu).toBe('export');
    s = uiReducer(s, { type: 'setMenu', menu: 'account' });
    expect(s.menu).toBe('account');
    s = uiReducer(s, { type: 'setModal', modal: 'share' });
    expect(s.menu).toBeNull();
    s = uiReducer(s, { type: 'setMenu', menu: 'export' });
    s = uiReducer(s, { type: 'setPaletteOpen', open: true });
    expect(s.menu).toBeNull();
  });
});
