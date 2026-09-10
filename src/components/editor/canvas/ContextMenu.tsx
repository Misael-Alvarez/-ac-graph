'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as E from '@/lib/engine';
import type { MessageKey } from '@/lib/i18n/messages';
import { shortcut } from '@/lib/editor/platform';
import { useEditor } from '../EditorProvider';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';

interface Entry {
  id: string;
  labelKey: MessageKey;
  shortcut?: string;
  danger?: boolean;
  run: () => void;
}

const SEPARATOR = 'separator' as const;
type Row = Entry | typeof SEPARATOR;

/** Keeps the menu inside the window when opened near an edge. */
function useClampedPosition(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // `offsetWidth`, not the painted rectangle: the menu animates in from a
    // smaller scale, and measuring it mid-flight clamped it against a size it
    // was about to outgrow — so a menu opened near the edge settled outside it.
    const { offsetWidth: width, offsetHeight: height } = element;
    const margin = 8;
    setPosition({
      left: Math.min(x, window.innerWidth - width - margin),
      top: Math.min(y, window.innerHeight - height - margin),
    });
  }, [x, y]);

  return { ref, position };
}

/**
 * Right-click menu.
 *
 * What it offers depends on what was clicked, so the same gesture is useful
 * everywhere: on a shape it edits that shape, on a connector it edits the
 * connection, and on bare canvas it places something where the pointer is —
 * which is the one place a menu can act on a position the user chose.
 */
export function ContextMenu() {
  const { ui, view, dispatch, dispatchUi, t } = useEditor();
  const liquid = useLiquidPointer();
  const target = ui.contextMenu;
  const { ref, position } = useClampedPosition(target?.x ?? 0, target?.y ?? 0);

  useEffect(() => {
    if (!target) return;
    const close = () => dispatchUi({ type: 'closeContextMenu' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [target, dispatchUi]);

  if (!target) return null;

  const close = () => dispatchUi({ type: 'closeContextMenu' });
  const shape = target.shapeId ? E.getShape(view, target.shapeId) : undefined;
  const connector = target.connectorId
    ? view.connectors.find((c) => c.id === target.connectorId)
    : undefined;

  const selection = ui.selectedIds.size > 1 ? [...ui.selectedIds] : shape ? [shape.id] : [];

  const rows: Row[] = [];

  if (connector) {
    rows.push(
      {
        id: 'reverse',
        labelKey: 'menu.reverse',
        run: () => dispatch({ type: 'reverseConnector', id: connector.id }),
      },
      {
        id: 'style',
        labelKey: connector.style === 'dashed' ? 'menu.solid' : 'menu.dashed',
        run: () =>
          dispatch({
            type: 'setConnectorProps',
            id: connector.id,
            patch: { style: connector.style === 'dashed' ? 'solid' : 'dashed' },
          }),
      },
      SEPARATOR,
      {
        id: 'delete',
        labelKey: 'action.delete',
        shortcut: 'Del',
        danger: true,
        run: () => {
          dispatch({ type: 'deleteConnector', id: connector.id });
          dispatchUi({ type: 'clearSelection' });
        },
      },
    );
  } else if (shape) {
    const container =
      shape.type === 'group'
        ? E.children(view, shape.id).find((s) => s.type === 'container')
        : shape.type === 'container'
          ? shape
          : undefined;

    rows.push({
      id: 'rename',
      labelKey: 'menu.editLabel',
      run: () => {
        dispatchUi({ type: 'select', ids: [shape.id] });
        requestAnimationFrame(() =>
          document.querySelector<HTMLInputElement>('.inspector .input')?.select(),
        );
      },
    });

    if (container) {
      rows.push({
        id: 'addItem',
        labelKey: 'menu.addItem',
        run: () => dispatch({ type: 'addItem', containerId: container.id }),
      });
    }

    rows.push(
      SEPARATOR,
      {
        id: 'duplicate',
        labelKey: 'action.duplicate',
        shortcut: shortcut('D'),
        run: () => dispatch({ type: 'duplicateShapes', ids: selection }),
      },
      {
        id: 'front',
        labelKey: 'action.bringToFront',
        run: () => dispatch({ type: 'bringToFront', id: shape.id }),
      },
      {
        id: 'back',
        labelKey: 'action.sendToBack',
        run: () => dispatch({ type: 'sendToBack', id: shape.id }),
      },
      SEPARATOR,
      {
        id: 'delete',
        labelKey: 'action.delete',
        shortcut: 'Del',
        danger: true,
        run: () => {
          dispatch({ type: 'deleteShapes', ids: selection });
          dispatchUi({ type: 'clearSelection' });
        },
      },
    );
  } else {
    rows.push(
      {
        id: 'addGroup',
        labelKey: 'menu.addGroup',
        run: () => dispatch({ type: 'addGroup', x: target.canvasX, y: target.canvasY }),
      },
      {
        id: 'addBoundary',
        labelKey: 'menu.addBoundary',
        run: () =>
          dispatch({
            type: 'addBoundary',
            x: target.canvasX,
            y: target.canvasY,
            variant: 'outer',
          }),
      },
      SEPARATOR,
      {
        id: 'browse',
        labelKey: 'action.browser',
        shortcut: shortcut('B'),
        run: () => dispatchUi({ type: 'toggleBrowser' }),
      },
      {
        id: 'selectAll',
        labelKey: 'menu.selectAllHere',
        shortcut: shortcut('A'),
        run: () =>
          dispatchUi({
            type: 'select',
            ids: view.shapes.filter((s) => s.type !== 'container').map((s) => s.id),
          }),
      },
      {
        id: 'autoLayout',
        labelKey: 'action.autoLayout',
        run: () =>
          dispatch({ type: 'autoLayout', viewId: ui.activeViewId, drillPath: ui.drillPath }),
      },
    );
  }

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={liquid}
    >
      {rows.map((row, index) =>
        row === SEPARATOR ? (
          <span key={`sep-${index}`} className="context-menu-separator" />
        ) : (
          <button
            key={row.id}
            type="button"
            role="menuitem"
            className={`context-menu-item${row.danger ? ' is-danger' : ''}`}
            style={{ '--i': index } as React.CSSProperties}
            onClick={() => {
              row.run();
              close();
            }}
          >
            <span>{t(row.labelKey)}</span>
            {row.shortcut && <kbd>{row.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
