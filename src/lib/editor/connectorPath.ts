import type { Point } from '@/lib/domain';

/**
 * Corner radius applied at each elbow of a connector.
 *
 * Fourteen, up from eight: at the sizes these diagrams are read, an elbow of
 * eight still read as a wire bent around a nail. Fourteen reads as a route.
 * The radius shrinks on short segments so tight doglegs never self-intersect.
 */
export const CORNER_RADIUS = 14;

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Moves `from` towards `to` by `amount`, never overshooting. */
function towards(from: Point, to: Point, amount: number): Point {
  const d = dist(from, to);
  if (d === 0) return { ...from };
  const t = Math.min(amount, d) / d;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

const fmt = (n: number) => Math.round(n * 100) / 100;

/**
 * Builds an SVG path from connector waypoints, rounding each elbow.
 *
 * Square elbows read as harsh at the sizes these diagrams are shown at; a small
 * radius reads as deliberate. The radius shrinks automatically on short
 * segments so tight doglegs never self-intersect.
 */
export function waypointsToPath(points: Point[], radius = CORNER_RADIUS): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M${fmt(points[0].x)},${fmt(points[0].y)} L${fmt(points[1].x)},${fmt(points[1].y)}`;
  }

  const parts: string[] = [`M${fmt(points[0].x)},${fmt(points[0].y)}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    // Never eat more than half of either adjoining segment.
    const r = Math.min(radius, dist(prev, corner) / 2, dist(corner, next) / 2);
    const start = towards(corner, prev, r);
    const end = towards(corner, next, r);
    parts.push(`L${fmt(start.x)},${fmt(start.y)}`);
    if (r > 0.01) parts.push(`Q${fmt(corner.x)},${fmt(corner.y)} ${fmt(end.x)},${fmt(end.y)}`);
  }
  const last = points[points.length - 1];
  parts.push(`L${fmt(last.x)},${fmt(last.y)}`);
  return parts.join(' ');
}

/** Length of a polyline. */
export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += dist(points[i], points[i + 1]);
  return total;
}

/** The point a share `t` (0 at the start, 1 at the end) of the way along a polyline. */
export function pointAlong(points: Point[], t: number): Point | null {
  if (points.length < 2) return null;
  const total = pathLength(points);
  const share = Math.max(0, Math.min(1, t));
  if (total === 0) return { ...points[0] };
  let remaining = share * total;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = dist(a, b);
    if (remaining <= length || i === points.length - 2) {
      const k = length === 0 ? 0 : Math.min(1, remaining / length);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    remaining -= length;
  }
  return { ...points[points.length - 1] };
}

/**
 * How far along a polyline the point nearest to `p` is, as a share of its
 * length — what a label dragged along the line is set to.
 */
export function positionAlong(points: Point[], p: Point): number {
  if (points.length < 2) return 0.5;
  const total = pathLength(points);
  if (total === 0) return 0.5;
  let best = { distance: Infinity, along: 0 };
  let before = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const k =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    const q = { x: a.x + vx * k, y: a.y + vy * k };
    const distance = dist(p, q);
    if (distance < best.distance) best = { distance, along: before + dist(a, q) };
    before += dist(a, b);
  }
  return Math.max(0, Math.min(1, best.along / total));
}

/**
 * Point at which a connector's label should sit: where the author put it, as
 * a share of the way along the line, or failing that the middle of the
 * longest segment.
 */
export function labelAnchor(points: Point[], at?: number): Point | null {
  if (points.length < 2) return null;
  if (at !== undefined) return pointAlong(points, at);
  if (points.length === 2) {
    return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  }
  // Place the label on the midpoint of the longest segment so it never lands on
  // a bend, which is where the old renderer put it.
  let bestIndex = 0;
  let bestLength = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const length = dist(points[i], points[i + 1]);
    if (length > bestLength) {
      bestLength = length;
      bestIndex = i;
    }
  }
  const a = points[bestIndex];
  const b = points[bestIndex + 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
