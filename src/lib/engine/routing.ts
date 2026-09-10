import type { BBox, Connector, DiagramModel, Point, Shape } from '@/lib/domain';
import { ROUTE_CLEARANCE } from './constants';
import { bbox, inflate, ports, rectsOverlap, type PortName } from './geometry';
import { children, getShape, isRelated } from './model';
import { uid } from './ids';

function pickPorts(a: Shape, b: Shape): [PortName, PortName] {
  const A = bbox(a);
  const B = bbox(b);
  const dx = B.x + B.w / 2 - (A.x + A.w / 2);
  const dy = B.y + B.h / 2 - (A.y + A.h / 2);
  const xOverlap = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) > Math.min(A.w, B.w) * 0.25;
  const yOverlap = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) > Math.min(A.h, B.h) * 0.25;
  if (yOverlap && !xOverlap) return dx >= 0 ? ['E', 'W'] : ['W', 'E'];
  if (xOverlap && !yOverlap) return dy >= 0 ? ['S', 'N'] : ['N', 'S'];
  return Math.abs(dx) >= Math.abs(dy)
    ? dx >= 0
      ? ['E', 'W']
      : ['W', 'E']
    : dy >= 0
      ? ['S', 'N']
      : ['N', 'S'];
}

function segIntersectsRect(p1: Point, p2: Point, r: BBox): boolean {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  if (Math.abs(minX - maxX) < 1e-6) {
    if (minX <= r.x + 1e-6 || minX >= r.x + r.w - 1e-6) return false;
    return maxY > r.y + 1e-6 && minY < r.y + r.h - 1e-6;
  }
  if (Math.abs(minY - maxY) < 1e-6) {
    if (minY <= r.y + 1e-6 || minY >= r.y + r.h - 1e-6) return false;
    return maxX > r.x + 1e-6 && minX < r.x + r.w - 1e-6;
  }
  return rectsOverlap({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, r);
}

function pathHitsAny(path: Point[], obstacles: BBox[]): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    for (const o of obstacles) {
      if (segIntersectsRect(path[i], path[i + 1], o)) return true;
    }
  }
  return false;
}

function dedupePts(pts: Point[]): Point[] {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const q = out[out.length - 1];
    if (Math.abs(p.x - q.x) > 1e-6 || Math.abs(p.y - q.y) > 1e-6) out.push(p);
  }
  return out;
}

function simplifyCollinear(pts: Point[]): Point[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const colH = Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6;
    const colV = Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6;
    if (!(colH || colV)) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Four candidate elbow shapes, tried in order of preference. */
function elbowCandidates(P1: Point, P2: Point): Point[][] {
  const mx = (P1.x + P2.x) / 2;
  const my = (P1.y + P2.y) / 2;
  return [
    [P1, { x: P2.x, y: P1.y }, P2],
    [P1, { x: P1.x, y: P2.y }, P2],
    [P1, { x: mx, y: P1.y }, { x: mx, y: P2.y }, P2],
    [P1, { x: P1.x, y: my }, { x: P2.x, y: my }, P2],
  ];
}

/** Two items stacked next to each other in the same container get a straight drop. */
function isStackedAdjacent(
  model: DiagramModel,
  s: Shape,
  t: Shape,
): { top: Shape; bot: Shape } | null {
  if (s.type !== 'item' || t.type !== 'item') return null;
  if (s.parentId !== t.parentId || !s.parentId) return null;
  const items = children(model, s.parentId)
    .filter((c) => c.type === 'item')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const si = items.indexOf(s);
  const ti = items.indexOf(t);
  if (si < 0 || ti < 0 || Math.abs(si - ti) !== 1) return null;
  return si < ti ? { top: s, bot: t } : { top: t, bot: s };
}

export function routeConnector(model: DiagramModel, conn: Connector): void {
  const s = getShape(model, conn.sourceId);
  const t = getShape(model, conn.targetId);
  if (!s || !t) return;

  const stacked = isStackedAdjacent(model, s, t);
  if (stacked) {
    const flip = stacked.top.id !== s.id;
    const p1 = { x: stacked.top.x + stacked.top.w / 2, y: stacked.top.y + stacked.top.h };
    const p2 = { x: stacked.bot.x + stacked.bot.w / 2, y: stacked.bot.y };
    conn.waypoints = flip ? [p2, p1] : [p1, p2];
    return;
  }

  const [pa, pb] = pickPorts(s, t);
  const P1 = ports(s)[pa];
  const P2 = ports(t)[pb];
  const obstacles = model.shapes
    .filter(
      (sh) =>
        (sh.type === 'item' || sh.type === 'container' || sh.type === 'group') &&
        sh.id !== conn.sourceId &&
        sh.id !== conn.targetId &&
        !isRelated(model, sh.id, conn.sourceId) &&
        !isRelated(model, sh.id, conn.targetId),
    )
    .map((o) => inflate(bbox(o), ROUTE_CLEARANCE));

  const candidates = elbowCandidates(P1, P2);
  for (const cand of candidates) {
    if (!pathHitsAny(cand, obstacles)) {
      conn.waypoints = simplifyCollinear(dedupePts(cand));
      return;
    }
  }
  // Nothing is clear: fall back to the mid-X dogleg, which reads best when it overlaps.
  conn.waypoints = simplifyCollinear(dedupePts(candidates[2]));
}

export function routeAllConnectors(model: DiagramModel): void {
  for (const c of model.connectors) routeConnector(model, c);
}

/** Re-routes only the connectors touching the given shapes. */
export function routeConnectorsFor(model: DiagramModel, shapeIds: Set<string>): void {
  for (const c of model.connectors) {
    if (shapeIds.has(c.sourceId) || shapeIds.has(c.targetId)) routeConnector(model, c);
  }
}

export function connectorsTouching(model: DiagramModel, shapeIds: Set<string>): Connector[] {
  return model.connectors.filter((c) => shapeIds.has(c.sourceId) || shapeIds.has(c.targetId));
}

export function addConnector(model: DiagramModel, sourceId: string, targetId: string): Connector {
  const c: Connector = {
    id: uid('cn'),
    sourceId,
    targetId,
    label: '',
    style: 'solid',
    waypoints: [],
  };
  model.connectors.push(c);
  routeConnector(model, c);
  return c;
}

export function deleteConnector(model: DiagramModel, id: string): void {
  const index = model.connectors.findIndex((c) => c.id === id);
  if (index >= 0) model.connectors.splice(index, 1);
}
