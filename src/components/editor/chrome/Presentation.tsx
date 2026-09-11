'use client';

import { useCallback, useEffect, useRef } from 'react';
import { MAIN_VIEW_ID, contentBBox, resolveView } from '@/lib/engine';
import { canvasTheme } from '@/lib/design/tokens';
import { legendFor, strokeFor, toneColors } from '@/lib/editor/meta';
import { fitToBox, type Viewport } from '@/lib/editor/viewport';
import { CloseIcon } from '@/components/icons/ToolIcons';
import { Kbd } from '@/components/ui/Kbd';
import { useEditor } from '../EditorProvider';

/** A slide is framed with room to breathe, and never blown up past this. */
const SLIDE_PADDING = 72;
const SLIDE_MAX_ZOOM = 1.6;

/**
 * The presentation layer over the canvas.
 *
 * With the chrome gone, this is all that is left besides the drawing: the
 * document's name and which reading is on screen, the way from one view to
 * the next, a legend of the marks the current view uses, and the way out. The
 * camera frames each view as it comes up, and returns to where it was when the
 * presentation ends — a talk should not move the author's viewport.
 */
export function Presentation() {
  const { doc, ui, view, views, activeView, dispatchUi, title, t } = useEditor();
  const theme = canvasTheme(ui.dark);
  const legend = legendFor(view);

  const index = Math.max(
    0,
    views.findIndex((v) => v.id === activeView.id),
  );
  const total = views.length;

  const canvasSize = () => {
    const rect = document.querySelector('.canvas-surface')?.getBoundingClientRect();
    return { width: rect?.width ?? 1200, height: rect?.height ?? 800 };
  };

  const frame = useCallback(
    (viewId: string | null, smooth: boolean) => {
      const reading = resolveView(doc.model, viewId);
      dispatchUi({
        type: 'setViewport',
        viewport: fitToBox(contentBBox(reading), canvasSize(), SLIDE_PADDING, {}, SLIDE_MAX_ZOOM),
        smooth,
      });
    },
    [doc.model, dispatchUi],
  );

  const go = useCallback(
    (next: number) => {
      const target = views[Math.min(total - 1, Math.max(0, next))];
      if (!target) return;
      const id = target.id === MAIN_VIEW_ID ? null : target.id;
      dispatchUi({ type: 'setActiveView', id });
      frame(id, true);
    },
    [views, total, dispatchUi, frame],
  );

  // Frame the opening view once the chrome has gone and the canvas has grown;
  // remember the camera so the exit can give it back.
  const returnTo = useRef<Viewport | null>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    returnTo.current = ui.viewport;
    const raf = requestAnimationFrame(() =>
      frame(activeView.id === MAIN_VIEW_ID ? null : activeView.id, true),
    );
    return () => cancelAnimationFrame(raf);
    // Intentionally once: the opening frame, not every camera change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () => () => {
      const back = returnTo.current;
      if (back) dispatchUi({ type: 'setViewport', viewport: back, smooth: true });
    },
    [dispatchUi],
  );

  // Arrow keys walk the views. Captured, so nothing underneath sees them.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const forward = ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key);
      const backward = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key);
      if (!forward && !backward && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Home') go(0);
      else if (event.key === 'End') go(total - 1);
      else go(index + (forward ? 1 : -1));
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [go, index, total]);

  const exit = () => dispatchUi({ type: 'setPresenting', on: false });

  return (
    <div className="presentation" data-tooltip-side="top">
      <header className="presentation-head">
        <p className="presentation-title">
          <b>{title || t('app.untitled')}</b>
          {total > 1 && <span>{activeView.name || t('view.main')}</span>}
        </p>
        <button
          type="button"
          className="icon-button presentation-exit"
          title={`${t('present.exit')} · Esc`}
          aria-label={t('present.exit')}
          onClick={exit}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      {total > 1 && (
        <nav className="presentation-nav" aria-label={t('view.bar')}>
          <button
            type="button"
            className="icon-button"
            aria-label={t('present.previous')}
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            ‹
          </button>
          <span className="presentation-counter" aria-live="polite">
            {t('present.counter', { index: index + 1, total })}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('present.next')}
            disabled={index === total - 1}
            onClick={() => go(index + 1)}
          >
            ›
          </button>
        </nav>
      )}

      {(legend.badges.length > 0 || legend.kinds.length > 1) && (
        <aside className="presentation-legend" aria-label={t('present.legend')}>
          {legend.badges.length > 0 && (
            <ul className="presentation-legend-row">
              {legend.badges.map((badge) => {
                const colors = toneColors(badge.tone, theme.itemFill, theme);
                return (
                  <li
                    key={`${badge.kind}:${badge.text}`}
                    className="presentation-chip"
                    style={{
                      background: colors.fill,
                      color: colors.text,
                      borderColor: colors.stroke,
                    }}
                    title={t(`inspector.${badge.kind}` as 'inspector.environment')}
                  >
                    {badge.text}
                  </li>
                );
              })}
            </ul>
          )}
          {legend.kinds.length > 1 && (
            <ul className="presentation-legend-row">
              {legend.kinds.map((kind) => {
                const stroke = strokeFor({ style: 'solid', meta: { kind } });
                return (
                  <li key={kind} className="presentation-kind">
                    <svg viewBox="0 0 40 8" width="40" height="8" aria-hidden="true">
                      <line
                        x1="1"
                        y1="4"
                        x2="39"
                        y2="4"
                        stroke={theme.connector}
                        strokeWidth={stroke.width}
                        strokeDasharray={stroke.dasharray}
                        strokeLinecap="round"
                      />
                    </svg>
                    {kind}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      )}

      <p className="presentation-hint">
        {total > 1 && (
          <>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
            <span>{t('present.hintMove')}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <Kbd>Esc</Kbd>
        <span>{t('present.hintExit')}</span>
      </p>
    </div>
  );
}
