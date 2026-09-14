import type { BBox, DiagramModel, Shape, View } from '@/lib/domain';
import { children, collectDescendantIds, getShape } from './model';
import { bbox, geometricallyContains } from './geometry';
import { routeAllConnectors, routeConnectorsFor } from './routing';
import { uid } from './ids';

/**
 * Reading one view of an architecture.
 *
 * The model is a graph; a view is a reading of it. The trick that keeps this
 * cheap is that a reading is *itself a model*: `resolveView` returns an ordinary
 * `DiagramModel` holding only the shapes the view includes, with the geometry
 * already resolved. Everything downstream — the canvas, the SVG renderer, the
 * thumbnail, the share codec, the DSL serialiser, the analysis engine — keeps
 * taking a `DiagramModel` and never learns that views exist.
 *
 * The alternative was to teach every one of those a second concept. This way the
 * concept lives here, in pure functions, and the rest of the app reads a model
 * like it always did.
 */

/** The id every diagram's first view carries, including one that has none yet. */
export const MAIN_VIEW_ID = 'view_main';

export function newViewId(): string {
  return uid('view');
}

/**
 * The implicit view over an entire model.
 *
 * A diagram written before views existed has none, and a diagram nobody ever
 * split still has none. Rather than migrate every stored model to hold one
 * do-nothing view, absence is read as this: everything included, nothing moved.
 */
export function defaultView(): View {
  return { id: MAIN_VIEW_ID, name: '', kind: 'free' };
}

/** Every view of a model, with the implicit main view standing in for none. */
export function viewsOf(model: DiagramModel): View[] {
  return model.views.length ? model.views : [defaultView()];
}

export function getView(model: DiagramModel, viewId: string | null): View {
  if (!viewId) return viewsOf(model)[0];
  return model.views.find((v) => v.id === viewId) ?? viewsOf(model)[0];
}

/**
 * True for the first reading. With multiple views even this reading writes
 * placements, so changing its layout cannot move another view implicitly.
 */
export function isMainView(model: DiagramModel, viewId: string | null): boolean {
  return getView(model, viewId).id === viewsOf(model)[0].id;
}

/** Where a shape sits in a view: its override if it has one, else its own box. */
export function placementOf(view: View, shape: Shape): Pick<Shape, 'x' | 'y' | 'w' | 'h'> {
  return view.place?.[shape.id] ?? { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
}

/**
 * Whether a view shows a shape.
 *
 * An absent `include` means the whole model, which is what a view that has never
 * been narrowed means. A listed shape brings its descendants with it: a group
 * is only ever meaningful with the container and items inside it, and asking an
 * author to tick all three would be asking them to know how the renderer works.
 */
function includedIds(model: DiagramModel, view: View): Set<string> | null {
  if (!view.include) return null;

  const ids = new Set<string>();
  for (const id of view.include) {
    ids.add(id);
    for (const descendant of collectDescendantIds(model, id)) ids.add(descendant);
  }
  return ids;
}

/**
 * One view of a model, as a model.
 *
 * Connectors survive only when both ends do: an arrow to a service the view does
 * not show would be drawn pointing at nothing.
 */
export function resolveView(model: DiagramModel, viewId: string | null): DiagramModel {
  const view = getView(model, viewId);
  const keep = includedIds(model, view);
  const hasOverrides = Boolean(view.place && Object.keys(view.place).length);

  // Nothing narrowed and nothing moved: the view *is* the model. Returning it
  // untouched keeps the identity check in React's memos meaningful, so an
  // unsplit diagram re-renders exactly as often as it did before.
  if (!keep && !hasOverrides) return model;

  const shapes: Shape[] = [];
  for (const shape of model.shapes) {
    if (keep && !keep.has(shape.id)) continue;
    const place = view.place?.[shape.id];
    shapes.push(
      place || (hasOverrides && shape.type === 'item')
        ? { ...shape, ...place, ...(place && shape.type === 'group' ? { manualSize: true } : {}) }
        : shape,
    );
  }

  const visible = new Set(shapes.map((s) => s.id));
  const connectors = model.connectors
    .filter((c) => visible.has(c.sourceId) && visible.has(c.targetId))
    // Copied before routing below, which mutates: these objects still belong to
    // the model this view is a reading of.
    .map((c) => ({ ...c }));

  const resolved = { ...model, shapes, connectors };
  if (hasOverrides) {
    // Stack order is geometric in a view. Derive it on the copied items so
    // layout and routing agree without changing the shared model's order.
    for (const shape of shapes) {
      if (shape.type !== 'container') continue;
      children(resolved, shape.id)
        .filter((s) => s.type === 'item')
        .sort((a, b) => a.y - b.y)
        .forEach((item, order) => {
          item.order = order;
        });
    }
  }

  // Routes are not stored per view. A view that moved a shape simply re-routes
  // — the router redraws its own lines and re-anchors the author's — rather
  // than carrying a second set of routes per view, which would be state to
  // store, migrate and keep in sync for no gain.
  if (keep || hasOverrides) routeAllConnectors(resolved, model);

  return resolved;
}

/**
 * Writes where a shape sits in one view, seeded from wherever it sits now.
 *
 * An unsplit diagram still writes base geometry; split diagrams write placements
 * in the active view only, including the main view.
 */
export function setPlacement(view: View, shape: Shape, patch: Partial<BBox>): void {
  const current = placementOf(view, shape);
  view.place ??= {};
  view.place[shape.id] = { ...current, ...patch };
}

/** Run the ordinary layout engine on a detached reading, then commit only its layout. */
export function editViewGeometry(
  model: DiagramModel,
  viewId: string | null,
  drillPath: string[],
  edit: (reading: DiagramModel) => void,
): void {
  const view = getView(model, viewId);
  const resolved = focusSubtree(resolveView(model, viewId), drillPath);
  const before = { ...resolved, shapes: resolved.shapes.map((s) => ({ ...s })) };
  const local = model.views.length > 1 || Boolean(view.place);
  const reading = {
    ...before,
    shapes: before.shapes.map((s) => ({ ...s })),
    connectors: before.connectors.map((c) => ({ ...c })),
  };
  edit(reading);

  const changed = new Set<string>();
  for (const after of reading.shapes) {
    const previous = getShape(before, after.id);
    const shape = getShape(model, after.id);
    if (!previous || !shape) continue;
    if (
      after.x !== previous.x ||
      after.y !== previous.y ||
      after.w !== previous.w ||
      after.h !== previous.h
    ) {
      if (local) setPlacement(view, shape, bbox(after));
      else Object.assign(shape, bbox(after));
      changed.add(shape.id);
    }
    if (!local) {
      if (after.manualSize !== previous.manualSize) shape.manualSize = after.manualSize;
      if (after.order !== previous.order) shape.order = after.order;
    }
  }
  if (!local && changed.size) routeConnectorsFor(model, changed, before);
}

/**
 * A resolved reading safe to send on its own. Do not spread the source model:
 * other views and document rules can name hidden services. Visible content and
 * metadata remain intact; only structural references outside the reading go.
 */
export function projectView(reading: DiagramModel): DiagramModel {
  const visible = new Set(reading.shapes.map((s) => s.id));
  const projected: DiagramModel = {
    schemaVersion: reading.schemaVersion,
    canvas: { ...reading.canvas },
    showFooter: reading.showFooter,
    views: [],
    shapes: reading.shapes.map((s) => ({
      ...s,
      parentId: s.parentId && visible.has(s.parentId) ? s.parentId : null,
    })),
    connectors: reading.connectors
      .filter((c) => visible.has(c.sourceId) && visible.has(c.targetId))
      // The router's lines are redrawn from the shapes; the author's are kept
      // and only re-anchored, which is what `routeConnector` does with them.
      .map((c) => ({ ...c, waypoints: c.manual ? c.waypoints : [] })),
  };
  routeAllConnectors(projected);
  return projected;
}

/**
 * Everything a shape holds: its children, and — for a boundary — whatever sits
 * inside it on the canvas.
 *
 * A boundary is not a parent. It has no `parentId` claim on the groups it
 * surrounds; membership is geometric, which is the same rule the serialiser uses
 * to decide a node's `in:`. So containment has to be asked two ways, or drilling
 * into a cloud boundary would show an empty rectangle.
 */
function containedIds(model: DiagramModel, rootId: string): Set<string> {
  const ids = collectDescendantIds(model, rootId);
  const root = model.shapes.find((s) => s.id === rootId);
  if (!root || root.type !== 'boundary') return ids;

  const outer = bbox(root);
  for (const shape of model.shapes) {
    if (shape.id === rootId) continue;
    if (!geometricallyContains(outer, bbox(shape))) continue;
    // A sub-boundary inside this one belongs here, but so does everything it in
    // turn holds — otherwise its groups would vanish one level too early.
    for (const id of collectDescendantIds(model, shape.id)) ids.add(id);
  }
  return ids;
}

/**
 * Zooming in, in the sense the reader means it.
 *
 * The complaint the study calls the central one is not that lines are ugly; it
 * is a diagram that says everything at once. Drilling narrows to one branch and
 * its contents, so a reader descends organisation → domain → system the way they
 * descend a map, instead of opening `diagram-payments-v4`.
 *
 * `path` is the trail of shapes drilled through. Only its last entry decides
 * what is shown; the rest is the breadcrumb's, so going back up is a `pop`.
 */
export function focusSubtree(model: DiagramModel, path: string[]): DiagramModel {
  const rootId = path[path.length - 1];
  if (!rootId) return model;

  const root = model.shapes.find((s) => s.id === rootId);
  if (!root) return model;

  const keep = containedIds(model, rootId);
  const shapes = model.shapes.filter((s) => keep.has(s.id));
  if (shapes.length === model.shapes.length) return model;

  const visible = new Set(shapes.map((s) => s.id));
  const focused = {
    ...model,
    shapes,
    connectors: model.connectors
      .filter((c) => visible.has(c.sourceId) && visible.has(c.targetId))
      .map((c) => ({ ...c })),
  };
  routeAllConnectors(focused);
  return focused;
}

/** Whether drilling into a shape would show anything, so the canvas can offer it. */
export function canDrillInto(model: DiagramModel, shapeId: string): boolean {
  const shape = model.shapes.find((s) => s.id === shapeId);
  if (!shape) return false;
  if (shape.type !== 'boundary' && shape.type !== 'group') return false;
  const inside = containedIds(model, shapeId);
  // Itself plus a container plus one item is a group holding a single service:
  // there is nothing below it worth a level of its own.
  return inside.size > 3 && inside.size < model.shapes.length;
}
