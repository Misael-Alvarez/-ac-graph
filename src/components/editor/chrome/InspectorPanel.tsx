'use client';

import { useRef } from 'react';
import { TrashIcon } from '@/components/icons/ToolIcons';
import { useEditor } from '../EditorProvider';
import { ConnectorInspector } from './inspector/ConnectorInspector';
import { ShapeInspector } from './inspector/ShapeInspector';

/**
 * Contextual properties panel.
 *
 * It only exists while something is selected: the previous editor kept a 280px
 * column permanently on screen showing "no selection" most of the time. What
 * it shows depends on what that is — a connection, several shapes, one shape —
 * and each of those is its own component under `./inspector`.
 */
export function InspectorPanel() {
  const { ui, view, dispatch, dispatchUi, readOnly, t } = useEditor();
  const selected = view.shapes.filter((s) => ui.selectedIds.has(s.id));
  const selectedShape = selected.length === 1 ? selected[0] : null;

  /*
   * One undo step per visit to a field.
   *
   * Every keystroke in a label is its own action, and without this every one
   * was its own history entry: undoing a typed word took a Cmd+Z per letter,
   * which reads as undo not working. The counter advances each time focus
   * lands on a control in the panel, so a word typed in one sitting folds into
   * one step and coming back to the same field later starts another.
   */
  const burst = useRef(0);
  const nextBurst = () => {
    burst.current += 1;
  };
  const stepKey = (id: string, fields: string[]) =>
    `props:${id}:${fields.join('+')}:${burst.current}`;

  if (selected.length === 0 && !ui.selectedConnectorId) return null;

  // A viewer reads every property; a disabled fieldset is what keeps all of
  // them — inputs, selects, buttons — from pretending to work.
  const lock = (panel: React.ReactElement) =>
    readOnly ? (
      <fieldset className="inspector-lock" disabled aria-label={t('readonly.badge')}>
        {panel}
      </fieldset>
    ) : (
      panel
    );

  if (ui.selectedConnectorId) {
    const connector = view.connectors.find((c) => c.id === ui.selectedConnectorId);
    if (!connector) return null;
    return lock(
      <ConnectorInspector connector={connector} stepKey={stepKey} nextBurst={nextBurst} />,
    );
  }

  if (!selectedShape) {
    return lock(
      <aside className="inspector" aria-label={t('inspector.title')}>
        <header className="inspector-header">{t('inspector.title')}</header>
        <p className="inspector-note">{t('inspector.multi', { count: selected.length })}</p>
        <div className="inspector-actions">
          <button
            type="button"
            className="button is-danger"
            onClick={() => {
              dispatch({ type: 'deleteShapes', ids: selected.map((s) => s.id) });
              dispatchUi({ type: 'clearSelection' });
            }}
          >
            <TrashIcon size={14} /> {t('action.delete')}
          </button>
        </div>
      </aside>,
    );
  }

  return lock(
    <ShapeInspector
      shape={selectedShape}
      selectedIds={selected.map((s) => s.id)}
      stepKey={stepKey}
      nextBurst={nextBurst}
    />,
  );
}
