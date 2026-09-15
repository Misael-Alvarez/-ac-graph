import type { DiagramModel, Shape } from '@/lib/domain';
import { isDecorative } from '@/lib/domain';
import { ALIGN_SNAP_DIST } from './constants';
import { contentBBox } from './geometry';
import { collectDescendantIds, getShape, relayoutGroup } from './model';
import { routeAllConnectors } from './routing';

/**
 * Layered auto-layout.
 *
 * Groups are the layout unit; connectors between their items induce the edges.
 * A Kahn topological sort assigns layers, cycles fall through to a trailing row.
 * A locked group or boundary stays exactly where it is: it takes no place in
 * the layers and is not refitted around them.
 */
export function autoLayout(model: DiagramModel): void {
  const topGroups = model.shapes.filter((s) => s.type === 'group' && !s.locked);
  const boundaries = model.shapes.filter((s) => s.type === 'boundary' && !s.locked);

  const adj = new Map<string, Set<string>>();
  const inDeg = new Map<string, number>();
  const groupOfItem = new Map<string, string>();

  for (const s of model.shapes) {
    if (s.type === 'item' && s.parentId) {
      const container = getShape(model, s.parentId);
      if (container?.parentId) groupOfItem.set(s.id, container.parentId);
    }
  }

  for (const g of topGroups) {
    adj.set(g.id, new Set());
    inDeg.set(g.id, 0);
  }

  for (const c of model.connectors) {
    const sg = groupOfItem.get(c.sourceId) ?? c.sourceId;
    const tg = groupOfItem.get(c.targetId) ?? c.targetId;
    if (sg !== tg && adj.has(sg)) {
      adj.get(sg)!.add(tg);
      inDeg.set(tg, (inDeg.get(tg) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  const layers: string[][] = [];
  for (const g of topGroups) if ((inDeg.get(g.id) ?? 0) === 0) queue.push(g.id);

  while (queue.length) {
    const layer = [...queue];
    layers.push(layer);
    queue.length = 0;
    for (const id of layer) {
      for (const next of adj.get(id) ?? []) {
        const d = (inDeg.get(next) ?? 1) - 1;
        inDeg.set(next, d);
        if (d === 0) queue.push(next);
      }
    }
  }

  // Groups inside a cycle never reach in-degree zero; park them in a final row.
  const placed = new Set(layers.flat());
  const unplaced = topGroups.filter((g) => !placed.has(g.id));
  if (unplaced.length) layers.push(unplaced.map((g) => g.id));

  const GAP_X = 100;
  const GAP_Y = 80;
  let y = 80;
  for (const layer of layers) {
    let x = 80;
    let maxH = 0;
    for (const id of layer) {
      const g = getShape(model, id);
      if (!g) continue;
      const dx = x - g.x;
      const dy = y - g.y;
      g.x = x;
      g.y = y;
      const desc = collectDescendantIds(model, g.id);
      desc.delete(g.id);
      for (const s of model.shapes) {
        if (desc.has(s.id)) {
          s.x += dx;
          s.y += dy;
        }
      }
      relayoutGroup(model, g);
      x += g.w + GAP_X;
      maxH = Math.max(maxH, g.h);
    }
    y += maxH + GAP_Y;
  }

  if (boundaries.length) {
    // Around the architecture only: a note parked in a corner is not something
    // a cloud boundary should stretch to enclose.
    const bb = contentBBox({ ...model, shapes: model.shapes.filter((s) => !isDecorative(s)) });
    boundaries.forEach((b, i) => {
      b.x = bb.x - 40 - i * 20;
      b.y = bb.y - 60 - i * 20;
      b.w = bb.w + 80 + i * 40;
      b.h = bb.h + 120 + i * 40;
    });
  }

  routeAllConnectors(model);
}

export interface AlignGuide {
  axis: 'x' | 'y';
  pos: number;
}

export interface AlignResult {
  guides: AlignGuide[];
  snapX: number | null;
  snapY: number | null;
}

/**
 * The shapes a moving edge may line up with: everything but the containers
 * and whatever travels with the shape itself.
 *
 * Skipping only the direct children was not enough: a group's items hang off
 * its container, so a dragged group found its own item centred inside it,
 * snapped to it, and could not be moved by less than the snap distance at
 * all — while drawing a guide against a shape that was moving with it. An id
 * the model does not have excludes nothing, which is what a copy being
 * dragged off its original wants: the original is a neighbour like any other.
 */
function alignmentCandidates(model: DiagramModel, movingId: string): Shape[] {
  const moving = collectDescendantIds(model, movingId);
  return model.shapes.filter((s) => !moving.has(s.id) && s.type !== 'container');
}

/** Edge- and centre-alignment guides for a shape being dragged to (dragX, dragY). */
export function computeAlignGuides(
  model: DiagramModel,
  dragId: string,
  dragX: number,
  dragY: number,
  dragW: number,
  dragH: number,
): AlignResult {
  const guides: AlignGuide[] = [];
  let snapX: number | null = null;
  let snapY: number | null = null;

  const dragCX = dragX + dragW / 2;
  const dragCY = dragY + dragH / 2;
  const dragR = dragX + dragW;
  const dragB = dragY + dragH;

  for (const s of alignmentCandidates(model, dragId)) {
    const sCX = s.x + s.w / 2;
    const sCY = s.y + s.h / 2;
    const sR = s.x + s.w;
    const sB = s.y + s.h;

    if (Math.abs(dragX - s.x) < ALIGN_SNAP_DIST) {
      snapX = s.x;
      guides.push({ axis: 'x', pos: s.x });
    }
    if (Math.abs(dragR - sR) < ALIGN_SNAP_DIST) {
      snapX = sR - dragW;
      guides.push({ axis: 'x', pos: sR });
    }
    if (Math.abs(dragCX - sCX) < ALIGN_SNAP_DIST) {
      snapX = sCX - dragW / 2;
      guides.push({ axis: 'x', pos: sCX });
    }
    if (Math.abs(dragY - s.y) < ALIGN_SNAP_DIST) {
      snapY = s.y;
      guides.push({ axis: 'y', pos: s.y });
    }
    if (Math.abs(dragB - sB) < ALIGN_SNAP_DIST) {
      snapY = sB - dragH;
      guides.push({ axis: 'y', pos: sB });
    }
    if (Math.abs(dragCY - sCY) < ALIGN_SNAP_DIST) {
      snapY = sCY - dragH / 2;
      guides.push({ axis: 'y', pos: sCY });
    }
  }

  return { guides, snapX, snapY };
}

export interface ResizeResult {
  guides: AlignGuide[];
  /** The width that puts the right edge on a neighbour's line, or null. */
  snapW: number | null;
  /** The height that puts the bottom edge on a neighbour's line, or null. */
  snapH: number | null;
}

/**
 * Alignment guides for a shape being resized from its bottom-right corner.
 *
 * Only two edges move, the right and the bottom, and each may land on a
 * neighbour's edge or centre line — so a group can be stretched to end exactly
 * where the one beside it ends, which by hand takes three tries. The same
 * tolerance as a move; the caller keeps its own minimum size.
 */
export function computeResizeGuides(
  model: DiagramModel,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): ResizeResult {
  const guides: AlignGuide[] = [];
  let snapW: number | null = null;
  let snapH: number | null = null;
  const right = x + w;
  const bottom = y + h;

  for (const s of alignmentCandidates(model, id)) {
    for (const line of [s.x, s.x + s.w / 2, s.x + s.w]) {
      if (Math.abs(right - line) < ALIGN_SNAP_DIST) {
        snapW = line - x;
        guides.push({ axis: 'x', pos: line });
      }
    }
    for (const line of [s.y, s.y + s.h / 2, s.y + s.h]) {
      if (Math.abs(bottom - line) < ALIGN_SNAP_DIST) {
        snapH = line - y;
        guides.push({ axis: 'y', pos: line });
      }
    }
  }

  return { guides, snapW, snapH };
}
