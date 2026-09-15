import type { Connector, DiagramModel, Shape } from '@/lib/domain';
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

function withShapes(
  model: DiagramModel,
  shapes: Shape[],
  affected: Set<string>,
  routingModel: DiagramModel,
): DiagramModel {
  const routes =
    routingModel === model ? null : new Map(routingModel.connectors.map((c) => [c.id, c]));
  return {
    ...model,
    shapes,
    connectors: model.connectors.map((c) => ({
      ...c,
      waypoints:
        c.manual && (affected.has(c.sourceId) || affected.has(c.targetId))
          ? (routes?.get(c.id)?.waypoints ?? c.waypoints)
          : c.waypoints,
    })),
  };
}

/** The model as it would look mid-drag, without committing anything. */
export function previewDrag(
  model: DiagramModel,
  affected: Set<string>,
  dx: number,
  dy: number,
  routingModel = model,
): DiagramModel {
  if (!affected.size || (dx === 0 && dy === 0)) return model;
  const shapes = model.shapes.map((s) =>
    affected.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s,
  );
  // Named views resolve routes against base geometry on commit; preview must
  // use that same reference, not compound the view's existing displacement.
  const preview = withShapes(model, shapes, affected, routingModel);
  E.routeConnectorsFor(preview, affected, routingModel);
  return preview;
}

/** Marks the ids of shapes that exist only while a copy is being dragged. */
export const GHOST_PREFIX = 'ghost-';

/**
 * The model as it would look with a copy of `clone` dragged `dx, dy` away.
 *
 * The originals stay where they are; the copy is appended under ids that no
 * committed shape can have, so React keys and `data-shape-id` never collide
 * with the originals, and nothing that counts shapes counts the ghost. Its
 * internal connectors travel with it as they are: `pasteShapes` offsets them
 * the same way when the copy is made real — and, like it, the ghost arrives
 * unlocked, so no padlock is drawn on a copy that is still being placed.
 */
export function previewDuplicate(
  model: DiagramModel,
  clone: E.ClipboardPayload,
  dx: number,
  dy: number,
): DiagramModel {
  if (!clone.shapes.length || (dx === 0 && dy === 0)) return model;
  const ghostId = (id: string) => GHOST_PREFIX + id;
  const copied = new Set(clone.shapes.map((s) => s.id));
  return {
    ...model,
    shapes: [
      ...model.shapes,
      ...clone.shapes.map((s) => {
        const ghost = {
          ...s,
          id: ghostId(s.id),
          parentId: s.parentId && copied.has(s.parentId) ? ghostId(s.parentId) : s.parentId,
          x: s.x + dx,
          y: s.y + dy,
        };
        delete ghost.locked;
        return ghost;
      }),
    ],
    connectors: [
      ...model.connectors,
      ...clone.connectors.map((c) => ({
        ...c,
        id: ghostId(c.id),
        sourceId: ghostId(c.sourceId),
        targetId: ghostId(c.targetId),
        waypoints: c.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      })),
    ],
  };
}

/**
 * The model as it would look with one connector's line or label moved by the
 * hand that is still moving it. The route is shown as given — the ends are
 * put back on their faces only when the gesture ends and the route is set.
 */
export function previewConnector(
  model: DiagramModel,
  id: string,
  patch: Partial<Pick<Connector, 'waypoints' | 'labelAt'>>,
): DiagramModel {
  const index = model.connectors.findIndex((c) => c.id === id);
  if (index < 0) return model;
  const connectors = model.connectors.slice();
  connectors[index] = { ...connectors[index], ...patch };
  return { ...model, connectors };
}

/** The model as it would look mid-resize. */
export function previewResize(
  model: DiagramModel,
  id: string,
  w: number,
  h: number,
  routingModel = model,
): DiagramModel {
  const target = E.getShape(model, id);
  if (!target) return model;

  const shapes = model.shapes.map((s) => (s.id === id ? { ...s, w, h, manualSize: true } : s));
  const affected = E.collectDescendantIds(model, id);
  const preview = withShapes(model, shapes, affected, routingModel);

  const resized = E.getShape(preview, id);
  if (resized?.type === 'group') {
    // Relayout mutates the container and items, so those must be copies too.
    const descendants = E.collectDescendantIds(preview, id);
    preview.shapes = preview.shapes.map((s) =>
      s.id !== id && descendants.has(s.id) ? { ...s } : s,
    );
    E.relayoutGroup(preview, E.getShape(preview, id)!);
  }
  E.routeConnectorsFor(preview, affected, routingModel);
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
