'use client';

import { useEffect } from 'react';
import { useEditor } from '../EditorProvider';
import { ChevronDownIcon } from '@/components/icons/ToolIcons';

/**
 * Where in the architecture the reader currently is.
 *
 * Drilling narrows the canvas to one branch, which is only navigation if there
 * is a way back — otherwise it is a diagram that lost most of itself. So the
 * trail appears the moment there is one, names every level, and every level is
 * a way up. Escape steps back one, which is what Escape means everywhere else
 * in this editor.
 */
export function Breadcrumb() {
  const { doc, ui, dispatchUi, t } = useEditor();

  useEffect(() => {
    if (!ui.drillPath.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only when nothing is selected: Escape clears a selection first, which is
      // the more local meaning and the one a reader expects to win.
      if (ui.selectedIds.size || ui.selectedConnectorId) return;
      e.preventDefault();
      dispatchUi({ type: 'drillUpTo', depth: ui.drillPath.length - 1 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ui.drillPath, ui.selectedIds, ui.selectedConnectorId, dispatchUi]);

  if (!ui.drillPath.length) return null;

  const nameOf = (id: string) => {
    const shape = doc.model.shapes.find((s) => s.id === id);
    return shape?.title || t('breadcrumb.unnamed');
  };

  return (
    <nav className="breadcrumb" aria-label={t('breadcrumb.label')}>
      <button
        type="button"
        className="breadcrumb-step"
        onClick={() => dispatchUi({ type: 'drillUpTo', depth: 0 })}
      >
        {t('breadcrumb.root')}
      </button>
      {ui.drillPath.map((id, i) => (
        <span key={id} className="breadcrumb-part">
          {/* Rotated a quarter turn: one chevron in the icon set, pointing the
              way the trail runs rather than a second asset that means the same. */}
          <ChevronDownIcon size={12} className="breadcrumb-sep" />
          <button
            type="button"
            className="breadcrumb-step"
            aria-current={i === ui.drillPath.length - 1 ? 'page' : undefined}
            onClick={() => dispatchUi({ type: 'drillUpTo', depth: i + 1 })}
          >
            {nameOf(id)}
          </button>
        </span>
      ))}
    </nav>
  );
}
