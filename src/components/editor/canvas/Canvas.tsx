'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Shape } from '@/lib/domain';
import { isDecorative } from '@/lib/domain';
import { CommentPins } from '../comments/CommentPins';
import * as E from '@/lib/engine';
import { iconKeysIn } from '@/lib/engine';
import { connectorColorsIn } from '@/lib/editor/meta';
import { canvasTheme } from '@/lib/design/tokens';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import {
  fitToBox,
  frameOnOpen,
  lerpViewport,
  toCanvas,
  viewportTransform,
  visibleBox,
  zoomAt,
  type Viewport,
} from '@/lib/editor/viewport';
import { describeDiagram } from '@/lib/editor/describe';
import { labelAnchor, positionAlong } from '@/lib/editor/connectorPath';
import { isTextEntryTarget } from '@/lib/editor/domFocus';
import { useEditor } from '../EditorProvider';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import { usePointerTools } from '../hooks/usePointerTools';
import { useCommands } from '../hooks/useCommands';
import { isCustomIconKey } from '@/lib/icons/customIcons';
import { currentIconLibrary } from '@/lib/icons/iconLibrary';
import { Defs } from './Defs';
import { DiagramScene } from './DiagramScene';
import type { ShapeInteraction } from './shapes';
import { EmptyState } from './EmptyState';
import { SelectionToolbar } from './SelectionToolbar';
import { ConnectorHandles } from './ConnectorHandles';

const HANDLE = 9;
/** How long the camera takes to glide to a commanded viewport. */
const GLIDE_MS = 360;

export function Canvas() {
  const { doc, ui, view, dispatch, dispatchUi, collisions, readOnly, t } = useEditor();
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const commands = useCommands();
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // The sheet follows the chrome, so what is on screen is what an export from
  // this editor will look like.
  const theme = canvasTheme(ui.dark);
  const description = useMemo(() => describeDiagram(view, t), [view, t]);

  const toLocal = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  const tools = usePointerTools({
    model: view,
    routingModel: doc.model,
    viewport: ui.viewport,
    gridSnap: ui.gridSnap,
    selectedIds: ui.selectedIds,
    toLocal,
    onMoveShapes: (ids, dx, dy) =>
      dispatch({ type: 'moveShapes', ids, dx, dy, viewId: ui.activeViewId }),
    onResizeShape: (id, w, h) =>
      dispatch({ type: 'resizeShape', id, w, h, viewId: ui.activeViewId }),
    onSetConnectorRoute: (id, waypoints) =>
      dispatch({ type: 'setConnectorRoute', id, waypoints, viewId: ui.activeViewId }),
    onSetConnectorLabel: (id, labelAt) =>
      dispatch({ type: 'setConnectorProps', id, patch: { labelAt } }),
    onLassoSelect: (ids) => dispatchUi({ type: 'select', ids }),
    onViewportChange: (viewport) => dispatchUi({ type: 'setViewport', viewport }),
    readOnly,
  });

  // Drilling re-frames on what it descended into; narrowing the canvas without
  // moving the camera leaves the reader looking at empty paper. Seeded with the
  // depth it mounts at, so opening a diagram does not move the camera at all —
  // only crossing a level does.
  const depth = ui.drillPath.length;
  const lastFitted = useRef(depth);
  useEffect(() => {
    if (depth === lastFitted.current || !size.width || !view.shapes.length) return;
    lastFitted.current = depth;
    dispatchUi({
      type: 'setViewport',
      viewport: fitToBox(E.contentBBox(view), size),
      smooth: true,
    });
  }, [depth, size, view, dispatchUi]);

  /* The camera glides when a command moves it — fit, reset, a drill — and
     jumps when the hand does: a wheel or a drag already is the motion, and an
     easing on top of it is lag. `shown` is what the sheet is drawn with; the
     committed viewport is what pointer maths and the zoom label read, so a
     click during the glide still lands where the drawing will settle. */
  const [glide, setGlide] = useState<{ target: Viewport; value: Viewport } | null>(null);
  // Derived, not mirrored: a jump shows in the same commit as the change, and
  // only a glide towards the *current* target takes the slower road through
  // animation frames. A glide left over from an older target is simply ignored.
  const shown = glide && glide.target === ui.viewport ? glide.value : ui.viewport;
  const lastShown = useRef(ui.viewport);
  useEffect(() => {
    const target = ui.viewport;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!ui.viewportSmooth || reduced) {
      lastShown.current = target;
      return;
    }
    const from = lastShown.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / GLIDE_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = t < 1 ? lerpViewport(from, target, eased) : target;
      lastShown.current = value;
      setGlide(t < 1 ? { target, value } : null);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ui.viewport, ui.viewportSmooth]);

  /* A diagram opens framed: the whole of it on screen, never magnified.
     Before this, every document opened at 100% from its top-left corner, so a
     platform of any size greeted the reader with a quarter of itself and the
     rest under the minimap. A layout effect, so the first painted frame is
     already the framed one; and armed again whenever the canvas empties, so a
     template, an import or a generation landing on blank paper is framed too. */
  const framed = useRef(false);
  useLayoutEffect(() => {
    if (!view.shapes.length) {
      framed.current = false;
      return;
    }
    if (framed.current || !size.width) return;
    framed.current = true;
    // Content the reader placed by hand — the first group clicked onto blank
    // paper — stays exactly where they put it. Moving the camera under a hand
    // that is still drawing is the one thing framing must never do; it is for
    // content that arrives whole: an opened document, a template, an import.
    if (doc.lastCreated.length) return;
    // Clear of the dock on the left and the minimap on the right: framed
    // "to the viewport" and then hidden under a panel is not framed.
    const dock = document.querySelector('.tool-dock')?.getBoundingClientRect();
    const minimap = document.querySelector('.minimap')?.getBoundingClientRect();
    dispatchUi({
      type: 'setViewport',
      viewport: frameOnOpen(E.contentBBox(view), size, {
        left: dock ? dock.width + 24 : 0,
        right: minimap ? minimap.width + 16 : 0,
      }),
    });
  }, [size, view, doc.lastCreated, dispatchUi]);

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
    const box = visibleBox(shown, size);
    return E.inflate(box, 200);
  }, [shown, size]);

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

  /**
   * Any press on the canvas gives it the keyboard.
   *
   * Browsers do not agree on whether a press inside an SVG moves focus to it,
   * and when it does not, focus stays in whatever field was last edited — the
   * title, a label — and every shortcut after the drag, Cmd+Z above all, goes
   * to that field instead of the drawing.
   */
  const takeKeyboard = useCallback(() => {
    const svg = svgRef.current;
    if (svg && document.activeElement !== svg) svg.focus({ preventScroll: true });
  }, []);

  /**
   * Whether the press that just happened placed a shape.
   *
   * A placing tool acts on the press, and the tool is back to `select` before
   * the browser fires the click that follows it. When that press was over a
   * card — a note dropped onto a group, a boundary drawn over a frame — the
   * click then arrives at the card with the select tool active and selects
   * it, taking the selection off what was just placed. The click after a
   * placement is nobody's.
   */
  const placed = useRef(false);

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      takeKeyboard();
      placed.current = false;
      // Presenting: the sheet is something to move, not something to draw on.
      if (e.button === 1 || spaceHeld || ui.tool === 'pan' || ui.presenting) {
        e.preventDefault();
        tools.startPan(e);
        return;
      }
      if (e.button !== 0) return;

      const point = toCanvas(ui.viewport, toLocal(e));
      switch (ui.tool) {
        case 'boundary':
          placed.current = true;
          dispatch({ type: 'addBoundary', x: snap(point.x), y: snap(point.y), variant: 'outer' });
          dispatchUi({ type: 'setTool', tool: 'select' });
          break;
        case 'subboundary':
          placed.current = true;
          dispatch({ type: 'addBoundary', x: snap(point.x), y: snap(point.y), variant: 'sub' });
          dispatchUi({ type: 'setTool', tool: 'select' });
          break;
        case 'group':
          placed.current = true;
          dispatch({ type: 'addGroup', x: snap(point.x), y: snap(point.y) });
          dispatchUi({ type: 'setTool', tool: 'select' });
          break;
        case 'region':
        case 'note':
        case 'text': {
          placed.current = true;
          // Placed and selected in one go, with the text field ready: a note is
          // put down to be written on, and a second press to get there is the
          // press that makes people give up on notes.
          const id = E.decorationId(ui.tool);
          dispatch({
            type: 'addDecoration',
            kind: ui.tool,
            x: snap(point.x),
            y: snap(point.y),
            id,
          });
          dispatchUi({ type: 'setTool', tool: 'select' });
          dispatchUi({ type: 'select', ids: [id] });
          requestAnimationFrame(() => {
            document.querySelector<HTMLInputElement>('.inspector .input')?.focus();
          });
          break;
        }
        default:
          dispatchUi({ type: 'clearSelection' });
          tools.startLasso(e);
      }
    },
    [
      ui.tool,
      ui.viewport,
      ui.presenting,
      spaceHeld,
      tools,
      dispatch,
      dispatchUi,
      snap,
      toLocal,
      takeKeyboard,
    ],
  );

  const onShapePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      takeKeyboard();
      placed.current = false;
      // Presenting: a press on a card drags the sheet like a press beside it.
      if (ui.presenting) {
        if (e.button === 0) {
          e.stopPropagation();
          tools.startPan(e);
        }
        return;
      }
      if (ui.tool !== 'select' || spaceHeld || e.button !== 0) return;
      e.stopPropagation();
      if (!e.shiftKey && !ui.selectedIds.has(id)) dispatchUi({ type: 'select', ids: [id] });
      if (e.shiftKey) dispatchUi({ type: 'toggleSelected', id });
      tools.startDrag(e, id);
    },
    [ui.tool, ui.selectedIds, ui.presenting, spaceHeld, tools, dispatchUi, takeKeyboard],
  );

  const onShapeClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (ui.presenting) return;
      if (placed.current) {
        placed.current = false;
        return;
      }
      const shape = E.getShape(view, id);

      if (ui.tool === 'connector') {
        // Decoration makes no calls; the arrow waits for a card.
        if (shape && isDecorative(shape)) return;
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
          const container = E.children(view, id).find((s) => s.type === 'container');
          if (container) dispatch({ type: 'addItem', containerId: container.id });
        }
        return;
      }

      if (ui.tool === 'select' && !e.shiftKey) dispatchUi({ type: 'select', ids: [id] });
    },
    [ui.tool, ui.connectorSourceId, ui.presenting, view, dispatch, dispatchUi],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const key = e.dataTransfer.getData('text/plain');
      const point = toCanvas(ui.viewport, toLocal(e));
      if (isCustomIconKey(key)) {
        // One of the author's: from the document, or from the library.
        const icon =
          doc.model.customIcons?.find((i) => i.key === key) ??
          currentIconLibrary(window.localStorage).find((i) => i.key === key);
        if (icon)
          commands.addCustomService(icon, { x: snap(point.x - 120), y: snap(point.y - 60) });
        return;
      }
      const service = SERVICE_ICONS.find((s) => s.key === key);
      if (!service) return;
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
    [ui.viewport, ui.locale, dispatch, snap, toLocal, doc.model.customIcons, commands],
  );

  const interactionFor = useCallback(
    (shape: Shape): ShapeInteraction => ({
      selected: ui.selectedIds.has(shape.id),
      colliding: collisions.has(shape.id),
      isConnectorSource: ui.connectorSourceId === shape.id,
      onPointerDown: onShapePointerDown,
      onClick: onShapeClick,
      onDoubleClick: (e, id) => {
        e.stopPropagation();

        // Descending into something that holds a diagram's worth of detail is
        // what the double click means there; a group holding one service holds
        // no level below it, so `canDrillInto` is false and the old meaning —
        // rename — is what happens, which is the common case on these diagrams.
        if (E.canDrillInto(view, id)) {
          dispatchUi({ type: 'drillInto', id });
          return;
        }

        // The old editor floated an <input> over the canvas. Selecting the shape
        // and focusing the inspector's first field does the same job with one
        // text input in the app instead of two.
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
      view,
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
  const selectedConnector = model.connectors.find((c) => c.id === ui.selectedConnectorId);
  const labelBurst = useRef({ key: '', at: 0, count: 0 });

  const onConnectorPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || spaceHeld || ui.tool !== 'select' || ui.presenting) return;
    e.stopPropagation();
    takeKeyboard();
    dispatchUi({ type: 'selectConnector', id });
  };

  const cursor =
    spaceHeld || ui.tool === 'pan' ? 'grab' : ui.tool === 'select' ? 'default' : 'crosshair';

  /** The handle is drawn inside the zoomed group, so its size has to undo it. */
  const handleSize = HANDLE / shown.zoom;

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
        aria-describedby="canvas-description"
        tabIndex={-1}
      >
        <Defs
          theme={theme}
          iconKeys={iconKeysIn(model)}
          customIcons={doc.model.customIcons}
          connectorColors={connectorColorsIn(model)}
        />
        {ui.gridSnap && (
          <>
            <pattern
              id="grid-dots"
              width={E.G.SNAP_SIZE * shown.zoom}
              height={E.G.SNAP_SIZE * shown.zoom}
              patternUnits="userSpaceOnUse"
              x={shown.x}
              y={shown.y}
            >
              <circle cx={1} cy={1} r={1} fill={theme.grid} />
            </pattern>
            <rect width="100%" height="100%" fill="url(#grid-dots)" opacity={0.75} />
          </>
        )}

        {/* Painted only once the canvas knows its size, so the first frame a
            reader sees is the framed one rather than a flash of the top-left
            corner at 100%. */}
        {size.width > 0 && (
          <g transform={viewportTransform(shown)}>
            <DiagramScene
              model={culledModel}
              theme={theme}
              collapsed={shown.zoom < E.COLLAPSE_ZOOM}
              summaryLabel={(count) => t('canvas.services', { count })}
              interactionFor={interactionFor}
              connectorInteraction={{
                selectedId: ui.selectedConnectorId,
                onClick: (e, id) => {
                  e.stopPropagation();
                  if (ui.presenting || ui.tool !== 'select') return;
                  dispatchUi({ type: 'selectConnector', id });
                },
                onPointerDown: onConnectorPointerDown,
                onDoubleClick: (e, id) => {
                  if (readOnly || spaceHeld || ui.tool !== 'select') return;
                  e.stopPropagation();
                  const connector = model.connectors.find((c) => c.id === id);
                  if (!connector) return;
                  const { waypoints, index } = E.insertBend(
                    connector.waypoints,
                    toCanvas(ui.viewport, toLocal(e)),
                  );
                  dispatch({ type: 'setConnectorRoute', id, waypoints, viewId: ui.activeViewId });
                  requestAnimationFrame(() =>
                    document
                      .querySelector<SVGElement>(`[data-bend-index="${index}"]`)
                      ?.focus({ preventScroll: true }),
                  );
                },
                labelPositionName: t('canvas.labelPosition'),
                onLabelPointerDown:
                  readOnly || ui.tool !== 'select'
                    ? undefined
                    : (e, id) => {
                        if (e.button !== 0 || spaceHeld) return;
                        onConnectorPointerDown(e, id);
                        tools.startLabel(e, id);
                      },
                onLabelKeyDown: readOnly
                  ? undefined
                  : (e, id) => {
                      if (e.altKey || e.ctrlKey || e.metaKey) return;
                      const directions: Record<string, number> = {
                        ArrowLeft: -1,
                        ArrowDown: -1,
                        ArrowRight: 1,
                        ArrowUp: 1,
                      };
                      if (!(e.key in directions) && e.key !== 'Home' && e.key !== 'End') return;
                      e.preventDefault();
                      e.stopPropagation();
                      const connector = model.connectors.find((c) => c.id === id);
                      if (!connector) return;
                      const anchor = labelAnchor(connector.waypoints, connector.labelAt);
                      if (!anchor) return;
                      const at = connector.labelAt ?? positionAlong(connector.waypoints, anchor);
                      const labelAt =
                        e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? 1
                            : Math.max(
                                0,
                                Math.min(1, at + directions[e.key] * (e.shiftKey ? 0.1 : 0.01)),
                              );
                      const now = Date.now();
                      if (labelBurst.current.key !== id || now - labelBurst.current.at > 800)
                        labelBurst.current.count++;
                      labelBurst.current.key = id;
                      labelBurst.current.at = now;
                      dispatch({
                        type: 'setConnectorProps',
                        id,
                        patch: { labelAt },
                        coalesceKey: `label:${id}:${labelBurst.current.count}`,
                      });
                    },
                onContextMenu: (e, id) => {
                  if (ui.presenting) return;
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

            {/* Where the conversations are. Outside DiagramScene like the rest
              of the chrome, and gone while presenting: a pin is for the people
              working on the drawing, not for the audience. */}
            {!ui.presenting && (
              <CommentPins
                model={view}
                zoom={shown.zoom}
                draft={ui.commentDraft}
                t={t}
                onOpen={(pin) => {
                  if (pin.shapeId) dispatchUi({ type: 'select', ids: [pin.shapeId] });
                  dispatchUi({ type: 'openComments', threadId: pin.threadId });
                }}
              />
            )}

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

            {!readOnly && ui.tool === 'select' && selectedConnector && (
              <ConnectorHandles
                key={selectedConnector.id}
                connector={selectedConnector}
                zoom={shown.zoom}
                t={t}
                onPointerDown={(e, index) => {
                  if (e.button !== 0 || spaceHeld) return;
                  e.stopPropagation();
                  takeKeyboard();
                  tools.startBend(e, selectedConnector.id, index);
                }}
                onChange={(waypoints, coalesceKey) =>
                  dispatch({
                    type: 'setConnectorRoute',
                    id: selectedConnector.id,
                    waypoints,
                    coalesceKey,
                    viewId: ui.activeViewId,
                  })
                }
              />
            )}

            {/* Resize handle, only for a single selection of a sizeable shape.
              Sized against the zoom: as a plain canvas rectangle it shrank to
              three unclickable pixels when the diagram was zoomed out, and grew
              into a slab when it was zoomed in. */}
            {!readOnly && selectedShapes.length === 1 && selectedShapes[0].type !== 'container' && (
              <rect
                x={selectedShapes[0].x + selectedShapes[0].w - handleSize / 2}
                y={selectedShapes[0].y + selectedShapes[0].h - handleSize / 2}
                width={handleSize}
                height={handleSize}
                rx={2 / shown.zoom}
                className="resize-handle"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  tools.startResize(e, selectedShapes[0].id);
                }}
              />
            )}
          </g>
        )}
      </svg>

      {/* What the picture says, for whoever cannot see it. Read from `view`, so it
          describes the reading on screen, and it is what the SVG export carries. */}
      <p id="canvas-description" className="sr-only">
        {description}
      </p>
      {doc.model.shapes.length === 0 && !ui.presenting && <EmptyState />}
      <SelectionToolbar />
    </div>
  );
}
