import type { DiagramModel } from '@/lib/domain';
import * as E from '@/lib/engine';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { PROVIDER_COLORS, providerOf } from './providers';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import type { Locale } from '@/lib/i18n/messages';

const COL_W = 560;
const ROW_H = 300;
const MARGIN_X = 80;
const MARGIN_Y = 80;

interface ParsedNode {
  label: string;
  serviceKey: string;
}

type ParsedEdge = [from: string, to: string, label: string];

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** Best-effort match of a free-text label against the service catalogue. */
function matchService(label: string): string {
  const needle = normalise(label);
  const exact = SERVICE_ICONS.find((s) => normalise(s.label) === needle);
  if (exact) return exact.key;
  const byKey = SERVICE_ICONS.find((s) => s.key.replace(/-/g, '').includes(needle));
  if (byKey) return byKey.key;
  const contained = SERVICE_ICONS.find((s) => needle.includes(normalise(s.label)));
  return contained?.key ?? 'gen-server';
}

export interface ParsedMarkdown {
  nodes: ParsedNode[];
  edges: ParsedEdge[];
}

/**
 * Reads a Markdown outline into nodes and edges.
 *
 * Accepts bullet lists, numbered lists and plain lines for nodes, and
 * `A -> B : label` (also `-->` and `→`) for connections. Headings are ignored.
 */
export function parseMarkdown(text: string): ParsedMarkdown {
  const nodes: ParsedNode[] = [];
  const edges: ParsedEdge[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const edge = line.match(/^(.+?)\s*(?:->|-->|→)\s*(.+?)(?:\s*:\s*(.+))?$/);
    if (edge) {
      edges.push([edge[1].trim(), edge[2].trim(), edge[3]?.trim() ?? '']);
      continue;
    }

    const label = line
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .trim();
    if (!label || seen.has(normalise(label))) continue;
    seen.add(normalise(label));
    nodes.push({ label, serviceKey: matchService(label) });
  }

  return { nodes, edges };
}

/** Longest-path layering, so a node always sits below everything that feeds it. */
function assignLayers(nodes: ParsedNode[], edges: ParsedEdge[]): number[] {
  const indexOf = new Map<string, number>();
  nodes.forEach((n, i) => {
    indexOf.set(normalise(n.label), i);
    const svc = SERVICE_ICONS.find((s) => s.key === n.serviceKey);
    if (svc && !indexOf.has(normalise(svc.label))) indexOf.set(normalise(svc.label), i);
  });

  const adjacency: number[][] = nodes.map(() => []);
  const inDegree = new Array(nodes.length).fill(0);
  for (const [from, to] of edges) {
    const a = indexOf.get(normalise(from));
    const b = indexOf.get(normalise(to));
    if (a === undefined || b === undefined || a === b) continue;
    adjacency[a].push(b);
    inDegree[b]++;
  }

  const layer = new Array(nodes.length).fill(0);
  const queue = nodes.map((_, i) => i).filter((i) => inDegree[i] === 0);
  const visited = new Set<number>();
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    visited.add(u);
    for (const v of adjacency[u]) {
      layer[v] = Math.max(layer[v], layer[u] + 1);
      if (--inDegree[v] === 0) queue.push(v);
    }
  }
  // Anything inside a cycle never drains; park it on the top row.
  nodes.forEach((_, i) => {
    if (!visited.has(i)) layer[i] = 0;
  });
  return layer;
}

/** Turns a Markdown outline into a laid-out diagram. */
export function markdownToDiagram(text: string, locale: Locale = 'en'): DiagramModel {
  const { nodes, edges } = parseMarkdown(text);
  const model = E.createEmptyModel();
  if (!nodes.length) return model;

  const layer = assignLayers(nodes, edges);
  const maxLayer = Math.max(...layer);
  const rows: number[][] = Array.from({ length: maxLayer + 1 }, (_, l) =>
    nodes.map((_, i) => i).filter((i) => layer[i] === l),
  );
  const widest = Math.max(...rows.map((r) => r.length), 1);

  const itemIdByLabel = new Map<string, string>();

  rows.forEach((row, rowIndex) => {
    // Centre each row against the widest one so the result reads as a funnel.
    const offsetX = MARGIN_X + ((widest - row.length) * COL_W) / 2;
    row.forEach((nodeIndex, columnIndex) => {
      const node = nodes[nodeIndex];
      const group = E.addGroup(model, offsetX + columnIndex * COL_W, MARGIN_Y + rowIndex * ROW_H);
      group.title = node.label;

      const palette = PROVIDER_COLORS[providerOf(node.serviceKey)];
      group.fill = palette.fill;

      const container = E.children(model, group.id).find((s) => s.type === 'container');
      if (!container) return;
      container.fill = palette.border;

      const item = E.children(model, container.id).find((s) => s.type === 'item');
      if (!item) return;
      const svc = SERVICE_ICONS.find((s) => s.key === node.serviceKey);
      item.title = node.label;
      item.subtitle = serviceDescription(svc, locale);
      item.icon = { kind: 'symbol', key: node.serviceKey };

      itemIdByLabel.set(normalise(node.label), item.id);
      if (svc && !itemIdByLabel.has(normalise(svc.label))) {
        itemIdByLabel.set(normalise(svc.label), item.id);
      }
    });
  });

  for (const [from, to, label] of edges) {
    const sourceId = itemIdByLabel.get(normalise(from));
    const targetId = itemIdByLabel.get(normalise(to));
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const connector = E.addConnector(model, sourceId, targetId);
    connector.label = label;
  }

  E.routeAllConnectors(model);
  return model;
}
