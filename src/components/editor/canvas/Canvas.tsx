'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Shape } from '@/lib/domain';
import * as E from '@/lib/engine';
import { iconKeysIn } from '@/lib/engine';
import { canvasTheme } from '@/lib/design/tokens';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { toCanvas, viewportTransform, visibleBox, zoomAt } from '@/lib/editor/viewport';
import { isTextEntryTarget } from '@/lib/editor/domFocus';
import { useEditor } from '../EditorProvider';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import { usePointerTools } from '../hooks/usePointerTools';
import { Defs } from './Defs';
import { DiagramScene } from './DiagramScene';
import type { ShapeInteraction } from './shapes';
import { EmptyState } from './EmptyState';
import { ContextMenu } from './ContextMenu';
import { SelectionToolbar } from './SelectionToolbar';

const HANDLE = 9;

export function Canvas() {
  const { doc, ui, dispatch, dispatchUi, collisions, t } = useEditor();
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Paper, not chrome: the sheet does not follow the interface's theme.
  const theme = canvasTheme();

  const toLocal = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  const tools = usePointerTools({
    model: doc.model,
    viewport: ui.viewport,
    gridSnap: ui.gridSnap,
    selectedIds: ui.selectedIds,
    toLocal,
    onMoveShapes: (ids, dx, dy) => dispatch({ type: 'moveShapes', ids, dx, dy }),
    onResizeShape: (id, w, h) => dispatch({ type: 'resizeShape', id, w, h }),
    onLassoSelect: (ids) => dispatchUi({ type: 'select', ids }),
    onViewportChange: (viewport) => dispatchUi({ type: 'setViewport', viewport }),
  });

  /* Track the element size so fit-to-view and culling know the viewport. */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* Space temporarily switches to panning, the convention in every canvas tool. */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      // Never swallow a space the user is typing — the code editor is a
      // contenteditable, so a tag-name check alone would break it.
      if (isTextEntryTarget(e.target)) return;
      e.preventDefault();
      setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* The viewport as the wheel handler below sees it. It changes on every frame
     of a pan, and a non-passive listener that is torn down and re-attached that
     often is pure overhead — and a window in which a wheel event has nowhere to
     land. */
  const viewportRef = useRef(ui.viewport);
  useEffect(() => {
    viewportRef.current = ui.viewport;
  });

  /* Wheel: pinch or ctrl zooms at the cursor, plain wheel pans.
     Bound to the host rather than the SVG so that overlays sitting above the
     canvas — the empty state's buttons, for one — cannot swallow the gesture. */
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const local = toLocal(e);
      const viewport = viewportRef.current;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY / 240);
        dispatchUi({
          type: 'setViewport',
          viewport: zoomAt(viewport, viewport.zoom * factor, local),
        });
      } else {
        dispatchUi({
          type: 'setViewport',
          viewport: { ...viewport, x: viewport.x - e.deltaX, y: viewport.y - e.deltaY },
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [dispatchUi, toLocal]);

  const model = tools.previewModel;

  /* Only paint what is on screen. */
  const visible = useMemo(() => {
    if (!size.width || !size.height) return null;
    const box = visibleBox(ui.viewport, size);
    return E.inflate(box, 200);
  }, [ui.viewport, size]);

  const culledModel = useMemo(() => {
    if (!visible || model.shapes.length < 60) return model;
    const kept = model.shapes.filter((s) => E.rectsOverlap(E.bbox(s), visible));
    if (kept.length === model.shapes.length) return model;
    return { ...model, shapes: kept };
  }, [model, visible]);

  const snap = useCallback(
    (value: number) => (ui.gridSnap ? E.snapToGrid(value) : value),
    [ui.gridSnap],
  );

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 1 || spaceHeld || ui.tool === 'pan') {
        e.preventDefault();
        tools.startPan(e);
        return;
      }
      if (e.button !== 0) return;

      const point = toCanvas(ui.viewport, toLocal(e));
      switch (ui.tool) {
        case 'boundary':
          dispatch({ type: 'addBoundary', x: snap(point.x), y: snap(point.y), variant: 'outer' });
          dispatchUi({ type: 'setTool', tool: 'select' });
          break;
        case 'subboundary':
          dispatch({ type: 'addBoundary', x: snap(point.x), y: snap(point.y), variant: 'sub' });
          dispatchUi({ type: 'setTool', tool: 'select' });
          break;
        case 'group':
          dispatch({ type: 'addGroup', x: snap(point.x), y: snap(point.y) });
          dispatchUi({ type: 'setTool', tool: 'select' });
          break;
        default:
          dispatchUi({ type: 'clearSelection' });
          tools.startLasso(e);
      }
    },
    [ui.tool, ui.viewport, spaceHeld, tools, dispatch, dispatchUi, snap, toLocal],
  );

  const onShapePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      if (ui.tool !== 'select' || spaceHeld || e.button !== 0) return;
      e.stopPropagation();
      if (!e.shiftKey && !ui.selectedIds.has(id)) dispatchUi({ type: 'select', ids: [id] });
      if (e.shiftKey) dispatchUi({ type: 'toggleSelected', id });
      tools.startDrag(e, id);
    },
    [ui.tool, ui.selectedIds, spaceHeld, tools, dispatchUi],
  );

  const onShapeClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      const shape = E.getShape(doc.model, id);

      if (ui.tool === 'connector') {
        if (!ui.connectorSourceId) dispatchUi({ type: 'setConnectorSource', id });
        else if (ui.connectorSourceId !== id) {
          dispatch({ type: 'addConnector', sourceId: ui.connectorSourceId, targetId: id });
          dispatchUi({ type: 'setConnectorSource', id: null });
        }
        return;
      }

      if (ui.tool === 'item') {
        if (shape?.type === 'container') dispatch({ type: 'addItem', containerId: id });
        else if (shape?.type === 'group') {
          const container = E.children(doc.model, id).find((s) => s.type === 'container');
          if (container) dispatch({ type: 'addItem', containerId: container.id });
        }
        return;
      }

      if (ui.tool === 'select' && !e.shiftKey) dispatchUi({ type: 'select', ids: [id] });
    },
    [ui.tool, ui.connectorSourceId, doc.model, dispatch, dispatchUi],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const key = e.dataTransfer.getData('text/plain');
      const service = SERVICE_ICONS.find((s) => s.key === key);
      if (!service) return;
      const point = toCanvas(ui.viewport, toLocal(e));
      dispatch({
        type: 'addGroup',
        x: snap(point.x - 120),
        y: snap(point.y - 60),
        service: {
          key: service.key,
          label: service.label,
          description: serviceDescription(service, ui.locale),
          category: service.category,
        },
      });
    },
    [ui.viewport, ui.locale, dispatch, snap, toLocal],
  );

  const interactionFor = useCallback(
    (shape: Shape): ShapeInteraction => ({
      selected: ui.selectedIds.has(shape.id),
      colliding: collisions.has(shape.id),
      isConnectorSource: ui.connectorSourceId === shape.id,
      onPointerDown: onShapePointerDown,
      onClick: onShapeClick,
      onDoubleClick: (e, id) => {
        // The old editor floated an <input> over the canvas. Selecting the shape
        // and focusing the inspector's first field does the same job with one
        // text input in the app instead of two.
        e.stopPropagation();
        dispatchUi({ type: 'select', ids: [id] });
        requestAnimationFrame(() => {
          document.querySelector<HTMLInputElement>('.inspector .input')?.select();
        });
      },
      onContextMenu: (e, id) => {
        e.preventDefault();
        e.stopPropagation();
        // Right-clicking outside the current selection selects the target, but
        // right-clicking inside it keeps the selection so the menu can act on all.
        if (!ui.selectedIds.has(id)) dispatchUi({ type: 'select', ids: [id] });
        const point = toCanvas(ui.viewport, toLocal(e));
        dispatchUi({
          type: 'openContextMenu',
          target: { x: e.clientX, y: e.clientY, shapeId: id, canvasX: point.x, canvasY: point.y },
        });
      },
    }),
    [
      ui.selectedIds,
      ui.connectorSourceId,
      ui.viewport,
      collisions,
      onShapePointerDown,
      onShapeClick,
      dispatchUi,
      toLocal,
    ],
  );

  const selectedShapes = useMemo(
    () => model.shapes.filter((s) => ui.selectedIds.has(s.id)),
    [model.shapes, ui.selectedIds],
  );

  const cursor =
    spaceHeld || ui.tool === 'pan' ? 'grab' : ui.tool === 'select' ? 'default' : 'crosshair';

  /** The handle is drawn inside the zoomed group, so its size has to undo it. */
  const handleSize = HANDLE / ui.viewport.zoom;

  return (
    <div
      ref={hostRef}
      className="canvas-host"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(e) => {
        // Bound on the host, not the SVG: overlays that float above the canvas —
        // the empty state's buttons, for one — would otherwise swallow the click.
        if (e.defaultPrevented) return;
        e.preventDefault();
        const point = toCanvas(ui.viewport, toLocal(e));
        dispatchUi({
          type: 'openContextMenu',
          target: { x: e.clientX, y: e.clientY, canvasX: point.x, canvasY: point.y },
        });
      }}
    >
      <svg
        ref={svgRef}
        className="canvas-surface"
        style={{ cursor, background: theme.sheet }}
        onPointerDown={onBackgroundPointerDown}
        role="application"
        aria-label={t('app.title')}
        tabIndex={-1}
      >
        <Defs theme={theme} iconKeys={iconKeysIn(model)} />
        {ui.gridSnap && (
          <>
            <pattern
              id="grid-dots"
              width={E.G.SNAP_SIZE * ui.viewport.zoom}
              height={E.G.SNAP_SIZE * ui.viewport.zoom}
              patternUnits="userSpaceOnUse"
              x={ui.viewport.x}
              y={ui.viewport.y}
            >
              <circle cx={1} cy={1} r={1} fill={theme.grid} />
            </pattern>
            <rect width="100%" height="100%" fill="url(#grid-dots)" opacity={0.75} />
          </>
        )}

        <g transform={viewportTransform(ui.viewport)}>
          <DiagramScene
            model={culledModel}
            theme={theme}
            interactionFor={interactionFor}
            connectorInteraction={{
              selectedId: ui.selectedConnectorId,
              onClick: (e, id) => {
                e.stopPropagation();
                dispatchUi({ type: 'selectConnector', id });
              },
              onContextMenu: (e, id) => {
                e.preventDefault();
                e.stopPropagation();
                dispatchUi({ type: 'selectConnector', id });
                const point = toCanvas(ui.viewport, toLocal(e));
                dispatchUi({
                  type: 'openContextMenu',
                  target: {
                    x: e.clientX,
                    y: e.clientY,
                    connectorId: id,
                    canvasX: point.x,
                    canvasY: point.y,
                  },
                });
              },
            }}
          />

          {/* Editor chrome. Deliberately outside DiagramScene so exports and
              embeds cannot pick it up — that was the black-rectangle bug. */}
          <g className="canvas-overlay" pointerEvents="none">
            {tools.guides.map((guide, i) =>
              guide.axis === 'x' ? (
                <line
                  key={`gx-${i}`}
                  x1={guide.pos}
                  y1={visible ? visible.y : -10_000}
                  x2={guide.pos}
                  y2={visible ? visible.y + visible.h : 10_000}
                  className="align-guide"
                />
              ) : (
                <line
                  key={`gy-${i}`}
                  x1={visible ? visible.x : -10_000}
                  y1={guide.pos}
                  x2={visible ? visible.x + visible.w : 10_000}
                  y2={guide.pos}
                  className="align-guide"
                />
              ),
            )}

            {model.shapes
              .filter((s) => collisions.has(s.id))
              .map((s) => (
                <rect
                  key={`c-${s.id}`}
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                  rx={8}
                  className="collision-outline"
                />
              ))}

            {/* What a comparison found, drawn on the diagram it is about: a list
                of changes beside a canvas that does not show them makes the
                reader do the matching by hand. */}
            {ui.diffHighlight &&
              model.shapes
                .filter(
                  (s) =>
                    ui.diffHighlight!.added.includes(s.id) ||
                    ui.diffHighlight!.changed.includes(s.id),
                )
                .map((s) => (
                  <rect
                    key={`d-${s.id}`}
                    x={s.x - 3}
                    y={s.y - 3}
                    width={s.w + 6}
                    height={s.h + 6}
                    rx={10}
                    className={
                      ui.diffHighlight!.added.includes(s.id) ? 'diff-added' : 'diff-changed'
                    }
                  />
                ))}

            {selectedShapes.map((s) => (
              <rect
                key={`s-${s.id}`}
                x={s.x - 1}
                y={s.y - 1}
                width={s.w + 2}
                height={s.h + 2}
                rx={9}
                className="selection-outline"
              />
            ))}

            {ui.connectorSourceId &&
              (() => {
                const source = E.getShape(model, ui.connectorSourceId);
                if (!source) return null;
                return (
                  <rect
                    x={source.x - 2}
                    y={source.y - 2}
                    width={source.w + 4}
                    height={source.h + 4}
                    rx={10}
                    className="connector-source"
                  />
                );
              })()}

            {tools.lassoBox && (
              <rect
                x={tools.lassoBox.x}
                y={tools.lassoBox.y}
                width={tools.lassoBox.w}
                height={tools.lassoBox.h}
                className="lasso"
              />
            )}
          </g>

          {/* Resize handle, only for a single selection of a sizeable shape.
              Sized against the zoom: as a plain canvas rectangle it shrank to
              three unclickable pixels when the diagram was zoomed out, and grew
              into a slab when it was zoomed in. */}
          {selectedShapes.length === 1 && selectedShapes[0].type !== 'container' && (
            <rect
              x={selectedShapes[0].x + selectedShapes[0].w - handleSize / 2}
              y={selectedShapes[0].y + selectedShapes[0].h - handleSize / 2}
              width={handleSize}
              height={handleSize}
              rx={2 / ui.viewport.zoom}
              className="resize-handle"
              onPointerDown={(e) => {
                e.stopPropagation();
                tools.startResize(e, selectedShapes[0].id);
              }}
            />
          )}
        </g>
      </svg>

      {doc.model.shapes.length === 0 && <EmptyState />}
      <SelectionToolbar />
      <ContextMenu />
    </div>
  );
}
