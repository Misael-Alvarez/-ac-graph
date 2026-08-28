import { parseDocument, type Document } from 'yaml';
import type { DiagramModel, Shape } from '@/lib/domain';
import * as E from '@/lib/engine';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { PROVIDER_COLORS, providerOf } from '@/lib/editor/providers';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import type { Locale } from '@/lib/i18n/messages';
import {
  DslDocumentSchema,
  normaliseEdges,
  normaliseNode,
  pickNodeMeta,
  type DslDocument,
  type NormalisedEdge,
} from './schema';
import { resolveService, type CloudPrefix } from './services';

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  /** Character offsets into the source, for in-editor underlining. */
  from: number;
  to: number;
  /**
   * Where in the document the problem is, e.g. `['nodes', 'api']`.
   * `parseDsl` turns this into character offsets; carrying it explicitly avoids
   * having to recover the location by pattern-matching the message text.
   */
  path?: (string | number)[];
}

export interface ParseResult {
  model: DiagramModel | null;
  document: DslDocument | null;
  diagnostics: Diagnostic[];
}

const COL_W = 560;
const ROW_H = 300;
const MARGIN = 80;

/** Padding a boundary adds around its members. */
const BOUNDARY_PAD = { top: 70, side: 40, bottom: 40 };

/**
 * Grid pitch used when the document declares boundaries.
 *
 * A boundary adds 110px of vertical padding around its members, which is more
 * than the 92px the default row pitch leaves between groups — two boundaries in
 * consecutive rows would overlap and the editor would flag both in red.
 */
const BOUNDED_COL_W = 660;
const BOUNDED_ROW_H = 380;

/** Character range of a key inside the YAML source, for precise diagnostics. */
function rangeOf(doc: Document, path: (string | number)[]): [number, number] {
  const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
  if (node?.range) return [node.range[0], node.range[1]];
  return [0, 0];
}

/** Longest-path layering so a node always sits below everything that feeds it. */
function layerNodes(ids: string[], edges: NormalisedEdge[]): Map<string, number> {
  const index = new Map(ids.map((id, i) => [id, i]));
  const adjacency: number[][] = ids.map(() => []);
  const inDegree = new Array(ids.length).fill(0);

  for (const edge of edges) {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    if (a === undefined || b === undefined || a === b) continue;
    adjacency[a].push(b);
    inDegree[b]++;
  }

  const layer = new Array(ids.length).fill(0);
  const queue = ids.map((_, i) => i).filter((i) => inDegree[i] === 0);
  const visited = new Set<number>();
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    visited.add(u);
    for (const v of adjacency[u]) {
      layer[v] = Math.max(layer[v], layer[u] + 1);
      if (--inDegree[v] === 0) queue.push(v);
    }
  }
  // Nodes inside a cycle never drain; park them on the first row.
  ids.forEach((_, i) => {
    if (!visited.has(i)) layer[i] = 0;
  });

  return new Map(ids.map((id, i) => [id, layer[i]]));
}

/** Grid positions derived from the layering, used for nodes with no `layout`. */
function autoPositions(
  ids: string[],
  edges: NormalisedEdge[],
  spread = false,
): Map<string, [number, number]> {
  const colW = spread ? BOUNDED_COL_W : COL_W;
  const rowH = spread ? BOUNDED_ROW_H : ROW_H;
  const layers = layerNodes(ids, edges);
  const rows = new Map<number, string[]>();
  for (const id of ids) {
    const layer = layers.get(id) ?? 0;
    const row = rows.get(layer);
    if (row) row.push(id);
    else rows.set(layer, [id]);
  }

  const widest = Math.max(...[...rows.values()].map((r) => r.length), 1);
  const positions = new Map<string, [number, number]>();
  for (const [layer, row] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const offsetX = MARGIN + ((widest - row.length) * colW) / 2;
    row.forEach((id, column) => {
      positions.set(id, [offsetX + column * colW, MARGIN + layer * rowH]);
    });
  }
  return positions;
}

const CLEARANCE = 60;

/** Moves a group and its children by a delta. */
function shiftGroup(model: DiagramModel, group: Shape, dx: number): void {
  for (const id of E.collectDescendantIds(model, group.id)) {
    const shape = E.getShape(model, id);
    if (shape) shape.x += dx;
  }
}

/**
 * Slides a group horizontally until it no longer overlaps `obstacle`, choosing
 * the side that moves it least and avoiding a landing spot that just creates a
 * new overlap.
 */
function moveClear(model: DiagramModel, group: Shape, obstacle: Shape, others: Shape[]): void {
  const toRight = obstacle.x + obstacle.w + CLEARANCE - group.x;
  const toLeft = obstacle.x - CLEARANCE - group.w - group.x;
  const candidates = Math.abs(toRight) <= Math.abs(toLeft) ? [toRight, toLeft] : [toLeft, toRight];

  for (const dx of candidates) {
    const landed = { x: group.x + dx, y: group.y, w: group.w, h: group.h };
    const blocked = others.some(
      (other) => other.id !== group.id && E.rectsOverlap(landed, E.bbox(other)),
    );
    if (!blocked) {
      shiftGroup(model, group, dx);
      return;
    }
  }
  // Both sides are occupied: take the shorter move and let the layout breathe.
  shiftGroup(model, group, candidates[0]);
}

/** Compiles a DSL document into a diagram. */
export function compile(
  document: DslDocument,
  locale: Locale = 'en',
): { model: DiagramModel; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const model = E.createEmptyModel();
  const cloud = document.cloud as CloudPrefix | undefined;

  const nodeIds = Object.keys(document.nodes);
  const edges = normaliseEdges(document.edges).filter((edge) => {
    const known = nodeIds.includes(edge.from) && nodeIds.includes(edge.to);
    if (!known) {
      diagnostics.push({
        severity: 'warning',
        message: `Edge "${edge.from} -> ${edge.to}" names a node that does not exist.`,
        from: 0,
        to: 0,
        path: ['edges'],
      });
    }
    return known;
  });

  const hasBoundaries = Object.keys(document.boundaries ?? {}).length > 0;
  const auto = autoPositions(nodeIds, edges, hasBoundaries);
  const boundaryIdByKey = new Map<string, string>();

  for (const [key, spec] of Object.entries(document.boundaries ?? {})) {
    const boundary = E.addBoundary(model, 0, 0, spec.variant);
    boundary.title = spec.label ?? key;
    if (spec.service) {
      const resolved = resolveService(spec.service, cloud);
      if (resolved) boundary.icon = { kind: 'symbol', key: resolved };
    }
    boundaryIdByKey.set(key, boundary.id);
  }

  const itemIdByNode = new Map<string, string>();

  for (const nodeId of nodeIds) {
    const spec = normaliseNode(document.nodes[nodeId]);
    const resolved = resolveService(spec.service, cloud);
    if (!resolved) {
      diagnostics.push({
        severity: 'error',
        message: `Unknown service "${spec.service}".`,
        from: 0,
        to: 0,
        path: ['nodes', nodeId],
      });
    }
    const serviceKey = resolved ?? 'gen-server';
    const service = SERVICE_ICONS.find((s) => s.key === serviceKey);

    const [x, y] = document.layout?.[nodeId] ?? auto.get(nodeId) ?? [MARGIN, MARGIN];
    const group = E.addGroup(model, x, y);
    group.title = spec.label ?? service?.label ?? nodeId;

    const palette = PROVIDER_COLORS[providerOf(serviceKey)];
    group.fill = palette.fill;

    const container = E.children(model, group.id).find((s) => s.type === 'container');
    if (!container) continue;
    container.fill = palette.border;

    const item = E.children(model, container.id).find((s) => s.type === 'item');
    if (!item) continue;
    item.title = spec.label ?? service?.label ?? nodeId;
    item.subtitle = spec.subtitle ?? serviceDescription(service, locale);
    item.note = spec.note ?? '';
    item.icon = { kind: 'symbol', key: serviceKey };
    // What the node *is*, as opposed to where it sits, rides on the item —
    // which is the shape the DSL calls a node.
    item.meta = pickNodeMeta(spec);
    itemIdByNode.set(nodeId, item.id);
  }

  for (const edge of edges) {
    const sourceId = itemIdByNode.get(edge.from);
    const targetId = itemIdByNode.get(edge.to);
    if (!sourceId || !targetId) continue;
    const connector = E.addConnector(model, sourceId, targetId);
    connector.label = edge.label;
    connector.style = edge.style;
    connector.meta = edge.meta;
  }

  /** The group that represents a node, resolved through its item. */
  const groupOfNode = (nodeId: string): Shape | undefined => {
    const itemId = itemIdByNode.get(nodeId);
    const item = itemId ? E.getShape(model, itemId) : undefined;
    const container = item?.parentId ? E.getShape(model, item.parentId) : undefined;
    return container?.parentId ? E.getShape(model, container.parentId) : undefined;
  };

  const allGroups = model.shapes.filter((s) => s.type === 'group');

  /** Groups that belong to any boundary, and so must not be shoved around. */
  const boundedGroupIds = new Set(
    nodeIds
      .filter((id) => normaliseNode(document.nodes[id]).in)
      .map(groupOfNode)
      .filter((g): g is Shape => Boolean(g))
      .map((g) => g.id),
  );

  // Size each boundary around the nodes that declared themselves inside it, then
  // push everything else clear of it. Without the second step a node that never
  // said `in:` still ends up sitting on top of the boundary, because the layered
  // grid knows nothing about membership — and the editor flags the overlap in red.
  for (const [key, boundaryId] of boundaryIdByKey) {
    const memberGroups = nodeIds
      .filter((id) => normaliseNode(document.nodes[id]).in === key)
      .map(groupOfNode)
      .filter((g): g is Shape => Boolean(g));

    const boundary = E.getShape(model, boundaryId);
    if (!boundary) continue;
    if (!memberGroups.length) {
      diagnostics.push({
        severity: 'warning',
        message: `Boundary "${key}" contains no nodes.`,
        from: 0,
        to: 0,
        path: ['boundaries', key],
      });
      continue;
    }

    const minX = Math.min(...memberGroups.map((g) => g.x));
    const minY = Math.min(...memberGroups.map((g) => g.y));
    const maxX = Math.max(...memberGroups.map((g) => g.x + g.w));
    const maxY = Math.max(...memberGroups.map((g) => g.y + g.h));
    boundary.x = minX - BOUNDARY_PAD.side;
    boundary.y = minY - BOUNDARY_PAD.top;
    boundary.w = maxX - minX + BOUNDARY_PAD.side * 2;
    boundary.h = maxY - minY + BOUNDARY_PAD.top + BOUNDARY_PAD.bottom;

    const members = new Set(memberGroups.map((g) => g.id));
    for (const group of allGroups) {
      if (members.has(group.id)) continue;
      // A group that belongs to a different boundary must stay where it is:
      // moving it would drag its own boundary out of shape.
      if (boundedGroupIds.has(group.id)) continue;
      if (!E.rectsOverlap(E.bbox(boundary), E.bbox(group))) continue;
      moveClear(model, group, boundary, allGroups);
    }
  }

  E.routeAllConnectors(model);
  return { model, diagnostics };
}

/** Parses DSL source into a diagram, reporting anything it could not use. */
export function parseDsl(source: string, locale: Locale = 'en'): ParseResult {
  const diagnostics: Diagnostic[] = [];

  if (!source.trim()) {
    return { model: E.createEmptyModel(), document: null, diagnostics };
  }

  const yamlDoc = parseDocument(source, { prettyErrors: true });
  for (const error of yamlDoc.errors) {
    diagnostics.push({
      severity: 'error',
      message: error.message,
      from: error.pos[0],
      to: error.pos[1],
    });
  }
  if (yamlDoc.errors.length) return { model: null, document: null, diagnostics };

  const parsed = DslDocumentSchema.safeParse(yamlDoc.toJS());
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [from, to] = rangeOf(yamlDoc, issue.path as (string | number)[]);
      diagnostics.push({
        severity: 'error',
        message: `${issue.path.join('.') || 'document'}: ${issue.message}`,
        from,
        to,
      });
    }
    return { model: null, document: null, diagnostics };
  }

  const compiled = compile(parsed.data, locale);
  // Resolve each diagnostic's document path to a range in the source.
  for (const diagnostic of compiled.diagnostics) {
    if (!diagnostic.path) continue;
    const [from, to] = rangeOf(yamlDoc, diagnostic.path);
    diagnostic.from = from;
    diagnostic.to = to;
  }

  return {
    model: compiled.model,
    document: parsed.data,
    diagnostics: [...diagnostics, ...compiled.diagnostics],
  };
}
