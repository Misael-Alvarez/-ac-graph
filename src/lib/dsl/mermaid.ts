import type { DiagramModel } from '@/lib/domain';
import * as E from '@/lib/engine';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { PROVIDER_COLORS, providerOf } from '@/lib/editor/providers';
import { matchServiceLabel } from './services';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import type { Locale } from '@/lib/i18n/messages';

/**
 * Mermaid interoperability.
 *
 * Mermaid is what a diagram looks like inside a GitHub README or a Notion page,
 * so being able to leave and re-enter through it keeps the editor from being a
 * dead end. Only the flowchart subset is handled — that is what architecture
 * diagrams use.
 */

const ID_SAFE = /[^A-Za-z0-9_]/g;

/** Marks the block of service annotations this editor writes and reads back. */
const SERVICE_HEADER = '%% aion:services';
const SERVICE_LINE = /^%%\s+([A-Za-z0-9_]+):\s*([a-z0-9-]+)\s*$/;

function mermaidId(title: string, taken: Set<string>): string {
  const base = (title.replace(ID_SAFE, '_').replace(/^_+|_+$/g, '') || 'n').slice(0, 24);
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** Escapes a label for use inside Mermaid's `["..."]` node syntax. */
function label(text: string): string {
  return text.replace(/"/g, '#quot;');
}

export interface MermaidOptions {
  /** `TD` top-down (default) or `LR` left-to-right. */
  direction?: 'TD' | 'LR';
}

export function toMermaid(model: DiagramModel, options: MermaidOptions = {}): string {
  const lines = [`flowchart ${options.direction ?? 'TD'}`];
  const taken = new Set<string>();
  const idByItem = new Map<string, string>();

  const boundaries = model.shapes.filter((s) => s.type === 'boundary');
  const items = model.shapes.filter((s) => s.type === 'item');

  /** Group id for an item, used to test boundary membership. */
  const groupOf = (itemId: string) => {
    const item = E.getShape(model, itemId);
    const container = item?.parentId ? E.getShape(model, item.parentId) : undefined;
    return container?.parentId ? E.getShape(model, container.parentId) : undefined;
  };

  for (const item of items) {
    idByItem.set(item.id, mermaidId(item.title || 'node', taken));
  }

  const claimed = new Set<string>();
  for (const boundary of boundaries) {
    const members = items.filter((item) => {
      const group = groupOf(item.id);
      return group ? E.geometricallyContains(E.bbox(boundary), E.bbox(group)) : false;
    });
    if (!members.length) continue;

    lines.push(
      `  subgraph ${mermaidId(boundary.title || 'zone', taken)}["${label(boundary.title ?? '')}"]`,
    );
    for (const item of members) {
      claimed.add(item.id);
      lines.push(`    ${idByItem.get(item.id)}["${label(item.title ?? '')}"]`);
    }
    lines.push('  end');
  }

  for (const item of items) {
    if (claimed.has(item.id)) continue;
    lines.push(`  ${idByItem.get(item.id)}["${label(item.title ?? '')}"]`);
  }

  for (const connector of model.connectors) {
    const from = idByItem.get(connector.sourceId);
    const to = idByItem.get(connector.targetId);
    if (!from || !to) continue;
    const arrow = connector.style === 'dashed' ? '-.->' : '-->';
    lines.push(
      connector.label
        ? `  ${from} ${arrow}|${label(connector.label)}| ${to}`
        : `  ${from} ${arrow} ${to}`,
    );
  }

  // Mermaid carries labels, not service identities: "Load Balancer" could be any
  // cloud's balancer. These comments make our own round trip lossless while
  // staying invisible to every Mermaid renderer.
  const annotated = items.filter((item) => item.icon?.key);
  if (annotated.length) {
    lines.push('', SERVICE_HEADER);
    for (const item of annotated) {
      lines.push(`%%   ${idByItem.get(item.id)}: ${item.icon!.key}`);
    }
  }

  return lines.join('\n');
}

/** `id["Label"]`, `id(Label)`, `id{Label}` and bare `id`. */
const NODE_DECL =
  /^([A-Za-z0-9_]+)\s*(?:\[\[?"?([^"\]]*)"?\]?\]|\("?([^")]*)"?\)|\{"?([^"}]*)"?\})?$/;
const EDGE = /^([A-Za-z0-9_]+)\s*(-\.->|-->|---|==>)\s*(?:\|([^|]*)\|\s*)?([A-Za-z0-9_]+)/;

export interface MermaidImport {
  model: DiagramModel;
  /** Nodes whose label matched no known service and fell back to a plain server. */
  unmatched: string[];
}

/** Reads a Mermaid flowchart into a diagram, matching labels against the catalogue. */
export function fromMermaid(source: string, locale: Locale = 'en'): MermaidImport {
  const labels = new Map<string, string>();
  const annotatedServices = new Map<string, string>();
  const order: string[] = [];
  const edges: { from: string; to: string; label: string; dashed: boolean }[] = [];

  let inServiceBlock = false;

  const declare = (id: string, text?: string) => {
    if (!order.includes(id)) order.push(id);
    if (text && !labels.get(id)) labels.set(id, text);
  };

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();

    if (line === SERVICE_HEADER) {
      inServiceBlock = true;
      continue;
    }
    if (inServiceBlock) {
      const annotation = line.match(SERVICE_LINE);
      if (annotation) {
        annotatedServices.set(annotation[1], annotation[2]);
        continue;
      }
      inServiceBlock = false;
    }

    if (!line || /^(flowchart|graph|subgraph|end|classDef|class|style|%%)/i.test(line)) {
      // Declarations inside a subgraph still matter; only the wrapper is skipped.
      if (!/^subgraph/i.test(line)) continue;
      const inline = line.match(/^subgraph\s+([A-Za-z0-9_]+)/i);
      if (inline) continue;
      continue;
    }

    const edge = line.match(EDGE);
    if (edge) {
      declare(edge[1]);
      declare(edge[4]);
      edges.push({
        from: edge[1],
        to: edge[4],
        label: (edge[3] ?? '').trim(),
        dashed: edge[2] === '-.->',
      });
      continue;
    }

    const node = line.match(NODE_DECL);
    if (node) declare(node[1], (node[2] ?? node[3] ?? node[4] ?? '').trim() || undefined);
  }

  const model = E.createEmptyModel();
  const unmatched: string[] = [];
  const itemIdByNode = new Map<string, string>();

  const COL_W = 560;
  const ROW_H = 300;
  order.forEach((id, index) => {
    const text = labels.get(id) ?? id;
    // An annotation from our own export is authoritative; otherwise fall back to
    // reading the human label, which is all a foreign Mermaid file gives us.
    const annotated = annotatedServices.get(id);
    const matched = annotated ?? matchServiceLabel(text) ?? matchServiceLabel(id);
    if (!matched) unmatched.push(text);
    const serviceKey = matched ?? 'gen-server';

    const group = E.addGroup(model, 80 + (index % 4) * COL_W, 80 + Math.floor(index / 4) * ROW_H);
    group.title = text;
    const palette = PROVIDER_COLORS[providerOf(serviceKey)];
    group.fill = palette.fill;

    const container = E.children(model, group.id).find((s) => s.type === 'container');
    if (!container) return;
    container.fill = palette.border;

    const item = E.children(model, container.id).find((s) => s.type === 'item');
    if (!item) return;
    const service = SERVICE_ICONS.find((s) => s.key === serviceKey);
    item.title = text;
    item.subtitle = serviceDescription(service, locale);
    item.icon = { kind: 'symbol', key: serviceKey };
    itemIdByNode.set(id, item.id);
  });

  for (const edge of edges) {
    const sourceId = itemIdByNode.get(edge.from);
    const targetId = itemIdByNode.get(edge.to);
    if (!sourceId || !targetId) continue;
    const connector = E.addConnector(model, sourceId, targetId);
    connector.label = edge.label;
    connector.style = edge.dashed ? 'dashed' : 'solid';
  }

  E.autoLayout(model);
  return { model, unmatched };
}
