'use client';

import { useEffect, useRef, useState } from 'react';
import { MAIN_VIEW_ID } from '@/lib/engine';
import { useEditor } from '../EditorProvider';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';
import { CloseIcon, PlusIcon } from '@/components/icons/ToolIcons';

/**
 * Switching between readings of one architecture.
 *
 * A chip row rather than a dropdown: the whole point of views is that a reader
 * can see there *are* others and move between them, which a closed menu hides.
 * It speaks the same `.chip` vocabulary as the service browser and the palette,
 * so this is one more surface in the language rather than a new look.
 *
 * The bar stays hidden until a diagram has a second view. A single-view diagram
 * has nothing to switch between, and a control offering one choice is furniture.
 */
export function ViewBar() {
  const { doc, ui, views, activeView, dispatch, dispatchUi, t } = useEditor();
  const liquid = useLiquidPointer();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  // The interface names the main view; the model does not, because a name in the
  // model would be a name in one language, and this app has two.
  const nameOf = (id: string, name: string) => (id === MAIN_VIEW_ID ? t('view.main') : name);

  const commit = () => {
    const name = draft.trim();
    if (name) dispatch({ type: 'addView', name, from: null });
    setDraft('');
    setAdding(false);
  };

  // The reducer reports the id it minted; selecting it here rather than in the
  // reducer keeps which view someone is looking at out of the saved document.
  useEffect(() => {
    if (doc.lastCreatedViewId) dispatchUi({ type: 'setActiveView', id: doc.lastCreatedViewId });
  }, [doc.lastCreatedViewId, dispatchUi]);

  if (views.length < 2 && !adding) {
    return (
      <div className="view-bar" onPointerMove={liquid}>
        <button type="button" className="chip" onClick={() => setAdding(true)}>
          <PlusIcon size={12} />
          {t('view.add')}
        </button>
      </div>
    );
  }

  return (
    <div className="view-bar" role="tablist" aria-label={t('view.bar')} onPointerMove={liquid}>
      <div className="chip-row">
        {views.map((v) => {
          const active = v.id === activeView.id;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`chip${active ? ' is-active' : ''}`}
              title={v.id === MAIN_VIEW_ID ? t('view.mainHint') : t('view.ownHint')}
              onClick={() =>
                dispatchUi({ type: 'setActiveView', id: v.id === MAIN_VIEW_ID ? null : v.id })
              }
            >
              {nameOf(v.id, v.name)}
              {active && v.id !== MAIN_VIEW_ID && (
                /* A span, not a nested button: a button inside a button is
                   invalid markup and the browser drops one of them. */
                <span
                  role="button"
                  tabIndex={0}
                  className="chip-close"
                  aria-label={t('view.delete')}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!confirm(t('view.confirmDelete', { name: v.name }))) return;
                    dispatchUi({ type: 'setActiveView', id: null });
                    dispatch({ type: 'deleteView', id: v.id });
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    e.stopPropagation();
                    dispatchUi({ type: 'setActiveView', id: null });
                    dispatch({ type: 'deleteView', id: v.id });
                  }}
                >
                  <CloseIcon size={11} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {adding ? (
        <input
          ref={inputRef}
          className="input view-bar-input"
          value={draft}
          placeholder={t('view.addPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="chip view-bar-add"
          title={t('view.add')}
          aria-label={t('view.add')}
          onClick={() => setAdding(true)}
        >
          <PlusIcon size={12} />
        </button>
      )}

      {ui.selectedIds.size > 0 && activeView.id !== MAIN_VIEW_ID && (
        <button
          type="button"
          className="chip"
          onClick={() =>
            dispatch({
              type: 'setViewInclude',
              id: activeView.id,
              include: [...ui.selectedIds],
            })
          }
        >
          {t('view.narrow')}
        </button>
      )}
      {activeView.include && (
        <button
          type="button"
          className="chip"
          onClick={() => dispatch({ type: 'setViewInclude', id: activeView.id, include: null })}
        >
          {t('view.widen')}
        </button>
      )}
    </div>
  );
}
