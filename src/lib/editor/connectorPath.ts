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

/** Point at which a connector's label should sit. */
export function labelAnchor(points: Point[]): Point | null {
  if (points.length < 2) return null;
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
