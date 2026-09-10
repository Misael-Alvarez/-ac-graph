import type { DiagramModel, Shape } from '@/lib/domain';
import { bbox, geometricallyContains } from './geometry';
import { getShape } from './model';

/**
 * What the diagram can be asked about itself.
 *
 * The point of giving nodes and edges meaning is that questions become
 * answerable without a person squinting at boxes: what breaks if this dies,
 * what calls what in a circle, what nobody owns. Every check here is a pure
 * function of the model — no React, no DOM — which is what lets the same
 * answers feed the panel, the AI's review and, later, a CI check.
 *
 * Findings carry a kind and its data, never a sentence. The app is bilingual
 * and the prose belongs to the interface; an engine that returns English is an
 * engine that can only ever be read in English.
 */

export type FindingKind =
  'cycle' | 'singlePointOfFailure' | 'orphan' | 'highCoupling' | 'unowned' | 'unauthenticatedData';

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  /** Stable across runs on the same model, so the UI can key rows by it. */
  id: string;
  kind: FindingKind;
  severity: Severity;
  /** The shapes this is about; the panel selects and centres them. */
  shapeIds: string[];
  connectorIds: string[];
  /** Values the interface interpolates into its own wording. */
  detail: Record<string, string | number>;
}

export interface Analysis {
  findings: Finding[];
  /** 0–100, derived from the findings below it and never from anything else. */
  score: number;
  nodes: number;
  edges: number;
}

const WEIGHT: Record<Severity, number> = { high: 10, medium: 5, low: 2 };

/** A node's name as a person would say it. */
function nameOf(shape: Shape): string {
  return shape.title || shape.icon?.key || shape.id;
}

interface Graph {
  ids: string[];
  byId: Map<string, Shape>;
  out: Map<string, string[]>;
  in: Map<string, string[]>;
  /** Undirected adjacency, for questions about connectivity rather than flow. */
  near: Map<string, Set<string>>;
}

/**
 * The graph the diagram describes.
 *
 * Items are the nodes: a group is a card that holds one, and a boundary is a
 * zone that holds groups — neither is a thing that calls another thing.
 */
function buildGraph(model: DiagramModel): Graph {
  const items = model.shapes.filter((s) => s.type === 'item');
  const byId = new Map(items.map((s) => [s.id, s]));
  const ids = items.map((s) => s.id);

  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const inbound = new Map<string, string[]>(ids.map((id) => [id, []]));
  const near = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));

  for (const connector of model.connectors) {
    const { sourceId, targetId } = connector;
    if (!byId.has(sourceId) || !byId.has(targetId) || sourceId === targetId) continue;
    out.get(sourceId)!.push(targetId);
    inbound.get(targetId)!.push(sourceId);
    near.get(sourceId)!.add(targetId);
    near.get(targetId)!.add(sourceId);
  }

  return { ids, byId, out, in: inbound, near };
}

/**
 * Strongly connected components, by Tarjan.
 *
 * A component of more than one node is a set of services that can all reach
 * each other — which is the honest definition of a circular dependency, and
 * catches the three-hop cycles that eyeballing a diagram never does.
 */
function stronglyConnected(graph: Graph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const walk = (start: string) => {
    // Iterative, because a deep architecture would blow the call stack.
    const work: { node: string; next: number }[] = [{ node: start, next: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);

    while (work.length) {
      const frame = work[work.length - 1];
      const neighbours = graph.out.get(frame.node)!;

      if (frame.next < neighbours.length) {
        const next = neighbours[frame.next];
        frame.next += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, next: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));

      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const id = stack.pop()!;
          onStack.delete(id);
          component.push(id);
          if (id === frame.node) break;
        }
        components.push(component);
      }
    }
  };

  for (const id of graph.ids) if (!index.has(id)) walk(id);
  return components;
}

/**
 * Articulation points of the undirected graph, by Hopcroft–Tarjan.
 *
 * A node whose removal splits the architecture into pieces that can no longer
 * reach each other. That is what "single point of failure" means precisely,
 * rather than "the box with the most arrows".
 */
function articulationPoints(graph: Graph): Map<string, number> {
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const cut = new Map<string, number>();
  let timer = 0;

  const walk = (root: string) => {
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }];
    disc.set(root, timer);
    low.set(root, timer);
    timer += 1;
    parent.set(root, null);
    let rootChildren = 0;

    while (work.length) {
      const frame = work[work.length - 1];
      const neighbours = [...graph.near.get(frame.node)!];

      if (frame.next < neighbours.length) {
        const next = neighbours[frame.next];
        frame.next += 1;
        if (!disc.has(next)) {
          parent.set(next, frame.node);
          disc.set(next, timer);
          low.set(next, timer);
          timer += 1;
          if (frame.node === root) rootChildren += 1;
          work.push({ node: next, next: 0 });
        } else if (next !== parent.get(frame.node)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, disc.get(next)!));
        }
        continue;
      }

      work.pop();
      const above = work[work.length - 1];
      if (!above) continue;
      low.set(above.node, Math.min(low.get(above.node)!, low.get(frame.node)!));
      // A child that cannot climb above its parent leaves that parent holding
      // the only way through.
      if (above.node !== root && low.get(frame.node)! >= disc.get(above.node)!) {
        cut.set(above.node, (cut.get(above.node) ?? 0) + 1);
      }
    }

    // The root is only a cut vertex if the search left it by more than one edge.
    if (rootChildren > 1) cut.set(root, rootChildren - 1);
  };

  for (const id of graph.ids) if (!disc.has(id)) walk(id);
  return cut;
}

/** The boundary a node sits in, by geometry — the same rule the DSL serialises with. */
function boundaryOfItem(model: DiagramModel, item: Shape): string | undefined {
  const container = item.parentId ? getShape(model, item.parentId) : undefined;
  const group = container?.parentId ? getShape(model, container.parentId) : undefined;
  if (!group) return undefined;
  const boundaries = model.shapes.filter((s) => s.type === 'boundary');
  const containing = boundaries
    .filter((b) => geometricallyContains(bbox(b), bbox(group)))
    .sort((a, b) => a.w * a.h - b.w * b.h);
  return containing[0]?.id;
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function analyzeArchitecture(model: DiagramModel): Analysis {
  const graph = buildGraph(model);
  const findings: Finding[] = [];

  // ── Circular dependencies ────────────────────────────────────────────────
  for (const component of stronglyConnected(graph)) {
    if (component.length < 2) continue;
    const names = component.map((id) => nameOf(graph.byId.get(id)!)).sort();
    findings.push({
      id: `cycle:${[...component].sort().join(',')}`,
      kind: 'cycle',
      severity: 'high',
      shapeIds: component,
      connectorIds: model.connectors
        .filter((c) => component.includes(c.sourceId) && component.includes(c.targetId))
        .map((c) => c.id),
      detail: { names: names.join(' → '), count: component.length },
    });
  }

  // ── Single points of failure ─────────────────────────────────────────────
  // Only worth asking of a graph big enough to be split in two.
  if (graph.ids.length >= 3) {
    for (const [id, splits] of articulationPoints(graph)) {
      const shape = graph.byId.get(id)!;
      findings.push({
        id: `spof:${id}`,
        kind: 'singlePointOfFailure',
        severity: shape.meta?.criticality === 'critical' ? 'high' : 'medium',
        shapeIds: [id],
        connectorIds: [],
        detail: { name: nameOf(shape), splits: splits + 1 },
      });
    }
  }

  // ── Nothing reaches it, it reaches nothing ───────────────────────────────
  for (const id of graph.ids) {
    if (graph.near.get(id)!.size > 0) continue;
    findings.push({
      id: `orphan:${id}`,
      kind: 'orphan',
      severity: 'low',
      shapeIds: [id],
      connectorIds: [],
      detail: { name: nameOf(graph.byId.get(id)!) },
    });
  }

  // ── Too much hangs off one node ──────────────────────────────────────────
  const degrees = graph.ids.map((id) => graph.near.get(id)!.size);
  const typical = median(degrees.filter((d) => d > 0));
  for (const id of graph.ids) {
    const degree = graph.near.get(id)!.size;
    if (degree < 4 || degree < typical * 3) continue;
    findings.push({
      id: `coupling:${id}`,
      kind: 'highCoupling',
      severity: 'medium',
      shapeIds: [id],
      connectorIds: [],
      detail: {
        name: nameOf(graph.byId.get(id)!),
        degree,
        in: graph.in.get(id)!.length,
        out: graph.out.get(id)!.length,
      },
    });
  }

  // ── Nobody answers for it ────────────────────────────────────────────────
  // Asked only once somebody has started answering: on a diagram where no node
  // has an owner, the practice has not begun and the finding is just noise.
  const anyOwned = graph.ids.some((id) => graph.byId.get(id)!.meta?.owner);
  if (anyOwned) {
    for (const id of graph.ids) {
      const shape = graph.byId.get(id)!;
      if (shape.meta?.owner) continue;
      findings.push({
        id: `unowned:${id}`,
        kind: 'unowned',
        severity: 'low',
        shapeIds: [id],
        connectorIds: [],
        detail: { name: nameOf(shape) },
      });
    }
  }

  // ── Sensitive data travelling unauthenticated ────────────────────────────
  const SENSITIVE = new Set(['pii', 'pci', 'phi']);
  for (const connector of model.connectors) {
    const meta = connector.meta;
    if (!meta?.dataClass || !SENSITIVE.has(meta.dataClass) || meta.auth) continue;
    const source = graph.byId.get(connector.sourceId);
    const target = graph.byId.get(connector.targetId);
    if (!source || !target) continue;
    const crosses = boundaryOfItem(model, source) !== boundaryOfItem(model, target);
    findings.push({
      id: `data:${connector.id}`,
      kind: 'unauthenticatedData',
      severity: crosses ? 'high' : 'medium',
      shapeIds: [source.id, target.id],
      connectorIds: [connector.id],
      detail: {
        from: nameOf(source),
        to: nameOf(target),
        dataClass: meta.dataClass,
      },
    });
  }

  const penalty = findings.reduce((sum, finding) => sum + WEIGHT[finding.severity], 0);
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

  // Within a severity, by kind and then by what the finding is about — the
  // shapes' names, not their ids. Ids are minted at random when a template is
  // built, so sorting by them shuffled equal findings between two sessions of
  // the same diagram, and a panel that reorders itself reads as unstable.
  const about = (finding: Finding) =>
    [
      ...finding.shapeIds.map((id) => {
        const shape = graph.byId.get(id);
        return shape ? nameOf(shape) : '';
      }),
      ...finding.connectorIds.map((id) => model.connectors.find((c) => c.id === id)?.label ?? ''),
    ].join(' ');
  return {
    findings: findings.sort(
      (a, b) =>
        order[a.severity] - order[b.severity] ||
        a.kind.localeCompare(b.kind) ||
        about(a).localeCompare(about(b)) ||
        a.id.localeCompare(b.id),
    ),
    // An empty diagram is not a perfect one, but it has nothing wrong with it
    // either; the panel says how much was looked at beside the number.
    score: Math.max(0, 100 - penalty),
    nodes: graph.ids.length,
    edges: model.connectors.length,
  };
}
