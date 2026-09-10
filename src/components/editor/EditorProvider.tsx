'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import type { DiagramModel, Shape, View } from '@/lib/domain';
import { checkCollisions, focusSubtree, getView, resolveView, viewsOf } from '@/lib/engine';
import { canRedo, canUndo, docReducer, initialDocState, type DocState } from '@/lib/editor/reducer';
import type { EditorAction } from '@/lib/editor/actions';
import {
  ACCENTS,
  initialUiState,
  readPreferences,
  toPreferences,
  uiReducer,
  PREFERENCES_KEY,
  type UiAction,
  type UiState,
} from '@/lib/editor/uiState';
import { translate, type MessageKey } from '@/lib/i18n/messages';

interface EditorContextValue {
  doc: DocState;
  ui: UiState;
  /**
   * The active view, already resolved into an ordinary model.
   *
   * Anything that draws or exports reads this; anything that reasons about the
   * architecture — analysis, diff, the AI's review — reads `doc.model`. A view
   * is a reading, and a reading is not the truth: telling someone their
   * architecture has no single point of failure because they happened to be
   * looking at a view that hides it would be worse than saying nothing.
   */
  view: DiagramModel;
  views: View[];
  activeView: View;
  dispatch: (action: EditorAction) => void;
  dispatchUi: (action: UiAction) => void;
  /** Shapes that overlap something unrelated, recomputed only when the model changes. */
  collisions: Set<string>;
  /** The single selected shape, or null when zero or several are selected. */
  selectedShape: Shape | null;
  canUndo: boolean;
  canRedo: boolean;
  /** The document's title, for file names and the top bar. */
  title: string;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used inside <EditorProvider>');
  return ctx;
}

export function EditorProvider({
  initialModel,
  title = '',
  children,
}: {
  initialModel: DiagramModel;
  title?: string;
  children: ReactNode;
}) {
  const [doc, dispatch] = useReducer(docReducer, initialModel, initialDocState);
  const [ui, dispatchUi] = useReducer(uiReducer, initialUiState);

  // Preferences are read after mount so the server and client render the same
  // markup; reading localStorage during render would cause a hydration mismatch.
  useEffect(() => {
    const stored = readPreferences(window.localStorage);
    if (stored.dark !== undefined && stored.dark !== initialUiState.dark) {
      dispatchUi({ type: 'toggleDark' });
    }
    if (stored.gridSnap !== undefined && stored.gridSnap !== initialUiState.gridSnap) {
      dispatchUi({ type: 'toggleGridSnap' });
    }
    if (stored.minimapOpen !== undefined && stored.minimapOpen !== initialUiState.minimapOpen) {
      dispatchUi({ type: 'toggleMinimap' });
    }
    if (stored.codeOpen !== undefined && stored.codeOpen !== initialUiState.codeOpen) {
      dispatchUi({ type: 'toggleCode' });
    }
    if (stored.brand) dispatchUi({ type: 'setBrand', brand: stored.brand });
    if (stored.accent && ACCENTS.includes(stored.accent)) {
      dispatchUi({ type: 'setAccent', accent: stored.accent });
    }
    if (stored.locale) dispatchUi({ type: 'setLocale', locale: stored.locale });
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(toPreferences(ui)));
    } catch {
      // Private browsing or a full quota must not break the editor.
    }
  }, [ui]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', ui.dark);
  }, [ui.dark]);

  useEffect(() => {
    document.documentElement.dataset.accent = ui.accent;
  }, [ui.accent]);

  useEffect(() => {
    if (!ui.toast) return;
    const timer = setTimeout(() => dispatchUi({ type: 'toast', message: null }), 4000);
    return () => clearTimeout(timer);
  }, [ui.toast]);

  const collisions = useMemo(() => checkCollisions(doc.model), [doc.model]);

  const views = useMemo(() => viewsOf(doc.model), [doc.model]);
  const activeView = useMemo(
    () => getView(doc.model, ui.activeViewId),
    [doc.model, ui.activeViewId],
  );
  // Memoised because an unsplit diagram resolves to the very same object, which
  // is what keeps the canvas re-rendering exactly as often as it did before.
  const view = useMemo(
    // Two narrowings of the same kind, composed: which services this reading
    // shows, and then how deep into them the reader has walked.
    () => focusSubtree(resolveView(doc.model, ui.activeViewId), ui.drillPath),
    [doc.model, ui.activeViewId, ui.drillPath],
  );

  // A view the model no longer has — deleted here, or gone after an undo —
  // would otherwise leave the interface pointing at nothing.
  useEffect(() => {
    if (ui.activeViewId && !doc.model.views.some((v) => v.id === ui.activeViewId)) {
      dispatchUi({ type: 'setActiveView', id: null });
    }
  }, [doc.model.views, ui.activeViewId]);

  // Likewise for a shape drilled into and then deleted: the trail would keep
  // pointing at it and the canvas would show the whole model with no way back.
  useEffect(() => {
    const depth = ui.drillPath.findIndex((id) => !doc.model.shapes.some((s) => s.id === id));
    if (depth !== -1) dispatchUi({ type: 'drillUpTo', depth });
  }, [doc.model.shapes, ui.drillPath]);

  const selectedShape = useMemo(() => {
    if (ui.selectedIds.size !== 1) return null;
    const [id] = ui.selectedIds;
    return doc.model.shapes.find((s) => s.id === id) ?? null;
  }, [ui.selectedIds, doc.model]);

  const t = useCallback(
    (key: MessageKey, values?: Record<string, string | number>) =>
      translate(ui.locale, key, values),
    [ui.locale],
  );

  const value = useMemo<EditorContextValue>(
    () => ({
      doc,
      ui,
      view,
      views,
      activeView,
      dispatch,
      dispatchUi,
      collisions,
      selectedShape,
      canUndo: canUndo(doc),
      canRedo: canRedo(doc),
      title,
      t,
    }),
    [doc, ui, view, views, activeView, collisions, selectedShape, title, t],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
