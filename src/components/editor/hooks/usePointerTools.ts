'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramModel, Point } from '@/lib/domain';
import * as E from '@/lib/engine';
import type { AlignGuide } from '@/lib/engine';
import {
  normaliseBox,
  previewConnector,
  previewDrag,
  previewResize,
  resolveDragSet,
  shapesInLasso,
} from '@/lib/editor/preview';
import { pan, toCanvas, type Viewport } from '@/lib/editor/viewport';
import { labelAnchor, positionAlong } from '@/lib/editor/connectorPath';

export type Interaction =
  | {
      kind: 'drag';
      ids: string[];
      affected: Set<string>;
      origin: Point;
      /** Where the gesture started on screen, so the threshold below means the
          same distance at every zoom level. */
      originScreen: Point;
      /** Whether the pointer has gone far enough for this to be a drag at all. */
      moved: boolean;
      dx: number;
      dy: number;
      guides: AlignGuide[];
    }
  | {
      kind: 'resize';
      id: string;
      origin: Point;
      startW: number;
      startH: number;
      w: number;
      h: number;
    }
  | {
      kind: 'bend';
      id: string;
      index: number;
      origin: Point;
      originScreen: Point;
      start: Point[];
      waypoints: Point[];
      moved: boolean;
    }
  | {
      kind: 'label';
      id: string;
      origin: Point;
      originScreen: Point;
      anchor: Point;
      waypoints: Point[];
      labelAt: number;
      moved: boolean;
    }
  | { kind: 'lasso'; origin: Point; current: Point }
  | { kind: 'pan'; originScreen: Point; startViewport: Viewport }
  | null;

interface Options {
  model: DiagramModel;
  routingModel: DiagramModel;
  viewport: Viewport;
  gridSnap: boolean;
  selectedIds: Set<string>;
  onMoveShapes: (ids: string[], dx: number, dy: number) => void;
  onResizeShape: (id: string, w: number, h: number) => void;
  onSetConnectorRoute: (id: string, waypoints: Point[]) => void;
  onSetConnectorLabel: (id: string, labelAt: number) => void;
  onLassoSelect: (ids: string[]) => void;
  onViewportChange: (viewport: Viewport) => void;
  /** Screen coordinates relative to the canvas element. */
  toLocal: (e: { clientX: number; clientY: number }) => Point;
  /** Drags and resizes never start; lasso and pan still do. */
  readOnly?: boolean;
}

const MIN_SHAPE_W = 120;
const MIN_SHAPE_H = 60;
/**
 * Below this a drag is treated as a click, so a sloppy click never nudges a
 * shape. Screen pixels: a hand is no steadier when the canvas is zoomed out.
 */
const DRAG_THRESHOLD = 3;

export function usePointerTools({
  model,
  routingModel,
  viewport,
  gridSnap,
  selectedIds,
  onMoveShapes,
  onResizeShape,
  onSetConnectorRoute,
  onSetConnectorLabel,
  onLassoSelect,
  onViewportChange,
  toLocal,
  readOnly = false,
}: Options) {
  const [interaction, setInteraction] = useState<Interaction>(null);

  /**
   * The gesture's own copy of its state, written synchronously.
   *
   * React state alone is not enough here: `pointerup` can arrive before React
   * has committed the last `pointermove` frame, and reading a state value that
   * is one render behind would drop the final part of the drag — or the whole
   * drag, for a fast flick.
   */
  const interactionRef = useRef<Interaction>(null);

  const applyInteraction = useCallback((next: Interaction) => {
    interactionRef.current = next;
    setInteraction(next);
  }, []);

  const updateInteraction = useCallback(
    (updater: (current: NonNullable<Interaction>) => Interaction) => {
      const current = interactionRef.current;
      if (!current) return;
      const next = updater(current);
      interactionRef.current = next;
      setInteraction(next);
    },
    [],
  );

  // Model, viewport and settings cannot change mid-gesture, so reading them one
  // render behind is harmless; they live in a ref only to keep the window
  // listeners from re-subscribing on every frame.
  const latest = useRef({ model, viewport, gridSnap, toLocal, readOnly });
  useEffect(() => {
    latest.current = { model, viewport, gridSnap, toLocal, readOnly };
  });

  const frame = useRef<number | null>(null);
  const pending = useRef<Point | null>(null);

  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = null;
  };

  useEffect(() => cancelFrame, []);

  const applyMove = useCallback(() => {
    frame.current = null;
    const screen = pending.current;
    const current = interactionRef.current;
    if (!screen || !current) return;

    if (current.kind === 'pan') {
      onViewportChange(
        pan(
          current.startViewport,
          screen.x - current.originScreen.x,
          screen.y - current.originScreen.y,
        ),
      );
      return;
    }

    const point = toCanvas(latest.current.viewport, screen);

    updateInteraction((state) => {
      switch (state.kind) {
        case 'drag': {
          // Until the pointer has travelled far enough, the gesture is still a
          // click: nothing moves and nothing is previewed. Snapping made this
          // matter — a two-pixel wobble was enough to pull a shape onto the
          // grid or onto a neighbour's edge, and the move was then committed.
          if (
            !state.moved &&
            Math.abs(screen.x - state.originScreen.x) <= DRAG_THRESHOLD &&
            Math.abs(screen.y - state.originScreen.y) <= DRAG_THRESHOLD
          ) {
            return state;
          }
          const anchor = E.getShape(latest.current.model, state.ids[0]);
          if (!anchor) return state;
          let nextX = anchor.x + (point.x - state.origin.x);
          let nextY = anchor.y + (point.y - state.origin.y);

          const { guides, snapX, snapY } = E.computeAlignGuides(
            latest.current.model,
            anchor.id,
            nextX,
            nextY,
            anchor.w,
            anchor.h,
          );
          if (snapX !== null) nextX = snapX;
          if (snapY !== null) nextY = snapY;
          if (latest.current.gridSnap) {
            nextX = E.snapToGrid(nextX);
            nextY = E.snapToGrid(nextY);
          }
          return { ...state, moved: true, dx: nextX - anchor.x, dy: nextY - anchor.y, guides };
        }
        case 'resize': {
          const w = Math.max(MIN_SHAPE_W, state.startW + (point.x - state.origin.x));
          const h = Math.max(MIN_SHAPE_H, state.startH + (point.y - state.origin.y));
          return { ...state, w, h };
        }
        case 'bend':
        case 'label': {
          if (
            !state.moved &&
            Math.abs(screen.x - state.originScreen.x) <= DRAG_THRESHOLD &&
            Math.abs(screen.y - state.originScreen.y) <= DRAG_THRESHOLD
          ) {
            return state;
          }
          const dx = point.x - state.origin.x;
          const dy = point.y - state.origin.y;
          if (state.kind === 'label') {
            return {
              ...state,
              moved: true,
              labelAt: positionAlong(state.waypoints, {
                x: state.anchor.x + dx,
                y: state.anchor.y + dy,
              }),
            };
          }
          const start = state.start[state.index];
          const snap = (n: number) => (latest.current.gridSnap ? E.snapToGrid(n) : n);
          const waypoints = state.start.map((p, i) =>
            i === state.index ? { x: snap(start.x + dx), y: snap(start.y + dy) } : p,
          );
          return { ...state, moved: true, waypoints };
        }
        case 'lasso':
          return { ...state, current: point };
        default:
          return state;
      }
    });
  }, [onViewportChange, updateInteraction]);

  const queueMove = useCallback(
    (screen: Point) => {
      pending.current = screen;
      // Coalescing to one update per frame is what keeps a drag at 60fps; the
      // old handler ran a full model clone on every single pointer event.
      if (frame.current === null) frame.current = requestAnimationFrame(applyMove);
    },
    [applyMove],
  );

  const finish = useCallback(
    (screen: Point) => {
      // Pointer-up can beat the queued animation frame. Commit its final position,
      // not the last frame React happened to paint.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      pending.current = screen;
      applyMove();
      cancelFrame();
      const current = interactionRef.current;
      applyInteraction(null);
      if (!current || (latest.current.readOnly && current.kind !== 'lasso')) return;

      switch (current.kind) {
        case 'drag':
          if (current.moved && (current.dx !== 0 || current.dy !== 0)) {
            // One action for the whole gesture, so one undo step.
            onMoveShapes(current.ids, current.dx, current.dy);
          }
          break;
        case 'resize':
          if (current.w !== current.startW || current.h !== current.startH) {
            onResizeShape(current.id, current.w, current.h);
          }
          break;
        case 'bend':
          if (
            current.moved &&
            current.waypoints.some(
              (p, i) => p.x !== current.start[i].x || p.y !== current.start[i].y,
            )
          )
            onSetConnectorRoute(current.id, current.waypoints);
          break;
        case 'label':
          if (current.moved) onSetConnectorLabel(current.id, current.labelAt);
          break;
        case 'lasso': {
          const box = normaliseBox(current.origin, current.current);
          // The box is in canvas units, the threshold in screen pixels.
          const minimum = DRAG_THRESHOLD / latest.current.viewport.zoom;
          if (box.w > minimum && box.h > minimum) {
            onLassoSelect(shapesInLasso(latest.current.model, box));
          }
          break;
        }
        default:
          break;
      }
    },
    [
      onMoveShapes,
      onResizeShape,
      onSetConnectorRoute,
      onSetConnectorLabel,
      onLassoSelect,
      applyInteraction,
      applyMove,
    ],
  );

  const cancel = useCallback(() => {
    cancelFrame();
    applyInteraction(null);
  }, [applyInteraction]);

  useEffect(() => {
    if (!interaction) return;
    const onMove = (e: PointerEvent) => queueMove(latest.current.toLocal(e));
    const onUp = (e: PointerEvent) => finish(latest.current.toLocal(e));
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', onEscape, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', onEscape, true);
    };
  }, [interaction, queueMove, finish, cancel]);

  const startDrag = useCallback(
    (e: { clientX: number; clientY: number }, id: string) => {
      // A viewer selects and pans; nothing on the canvas moves under their pointer.
      if (readOnly) return;
      const shape = E.getShape(model, id);
      if (!shape) return;
      // Dragging an unselected shape moves just that shape.
      const ids = selectedIds.has(id) ? [id, ...[...selectedIds].filter((x) => x !== id)] : [id];
      const screen = toLocal(e);
      applyInteraction({
        kind: 'drag',
        ids,
        affected: resolveDragSet(model, ids),
        origin: toCanvas(viewport, screen),
        originScreen: screen,
        moved: false,
        dx: 0,
        dy: 0,
        guides: [],
      });
    },
    [model, selectedIds, viewport, toLocal, applyInteraction, readOnly],
  );

  const startResize = useCallback(
    (e: { clientX: number; clientY: number }, id: string) => {
      if (readOnly) return;
      const shape = E.getShape(model, id);
      if (!shape) return;
      applyInteraction({
        kind: 'resize',
        id,
        origin: toCanvas(viewport, toLocal(e)),
        startW: shape.w,
        startH: shape.h,
        w: shape.w,
        h: shape.h,
      });
    },
    [model, viewport, toLocal, applyInteraction, readOnly],
  );

  const startBend = (e: { clientX: number; clientY: number }, id: string, index: number) => {
    if (readOnly) return;
    const c = model.connectors.find((c) => c.id === id);
    if (!c || index < 1 || index >= c.waypoints.length - 1) return;
    const screen = toLocal(e);
    applyInteraction({
      kind: 'bend',
      id,
      index,
      origin: toCanvas(viewport, screen),
      originScreen: screen,
      start: c.waypoints,
      waypoints: c.waypoints,
      moved: false,
    });
  };

  const startLabel = (e: { clientX: number; clientY: number }, id: string) => {
    if (readOnly) return;
    const c = model.connectors.find((c) => c.id === id);
    if (!c) return;
    const anchor = labelAnchor(c.waypoints, c.labelAt);
    if (!anchor) return;
    const screen = toLocal(e);
    applyInteraction({
      kind: 'label',
      id,
      anchor,
      origin: toCanvas(viewport, screen),
      originScreen: screen,
      waypoints: c.waypoints,
      labelAt: c.labelAt ?? positionAlong(c.waypoints, anchor),
      moved: false,
    });
  };

  const startLasso = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const point = toCanvas(viewport, toLocal(e));
      applyInteraction({ kind: 'lasso', origin: point, current: point });
    },
    [viewport, toLocal, applyInteraction],
  );

  const startPan = useCallback(
    (e: { clientX: number; clientY: number }) => {
      applyInteraction({ kind: 'pan', originScreen: toLocal(e), startViewport: viewport });
    },
    [viewport, toLocal, applyInteraction],
  );

  /** The model to paint: the committed one, or a throw-away gesture preview. */
  const previewModel = useMemo(() => {
    if (interaction?.kind === 'drag') {
      return previewDrag(model, interaction.affected, interaction.dx, interaction.dy, routingModel);
    }
    if (interaction?.kind === 'resize') {
      return previewResize(model, interaction.id, interaction.w, interaction.h, routingModel);
    }
    if (interaction?.kind === 'bend' && interaction.moved) {
      return previewConnector(model, interaction.id, { waypoints: interaction.waypoints });
    }
    if (interaction?.kind === 'label' && interaction.moved) {
      return previewConnector(model, interaction.id, { labelAt: interaction.labelAt });
    }
    return model;
  }, [model, interaction, routingModel]);

  const lassoBox = useMemo(
    () =>
      interaction?.kind === 'lasso' ? normaliseBox(interaction.origin, interaction.current) : null,
    [interaction],
  );

  return {
    interaction,
    previewModel,
    lassoBox,
    guides: interaction?.kind === 'drag' ? interaction.guides : [],
    startDrag,
    startResize,
    startBend,
    startLabel,
    startLasso,
    startPan,
  };
}
