import type { DiagramModel, Shape } from '@/lib/domain';
import { CURRENT_SCHEMA_VERSION } from '@/lib/domain';
import { G } from './constants';
import { uid } from './ids';

/**
 * Shape lookup index.
 *
 * The original engine kept a module-level `idIndex` that callers had to
 * `reindex()` by hand before every read; forgetting one call silently returned
 * shapes from a stale model. Here the index is derived from the model itself and
 * cached against the identity of `model.shapes`, so it can never disagree with
 * the model it describes and two diagrams can be open at once.
 */
const indexCache = new WeakMap<Shape[], Map<string, Shape>>();

export function shapeIndex(model: DiagramModel): Map<string, Shape> {
  const cached = indexCache.get(model.shapes);
  // A different array identity, or a push/splice on the same array, invalidates.
  // Shapes are only ever mutated in place, never swapped, so size is sufficient.
  if (cached && cached.size === model.shapes.length) return cached;
  const idx = new Map<string, Shape>();
  for (const s of model.shapes) idx.set(s.id, s);
  indexCache.set(model.shapes, idx);
  return idx;
}

export function getShape(model: DiagramModel, id: string): Shape | undefined {
  return shapeIndex(model).get(id);
}

export function children(model: DiagramModel, parentId: string): Shape[] {
  return model.shapes.filter((s) => s.parentId === parentId);
}

export function isAncestor(model: DiagramModel, id: string, ancestorId: string): boolean {
  let s = getShape(model, id);
  while (s && s.parentId) {
    if (s.parentId === ancestorId) return true;
    s = getShape(model, s.parentId);
  }
  return false;
}

export function isRelated(model: DiagramModel, a: string, b: string): boolean {
  return a === b || isAncestor(model, b, a) || isAncestor(model, a, b);
}

export function collectDescendantIds(model: DiagramModel, rootId: string): Set<string> {
  const set = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of model.shapes) {
      if (s.parentId && set.has(s.parentId) && !set.has(s.id)) {
        set.add(s.id);
        changed = true;
      }
    }
  }
  return set;
}

/** Every service symbol a diagram references, for building a minimal sprite. */
export function iconKeysIn(model: DiagramModel): string[] {
  const keys = new Set<string>();
  for (const shape of model.shapes) {
    if (shape.icon?.kind === 'symbol') keys.add(shape.icon.key);
  }
  return [...keys];
}

export function createEmptyModel(): DiagramModel {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: { w: 3000, h: 2000 },
    shapes: [],
    connectors: [],
    showFooter: false,
    views: [],
  };
}

export function cloneModel(model: DiagramModel): DiagramModel {
  return structuredClone(model);
}

/* ── sizing ─────────────────────────────────────────────── */

export function containerH(n: number, wide: boolean): number {
  const count = Math.max(n, 1);
  return wide ? 142 * count - 18 : 106 * count + 18;
}

export function groupHFromContainer(ch: number): number {
  return ch + G.GROUP_BOTTOM_EXTRA;
}

/** Repositions a group's container and its stacked items after any structural change. */
export function relayoutGroup(model: DiagramModel, group: Shape): void {
  const container = children(model, group.id).find((s) => s.type === 'container');
  if (!container) return;
  const items = children(model, container.id)
    .filter((s) => s.type === 'item')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const wide = container.stacked_gap === 'wide';
  const pitch = wide ? G.PITCH_WIDE : G.PITCH_TIGHT;
  const chAuto = containerH(items.length, wide);
  if (!group.manualSize) group.h = groupHFromContainer(chAuto);
  container.x = group.x + G.CONTAINER_DX;
  container.y = group.y + G.CONTAINER_DY;
  container.w = group.w - G.CONTAINER_MARGIN_R;
  container.h = group.manualSize ? Math.max(group.h - G.GROUP_BOTTOM_EXTRA, 60) : chAuto;
  items.forEach((it, idx) => {
    it.x = container.x + G.ITEM_DX;
    it.y = container.y + G.ITEM_DY + idx * pitch;
    it.w = container.w - G.ITEM_MARGIN_R;
    it.h = G.ITEM_H;
  });
}

/* ── creation ───────────────────────────────────────────── */

export function addBoundary(
  model: DiagramModel,
  x: number,
  y: number,
  variant: 'outer' | 'sub',
): Shape {
  const s: Shape = {
    id: uid('bd'),
    type: 'boundary',
    parentId: null,
    x,
    y,
    w: variant === 'outer' ? 1000 : 520,
    h: variant === 'outer' ? 650 : 340,
    variant,
    title: variant === 'outer' ? 'Cloud Environment' : 'Sub-boundary',
    note: '',
    /* No icon. A boundary is a place, not a service, and this defaulted to
       `gcp-cloudrun` — so every zone anybody drew, and every namespace an import
       produced, claimed to be Google Cloud Run and took its blue. The inspector
       and the DSL's `service:` both set one where the reader means it. */
  };
  model.shapes.push(s);
  return s;
}

export function addGroup(model: DiagramModel, x: number, y: number): Shape {
  const group: Shape = {
    id: uid('grp'),
    type: 'group',
    parentId: null,
    x,
    y,
    w: 470,
    h: 208,
    manualSize: false,
    title: 'New Group',
  };
  model.shapes.push(group);
  const container: Shape = {
    id: uid('ctr'),
    type: 'container',
    parentId: group.id,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    stacked_gap: 'tight',
  };
  model.shapes.push(container);
  const item: Shape = {
    id: uid('itm'),
    type: 'item',
    parentId: container.id,
    x: 0,
    y: 0,
    w: 0,
    h: G.ITEM_H,
    order: 0,
    icon: { kind: 'symbol', key: 'gcp-vertexai' },
    title: 'New Item',
    subtitle: 'Subtitle',
    note: '',
  };
  model.shapes.push(item);
  relayoutGroup(model, group);
  return group;
}

export function addItemToContainer(model: DiagramModel, containerId: string): Shape | null {
  const container = getShape(model, containerId);
  if (!container || container.type !== 'container') return null;
  const siblings = children(model, containerId).filter((s) => s.type === 'item');
  const maxOrder = siblings.reduce((m, s) => Math.max(m, s.order ?? 0), -1);
  const item: Shape = {
    id: uid('itm'),
    type: 'item',
    parentId: containerId,
    x: 0,
    y: 0,
    w: 0,
    h: G.ITEM_H,
    order: maxOrder + 1,
    icon: { kind: 'symbol', key: 'gcp-vertexai' },
    title: 'New Item',
    subtitle: 'Subtitle',
    note: '',
  };
  model.shapes.push(item);
  const group = container.parentId ? getShape(model, container.parentId) : undefined;
  if (group) relayoutGroup(model, group);
  return item;
}

/* ── mutation ───────────────────────────────────────────── */

/**
 * Drops shapes from every view that mentions them.
 *
 * Lives here rather than in `views` so that module can keep depending on this
 * one and not the other way round. It needs nothing from it: a view's `include`
 * and `place` are plain lists of ids.
 */
export function forgetShapeInViews(model: DiagramModel, shapeIds: Iterable<string>): void {
  const gone = new Set(shapeIds);
  if (!gone.size) return;

  for (const view of model.views) {
    if (view.include) {
      const kept = view.include.filter((id) => !gone.has(id));
      if (kept.length !== view.include.length) view.include = kept;
    }
    if (view.place) {
      for (const id of gone) delete view.place[id];
    }
  }
}

export function deleteShape(model: DiagramModel, id: string): void {
  const s = getShape(model, id);
  if (!s) return;
  const toRemove = collectDescendantIds(model, id);
  const parentId = s.parentId;
  model.shapes = model.shapes.filter((sh) => !toRemove.has(sh.id));
  // Here rather than in the reducer so that every caller — clipboard, DSL
  // recompile, cloud switch — gets it, instead of only the one that remembered.
  forgetShapeInViews(model, toRemove);
  model.connectors = model.connectors.filter(
    (c) => !toRemove.has(c.sourceId) && !toRemove.has(c.targetId),
  );
  if (!parentId) return;
  const parent = getShape(model, parentId);
  if (parent?.type === 'container' && parent.parentId) {
    const group = getShape(model, parent.parentId);
    if (group) relayoutGroup(model, group);
  }
}

export function reorderItem(model: DiagramModel, itemId: string, dir: number): void {
  const item = getShape(model, itemId);
  if (!item?.parentId) return;
  const siblings = children(model, item.parentId)
    .filter((s) => s.type === 'item')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = siblings.indexOf(item);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;
  const tmp = item.order;
  item.order = siblings[swapIdx].order;
  siblings[swapIdx].order = tmp;
  const container = getShape(model, item.parentId);
  if (container?.parentId) {
    const group = getShape(model, container.parentId);
    if (group) relayoutGroup(model, group);
  }
}
