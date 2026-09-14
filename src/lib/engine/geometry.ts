import type { BBox, DiagramModel, Point, Port, Shape } from '@/lib/domain';
import { G } from './constants';

export function bbox(s: Shape): BBox {
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

export function inflate(r: BBox, d: number): BBox {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function rectsOverlap(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function geometricallyContains(outer: BBox, inner: BBox): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.w <= outer.x + outer.w + 0.5 &&
    inner.y + inner.h <= outer.y + outer.h + 0.5
  );
}

export type PortName = Port;

export function ports(s: Shape): Record<PortName, Point> {
  const { x, y, w, h } = s;
  return {
    N: { x: x + w / 2, y },
    S: { x: x + w / 2, y: y + h },
    E: { x: x + w, y: y + h / 2 },
    W: { x, y: y + h / 2 },
  };
}

export function snapToGrid(val: number, gridSize: number = G.SNAP_SIZE): number {
  return Math.round(val / gridSize) * gridSize;
}

/** Bounding box of every shape and connector waypoint, used for zoom-to-fit and export. */
export function contentBBox(model: DiagramModel): BBox {
  if (!model.shapes.length) return { x: 20, y: 20, w: 600, h: 400 };
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const s of model.shapes) {
    x1 = Math.min(x1, s.x);
    y1 = Math.min(y1, s.y);
    x2 = Math.max(x2, s.x + s.w);
    y2 = Math.max(y2, s.y + s.h);
  }
  for (const c of model.connectors) {
    for (const p of c.waypoints) {
      x1 = Math.min(x1, p.x);
      y1 = Math.min(y1, p.y);
      x2 = Math.max(x2, p.x);
      y2 = Math.max(y2, p.y);
    }
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
