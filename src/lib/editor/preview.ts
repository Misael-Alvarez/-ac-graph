import type { DiagramModel, Shape } from '@/lib/domain';
import * as E from '@/lib/engine';

/**
 * Cheap, throw-away models used while a pointer gesture is in flight.
 *
 * The original editor ran `JSON.parse(JSON.stringify(model))` on every
 * `mousemove`, then re-routed every connector and compared every pair of shapes.
 * These helpers copy only the shapes that actually moved and re-route only the
 * connectors attached to them, so the rest of the diagram is shared by reference.
 */

/** Shapes that move when `ids` are dragged: the selection plus all descendants. */
export function resolveDragSet(model: DiagramModel, ids: Iterable<string>): Set<string> {
  const affected = new Set<string>();
  for (const id of ids) {
    if (!E.getShape(model, id)) continue;
    for (const descendantId of E.collectDescendantIds(model, id)) affected.add(descendantId);
  }
  return affected;
}

function withShapes(model: DiagramModel, shapes: Shape[]): DiagramModel {
  return { ...model, shapes, connectors: model.connectors.map((c) => ({ ...c })) };
}

/** The model as it would look mid-drag, without committing anything. */
export function previewDrag(
  model: DiagramModel,
  affected: Set<string>,
  dx: number,
  dy: number,
): DiagramModel {
  if (!affected.size || (dx === 0 && dy === 0)) return model;
  const shapes = model.shapes.map((s) =>
    affected.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s,
  );
  const preview = withShapes(model, shapes);
  E.routeConnectorsFor(preview, affected);
  return preview;
}

/** The model as it would look mid-resize. */
export function previewResize(model: DiagramModel, id: string, w: number, h: number): DiagramModel {
  const target = E.getShape(model, id);
  if (!target) return model;

  const shapes = model.shapes.map((s) => (s.id === id ? { ...s, w, h, manualSize: true } : s));
  const preview = withShapes(model, shapes);

  const resized = E.getShape(preview, id);
  if (resized?.type === 'group') {
    // Relayout mutates the container and items, so those must be copies too.
    const descendants = E.collectDescendantIds(preview, id);
    preview.shapes = preview.shapes.map((s) =>
      s.id !== id && descendants.has(s.id) ? { ...s } : s,
    );
    E.relayoutGroup(preview, E.getShape(preview, id)!);
  }
  E.routeConnectorsFor(preview, E.collectDescendantIds(preview, id));
  return preview;
}

/**
 * Shapes a lasso rectangle picks up, ignoring containers.
 *
 * Touching is enough for everything but a region: a lasso drawn across the
 * services *on* a region is meant for the services, and would otherwise drag
 * the zone under them along on the next move. A region has to be enclosed.
 */
export function shapesInLasso(
  model: DiagramModel,
  box: { x: number; y: number; w: number; h: number },
): string[] {
  return model.shapes
    .filter((s) => {
      if (s.type === 'container') return false;
      if (s.type === 'region') return E.geometricallyContains(box, E.bbox(s));
      return E.rectsOverlap(E.bbox(s), box);
    })
    .map((s) => s.id);
}

/** Normalises two corner points into a positive-extent rectangle. */
export function normaliseBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}
