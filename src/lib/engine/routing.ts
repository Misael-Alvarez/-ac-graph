import type { BBox, Connector, DiagramModel, Point, Shape } from '@/lib/domain';
import { ROUTE_CLEARANCE } from './constants';
import { bbox, inflate, ports, rectsOverlap, type PortName } from './geometry';
import { children, getShape, isRelated } from './model';
import { uid } from './ids';

/**
 * The faces a line should use, by where the two shapes are; a face the
 * author fixed wins over the guess at its end.
 */
function pickPorts(
  a: Shape,
  b: Shape,
  fixed: [PortName | undefined, PortName | undefined] = [undefined, undefined],
): [PortName, PortName] {
  const A = bbox(a);
  const B = bbox(b);
  const dx = B.x + B.w / 2 - (A.x + A.w / 2);
  const dy = B.y + B.h / 2 - (A.y + A.h / 2);
  const xOverlap = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) > Math.min(A.w, B.w) * 0.25;
  const yOverlap = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) > Math.min(A.h, B.h) * 0.25;
  let guess: [PortName, PortName];
  if (yOverlap && !xOverlap) guess = dx >= 0 ? ['E', 'W'] : ['W', 'E'];
  else if (xOverlap && !yOverlap) guess = dy >= 0 ? ['S', 'N'] : ['N', 'S'];
  else {
    guess =
      Math.abs(dx) >= Math.abs(dy)
        ? dx >= 0
          ? ['E', 'W']
          : ['W', 'E']
        : dy >= 0
          ? ['S', 'N']
          : ['N', 'S'];
  }
  return [fixed[0] ?? guess[0], fixed[1] ?? guess[1]];
}

/** The face of `shape` a line heading `towards` a point would leave from. */
export function portTowards(shape: Shape, towards: Point): PortName {
  const dx = towards.x - (shape.x + shape.w / 2);
  const dy = towards.y - (shape.y + shape.h / 2);
  // Measured against the shape's own proportions: a point beside a wide card
  // is "to the side" of it even when it is a little above.
  const sideways = Math.abs(dx) / Math.max(shape.w, 1);
  const upward = Math.abs(dy) / Math.max(shape.h, 1);
  if (sideways >= upward) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
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
  if (!pts.length) return [];
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

/** Fixed faces need outward stubs, including when both faces point away from the other shape. */
function routeFixedPorts(
  s: Shape,
  t: Shape,
  pa: PortName,
  pb: PortName,
  obstacles: BBox[],
): Point[] {
  const normals = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };
  const P1 = ports(s)[pa];
  const P2 = ports(t)[pb];
  const endpoints = [bbox(s), bbox(t)];
  const blocked = [...endpoints, ...obstacles];
  const stub = (p: Point, normal: Point) => {
    let length = ROUTE_CLEARANCE;
    for (const r of blocked) {
      let distance = -1;
      if (normal.x && p.y > r.y && p.y < r.y + r.h) {
        distance = normal.x > 0 ? r.x - p.x : p.x - r.x - r.w;
      } else if (normal.y && p.x > r.x && p.x < r.x + r.w) {
        distance = normal.y > 0 ? r.y - p.y : p.y - r.y - r.h;
      }
      if (distance > 0) length = Math.min(length, distance / 2);
    }
    return { x: p.x + normal.x * length, y: p.y + normal.y * length };
  };
  const A = stub(P1, normals[pa]);
  const B = stub(P2, normals[pb]);
  const candidates = elbowCandidates(A, B);
  const left = Math.min(A.x, B.x, ...blocked.map((r) => r.x)) - ROUTE_CLEARANCE;
  const right = Math.max(A.x, B.x, ...blocked.map((r) => r.x + r.w)) + ROUTE_CLEARANCE;
  const top = Math.min(A.y, B.y, ...blocked.map((r) => r.y)) - ROUTE_CLEARANCE;
  const bottom = Math.max(A.y, B.y, ...blocked.map((r) => r.y + r.h)) + ROUTE_CLEARANCE;
  for (const x of [left, right]) candidates.push([A, { x, y: A.y }, { x, y: B.y }, B]);
  for (const y of [top, bottom]) candidates.push([A, { x: A.x, y }, { x: B.x, y }, B]);
  // Mixed faces can need both an outer row and an outer column.
  for (const x of [left, right]) {
    for (const y of [top, bottom]) {
      candidates.push(
        [A, { x: A.x, y }, { x, y }, { x, y: B.y }, B],
        [A, { x, y: A.y }, { x, y }, { x: B.x, y }, B],
      );
    }
  }
  const routes = candidates.map((path) => [P1, ...path, P2]);
  const length = (path: Point[]) =>
    path
      .slice(1)
      .reduce((total, p, i) => total + Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y), 0);
  routes.sort((a, b) => length(a) - length(b));
  // If unrelated obstacles enclose an end, still honor the endpoint shapes.
  const route =
    routes.find((path) => !pathHitsAny(path, blocked)) ??
    routes.find((path) => !pathHitsAny(path, endpoints)) ??
    routes[0];
  return simplifyCollinear(dedupePts(route));
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

export function routeConnector(
  model: DiagramModel,
  conn: Connector,
  previous?: DiagramModel,
): void {
  const s = getShape(model, conn.sourceId);
  const t = getShape(model, conn.targetId);
  if (!s || !t) return;

  // A route of the author's is kept, not redrawn: only its ends follow the shapes.
  if (conn.manual && conn.waypoints.length >= 2) {
    reanchorRoute(
      conn,
      s,
      t,
      previous ? [getShape(previous, s.id) ?? s, getShape(previous, t.id) ?? t] : undefined,
    );
    return;
  }

  const fixed: [PortName | undefined, PortName | undefined] = [conn.sourcePort, conn.targetPort];
  const stacked = !fixed[0] && !fixed[1] ? isStackedAdjacent(model, s, t) : null;
  if (stacked) {
    const flip = stacked.top.id !== s.id;
    const p1 = { x: stacked.top.x + stacked.top.w / 2, y: stacked.top.y + stacked.top.h };
    const p2 = { x: stacked.bot.x + stacked.bot.w / 2, y: stacked.bot.y };
    conn.waypoints = flip ? [p2, p1] : [p1, p2];
    return;
  }

  const [pa, pb] = pickPorts(s, t, fixed);
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

  if (fixed[0] || fixed[1]) {
    conn.waypoints = routeFixedPorts(s, t, pa, pb, obstacles);
    return;
  }

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

/** Pass the pre-move model when geometry changed, so manual attachment faces survive. */
export function routeAllConnectors(model: DiagramModel, previous?: DiagramModel): void {
  for (const c of model.connectors) routeConnector(model, c, previous);
}

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

function attachedPort(shape: Shape, point: Point): PortName | undefined {
  const faces = ports(shape);
  return (Object.keys(faces) as PortName[]).find(
    (name) => Math.abs(faces[name].x - point.x) <= 0.5 && Math.abs(faces[name].y - point.y) <= 0.5,
  );
}

/**
 * Brings the ends of a hand-drawn route back onto the shapes they join.
 *
 * When both shapes moved by the same amount — a group dragged with both its
 * services, a nudge of the whole selection — the line slides with them and
 * keeps every bend. Otherwise each end snaps to its face (the one the author
 * fixed, or the one the line already leaves by) and the bend next to it moves
 * along the line's own axis, so a horizontal first segment stays horizontal.
 */
export function reanchorRoute(
  conn: Connector,
  s: Shape,
  t: Shape,
  previous?: readonly [Shape, Shape],
): void {
  const pts = conn.waypoints.map((p) => ({ ...p }));
  const n = pts.length;
  if (n < 2) return;
  const first = pts[0];
  const last = pts[n - 1];
  const [oldSource, oldTarget] = previous ?? [s, t];
  const guesses = pickPorts(oldSource, oldTarget);
  // Without a snapshot, use the terminal direction rather than a moved shape
  // against stale bends. Already attached ends always keep their faces.
  const infer = (shape: Shape, end: Point, next: Point, guess: PortName) =>
    attachedPort(shape, end) ??
    (n === 2
      ? guess
      : portTowards(
          previous
            ? shape
            : {
                ...shape,
                x: end.x - shape.w / 2,
                y: end.y - shape.h / 2,
              },
          next,
        ));
  const sourcePort = conn.sourcePort ?? infer(oldSource, first, pts[1], guesses[0]);
  const targetPort = conn.targetPort ?? infer(oldTarget, last, pts[n - 2], guesses[1]);
  const P1 = ports(s)[sourcePort];
  const P2 = ports(t)[targetPort];
  const d1 = { x: P1.x - first.x, y: P1.y - first.y };
  const d2 = { x: P2.x - last.x, y: P2.y - last.y };
  if (same(P1, first) && same(P2, last)) return;

  // Equal port offsets alone do not imply movement: both ports may have changed.
  const translated = previous
    ? s.w === oldSource.w &&
      s.h === oldSource.h &&
      t.w === oldTarget.w &&
      t.h === oldTarget.h &&
      same(d1, { x: s.x - oldSource.x, y: s.y - oldSource.y }) &&
      same(d2, { x: t.x - oldTarget.x, y: t.y - oldTarget.y })
    : !attachedPort(s, first) && !attachedPort(t, last);
  if (translated && same(d1, d2)) {
    conn.waypoints = pts.map((p) => ({ x: p.x + d1.x, y: p.y + d1.y }));
    return;
  }
  if (n > 2) {
    // Use port tangents and deltas, not alignment tests or absolute positions:
    // moving between a view and base coordinates must be reversible even when
    // a diagonal becomes horizontal, or two bends happen to coincide.
    const startAxis = sourcePort === 'E' || sourcePort === 'W' ? 'y' : 'x';
    const endAxis = targetPort === 'E' || targetPort === 'W' ? 'y' : 'x';
    const divisor = n === 3 && startAxis === endAxis ? 2 : 1;
    pts[1][startAxis] += d1[startAxis] / divisor;
    pts[n - 2][endAxis] += d2[endAxis] / divisor;
  }
  pts[0] = P1;
  pts[n - 1] = P2;
  conn.waypoints = pts;
}

/**
 * Makes a route the author's.
 *
 * The points are taken as given — no bend is smoothed away, since a bend on a
 * straight line is exactly what somebody just added in order to drag it —
 * then the ends are put back on their faces, because only the inside of the
 * line is ever edited by hand.
 * `previous` is the reading whose coordinates the supplied points use.
 */
export function setRoute(
  model: DiagramModel,
  conn: Connector,
  waypoints: Point[],
  previous?: DiagramModel,
): void {
  const pts = waypoints.map((p) => ({ ...p }));
  if (pts.length < 2) return;
  conn.waypoints = pts;
  conn.manual = true;
  routeConnector(model, conn, previous);
}

/** Gives a route back to the router. */
export function resetRoute(model: DiagramModel, conn: Connector): void {
  conn.manual = undefined;
  conn.waypoints = [];
  routeConnector(model, conn);
}

/**
 * Routes a line through the bends the author gave it, from a face at each end
 * — the fixed one, or the one nearest the first and last bend.
 */
export function routeThrough(model: DiagramModel, conn: Connector, via: Point[]): void {
  const s = getShape(model, conn.sourceId);
  const t = getShape(model, conn.targetId);
  if (!s || !t) return;
  if (!via.length) {
    resetRoute(model, conn);
    return;
  }
  const P1 = ports(s)[conn.sourcePort ?? portTowards(s, via[0])];
  const P2 = ports(t)[conn.targetPort ?? portTowards(t, via[via.length - 1])];
  const bends = via.map((p) => ({ ...p }));
  if (same(P1, bends[0])) bends.shift();
  if (bends.length && same(P2, bends[bends.length - 1])) bends.pop();
  // Coincident interior bends can separate again in another view.
  conn.waypoints = [P1, ...bends, P2];
  conn.manual = true;
}

/** The bends: every point of a route but its two ends. */
export function bendsOf(conn: Pick<Connector, 'waypoints'>): Point[] {
  return conn.waypoints.slice(1, -1);
}

/** The nearest point on a polyline to `p`, and which segment it lies on. */
export function nearestOnPolyline(
  points: Point[],
  p: Point,
): { point: Point; segment: number; distance: number } | null {
  if (points.length < 2) return null;
  let best: { point: Point; segment: number; distance: number } | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    const point = { x: a.x + vx * t, y: a.y + vy * t };
    const distance = Math.hypot(p.x - point.x, p.y - point.y);
    if (!best || distance < best.distance) best = { point, segment: i, distance };
  }
  return best;
}

/** A route with one more bend, on the segment nearest to `at`; says where the bend went. */
export function insertBend(waypoints: Point[], at: Point): { waypoints: Point[]; index: number } {
  const nearest = nearestOnPolyline(waypoints, at);
  if (!nearest) return { waypoints, index: -1 };
  const index = nearest.segment + 1;
  const next = [...waypoints.slice(0, index), nearest.point, ...waypoints.slice(index)];
  return { waypoints: next, index };
}

/**
 * Slides one segment across its own direction: a horizontal segment moves up
 * or down, a vertical one left or right, and the bends at its ends move with
 * it so the line stays one line. A slanted segment moves as a whole.
 */
export function moveSegment(waypoints: Point[], index: number, dx: number, dy: number): Point[] {
  const a = waypoints[index];
  const b = waypoints[index + 1];
  if (!a || !b) return waypoints;
  const horizontal = Math.abs(a.y - b.y) < 0.5;
  const vertical = Math.abs(a.x - b.x) < 0.5;
  const shift = (p: Point) =>
    horizontal
      ? { x: p.x, y: p.y + dy }
      : vertical
        ? { x: p.x + dx, y: p.y }
        : { x: p.x + dx, y: p.y + dy };
  return waypoints.map((p, i) => (i === index || i === index + 1 ? shift(p) : p));
}

/** Re-routes only the connectors touching the given shapes. */
export function routeConnectorsFor(
  model: DiagramModel,
  shapeIds: Set<string>,
  previous?: DiagramModel,
): void {
  for (const c of model.connectors) {
    if (shapeIds.has(c.sourceId) || shapeIds.has(c.targetId)) routeConnector(model, c, previous);
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
