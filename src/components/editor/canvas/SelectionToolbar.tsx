'use client';

import { useMemo } from 'react';
import type { AlignEdge, DistributeAxis } from '@/lib/engine';
import { bbox, outermost } from '@/lib/engine';
import { toScreen } from '@/lib/editor/viewport';
import { useEditor } from '../EditorProvider';
import {
  AlignBottomIcon,
  AlignCenterXIcon,
  AlignCenterYIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  DistributeHorizontalIcon,
  DistributeVerticalIcon,
} from '@/components/icons/AlignIcons';
import { CopyIcon, TrashIcon } from '@/components/icons/ToolIcons';

const ALIGNMENTS: {
  edge: AlignEdge;
  label: string;
  Icon: (p: { size?: number }) => React.ReactElement;
}[] = [
  { edge: 'left', label: 'align.left', Icon: AlignLeftIcon },
  { edge: 'centerX', label: 'align.centerX', Icon: AlignCenterXIcon },
  { edge: 'right', label: 'align.right', Icon: AlignRightIcon },
  { edge: 'top', label: 'align.top', Icon: AlignTopIcon },
  { edge: 'centerY', label: 'align.centerY', Icon: AlignCenterYIcon },
  { edge: 'bottom', label: 'align.bottom', Icon: AlignBottomIcon },
];

const DISTRIBUTIONS: {
  axis: DistributeAxis;
  label: string;
  Icon: (p: { size?: number }) => React.ReactElement;
}[] = [
  { axis: 'horizontal', label: 'align.distributeH', Icon: DistributeHorizontalIcon },
  { axis: 'vertical', label: 'align.distributeV', Icon: DistributeVerticalIcon },
];

/**
 * Actions for a multi-selection, floating just above it.
 *
 * Alignment belongs next to what it acts on, not in a menu three levels deep:
 * it is the single most repeated operation in tidying a diagram, and burying it
 * is what makes an editor feel like a chore.
 */
export function SelectionToolbar() {
  const { ui, view, dispatch, dispatchUi, t } = useEditor();

  const targets = useMemo(
    () => (ui.selectedIds.size >= 2 ? outermost(view, ui.selectedIds) : []),
    [view, ui.selectedIds],
  );

  const anchor = useMemo(() => {
    if (targets.length < 2) return null;
    const boxes = targets.map(bbox);
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    const top = Math.min(...boxes.map((b) => b.y));
    return toScreen(ui.viewport, { x: (left + right) / 2, y: top });
  }, [targets, ui.viewport]);

  if (!anchor || targets.length < 2) return null;

  const ids = targets.map((shape) => shape.id);
  const canDistribute = targets.length >= 3;

  return (
    <div
      className="selection-toolbar"
      style={{ left: anchor.x, top: anchor.y }}
      role="toolbar"
      aria-label={t('align.title')}
    >
      <span className="selection-count">{ui.selectedIds.size}</span>
      <span className="selection-divider" />

      {ALIGNMENTS.map(({ edge, label, Icon }) => (
        <button
          key={edge}
          type="button"
          className="icon-button"
          title={t(label as Parameters<typeof t>[0])}
          aria-label={t(label as Parameters<typeof t>[0])}
          onClick={() => dispatch({ type: 'alignShapes', ids, edge })}
        >
          <Icon size={16} />
        </button>
      ))}

      <span className="selection-divider" />

      {DISTRIBUTIONS.map(({ axis, label, Icon }) => (
        <button
          key={axis}
          type="button"
          className="icon-button"
          disabled={!canDistribute}
          title={t(label as Parameters<typeof t>[0])}
          aria-label={t(label as Parameters<typeof t>[0])}
          onClick={() => dispatch({ type: 'distributeShapes', ids, axis })}
        >
          <Icon size={16} />
        </button>
      ))}

      <span className="selection-divider" />

      <button
        type="button"
        className="icon-button"
        title={t('action.duplicate')}
        aria-label={t('action.duplicate')}
        onClick={() => dispatch({ type: 'duplicateShapes', ids: [...ui.selectedIds] })}
      >
        <CopyIcon size={15} />
      </button>
      <button
        type="button"
        className="icon-button is-danger"
        title={t('action.delete')}
        aria-label={t('action.delete')}
        onClick={() => {
          dispatch({ type: 'deleteShapes', ids: [...ui.selectedIds] });
          dispatchUi({ type: 'clearSelection' });
        }}
      >
        <TrashIcon size={15} />
      </button>
    </div>
  );
}
