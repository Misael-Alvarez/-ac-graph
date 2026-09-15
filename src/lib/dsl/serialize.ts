import { Document, YAMLMap, YAMLSeq } from 'yaml';
import type { DiagramModel, Shape } from '@/lib/domain';
import { isDecorative } from '@/lib/domain';
import * as E from '@/lib/engine';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { firstLine } from '@/lib/editor/richText';
import { serviceDescriptions } from '@/lib/i18n/serviceCopy';
import { DSL_VERSION } from './schema';
import { dominantCloud, shortenService, type CloudPrefix } from './services';

function isYAMLMap(node: unknown): node is YAMLMap<unknown, unknown> {
  return node instanceof YAMLMap;
}

/** Turns a title into a short, readable YAML key. */
function toKey(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || 'node';
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

interface NodeRecord {
  key: string;
  group: Shape;
  item: Shape;
}

/** Collects each group together with the single item that represents it. */
function collectNodes(model: DiagramModel): NodeRecord[] {
  const taken = new Set<string>();
  const records: NodeRecord[] = [];

  for (const group of model.shapes.filter((s) => s.type === 'group')) {
    const container = E.children(model, group.id).find((s) => s.type === 'container');
    if (!container) continue;
    const items = E.children(model, container.id)
      .filter((s) => s.type === 'item')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const item of items) {
      records.push({
        key: toKey(item.title || group.title || 'node', taken),
        group,
        item,
      });
    }
  }
  return records;
}

export interface SerializeOptions {
  /** Emit a `layout` block pinning current positions. On by default: without it
   *  a canvas-authored diagram loses its arrangement on the next parse. */
  includeLayout?: boolean;
  title?: string;
}

/**
 * Renders a diagram as DSL source.
 *
 * Round-trips with `parseDsl`: nodes, labels, notes, edges and positions all
 * survive, which is what makes the split code/canvas view safe to edit on
 * either side.
 */
export function serializeDsl(model: DiagramModel, options: SerializeOptions = {}): string {
  const { includeLayout = true } = options;
  const records = collectNodes(model);
  const serviceKeys = records.map((r) => r.item.icon?.key).filter((k): k is string => Boolean(k));
  const cloud = dominantCloud(serviceKeys) as CloudPrefix | undefined;

  const keyByItemId = new Map(records.map((r) => [r.item.id, r.key]));

  const boundaries = model.shapes.filter((s) => s.type === 'boundary');
  const boundaryKeys = new Map<string, string>();
  const takenBoundaryKeys = new Set<string>();
  for (const boundary of boundaries) {
    boundaryKeys.set(boundary.id, toKey(boundary.title || 'boundary', takenBoundaryKeys));
  }

  /** A node belongs to the smallest boundary that geometrically contains it. */
  const boundaryOf = (group: Shape): string | undefined => {
    const containing = boundaries
      .filter((b) => E.geometricallyContains(E.bbox(b), E.bbox(group)))
      .sort((a, b) => a.w * a.h - b.w * b.h);
    return containing[0] ? boundaryKeys.get(containing[0].id) : undefined;
  };

  const nodes: Record<string, unknown> = {};
  for (const record of records) {
    const serviceKey = record.item.icon?.key ?? 'gen-server';
    const service = shortenService(serviceKey, cloud);
    const inBoundary = boundaryOf(record.group);

    const catalogue = SERVICE_ICONS.find((s) => s.key === serviceKey);
    const spec: Record<string, unknown> = { service };
    // A label or subtitle that merely repeats the catalogue is noise: the parser
    // fills both in from the service, so writing them back would only bloat the
    // document and make the round trip look lossy when it is not.
    if (record.item.title && record.item.title !== catalogue?.label) {
      spec.label = record.item.title;
    }
    if (record.item.subtitle && !serviceDescriptions(catalogue).includes(record.item.subtitle)) {
      spec.subtitle = record.item.subtitle;
    }
    if (record.item.note) spec.note = record.item.note;
    if (inBoundary) spec.in = inBoundary;

    // What the node is, written flat beside what it draws.
    const meta = record.item.meta;
    if (meta?.technology) spec.technology = meta.technology;
    if (meta?.owner) spec.owner = meta.owner;
    if (meta?.repository) spec.repository = meta.repository;
    if (meta?.environment) spec.environment = meta.environment;
    if (meta?.criticality) spec.criticality = meta.criticality;
    if (meta?.lifecycle) spec.lifecycle = meta.lifecycle;
    if (meta?.tags?.length) spec.tags = meta.tags;

    // A lock is about where the node sits, so it travels with `layout` and,
    // like it, is left out of a document written without geometry.
    if (includeLayout && record.group.locked) spec.locked = true;

    // Collapse to the `key: service` shorthand when nothing else is set.
    nodes[record.key] = Object.keys(spec).length === 1 ? service : spec;
  }

  const edges = model.connectors
    .map((connector) => {
      const from = keyByItemId.get(connector.sourceId);
      const to = keyByItemId.get(connector.targetId);
      if (!from || !to) return null;
      // The short form says only what the arrow looks like. An edge that also
      // says how the call is made, or how its line is drawn, has to spell
      // itself out. A hand-drawn route is geometry, and follows `layout`.
      const meta = connector.meta;
      const described = meta && Object.values(meta).some(Boolean);
      const drawn =
        connector.sourcePort ||
        connector.targetPort ||
        connector.labelAt !== undefined ||
        connector.color ||
        connector.weight ||
        connector.curve ||
        (includeLayout && connector.manual && connector.waypoints.length >= 2);
      if (connector.style === 'dashed' || described || drawn) {
        const long: Record<string, unknown> = { from, to };
        if (connector.label) long.label = connector.label;
        if (connector.style === 'dashed') long.style = 'dashed';
        if (meta?.protocol) long.protocol = meta.protocol;
        if (meta?.kind) long.kind = meta.kind;
        if (meta?.auth) long.auth = meta.auth;
        if (meta?.dataClass) long.dataClass = meta.dataClass;
        if (includeLayout && connector.manual && connector.waypoints.length >= 2) {
          // Include the ends to retain implicit faces even when the first bend
          // was dragged across the shape. routeThrough removes repeated anchors.
          long.via = connector.waypoints.map((p) => [p.x, p.y]);
        }
        if (connector.sourcePort || connector.targetPort) {
          long.ports = [connector.sourcePort ?? 'auto', connector.targetPort ?? 'auto'];
        }
        if (connector.labelAt !== undefined) long.labelAt = connector.labelAt;
        if (connector.color) long.color = connector.color;
        if (connector.weight) long.weight = connector.weight;
        if (connector.curve) long.curve = connector.curve;
        return long;
      }
      return { [`${from} -> ${to}`]: connector.label };
    })
    .filter(Boolean);

  const document: Record<string, unknown> = { version: DSL_VERSION };
  if (options.title) document.title = options.title;
  if (cloud) document.cloud = cloud;

  if (boundaries.length) {
    document.boundaries = Object.fromEntries(
      boundaries.map((boundary) => [
        boundaryKeys.get(boundary.id)!,
        {
          label: boundary.title ?? '',
          ...(boundary.variant === 'sub' ? { variant: 'sub' } : {}),
          ...(includeLayout && boundary.locked ? { locked: true } : {}),
        },
      ]),
    );
  }

  document.nodes = nodes;
  if (edges.length) document.edges = edges;

  // The decoration, each with its own geometry: there is no service to derive
  // a size from and no layer of the layout to fall back on, so a note that
  // lost its place would have nowhere to go.
  const decorations = model.shapes.filter(isDecorative);
  const decorationKeyById = new Map<string, string>();
  if (decorations.length) {
    const takenNoteKeys = new Set<string>();
    const notes: Record<string, unknown> = {};
    for (const shape of decorations) {
      const key = toKey(firstLine(shape.title ?? '') || shape.type, takenNoteKeys);
      decorationKeyById.set(shape.id, key);
      const spec: Record<string, unknown> = {};
      if (shape.type !== 'note') spec.kind = shape.type;
      if (shape.title) spec.text = shape.title;
      spec.at = [Math.round(shape.x), Math.round(shape.y)];
      spec.size = [Math.round(shape.w), Math.round(shape.h)];
      if (shape.fill) spec.fill = shape.fill;
      if (includeLayout && shape.locked) spec.locked = true;
      notes[key] = spec;
    }
    document.notes = notes;
  }

  if (includeLayout && records.length) {
    const layout: Record<string, [number, number]> = {};
    for (const record of records) {
      layout[record.key] = [Math.round(record.group.x), Math.round(record.group.y)];
    }
    document.layout = layout;
  }

  if (model.rules?.length) document.rules = model.rules;

  if (model.views.length) {
    // A view names nodes by key, and notes by theirs.
    const groupIdByKey = new Map([
      ...records.map((r): [string, string] => [r.group.id, r.key]),
      ...decorationKeyById,
    ]);
    const views: Record<string, unknown> = {};
    // Slugged from the name like every other key in the document. The view's own
    // id is a nanoid, which is the right thing in the model and unreadable in a
    // file somebody is meant to edit — and compile mints fresh ids anyway.
    const takenViewKeys = new Set<string>();

    for (const view of model.views) {
      const spec: Record<string, unknown> = {};
      if (view.name) spec.name = view.name;
      if (view.kind !== 'free') spec.kind = view.kind;

      if (view.include) {
        // Only the groups: a view stores the container and item alongside them,
        // but the document names nodes, and `resolveView` puts the rest back.
        spec.include = view.include
          .map((id) => groupIdByKey.get(id))
          .filter((key): key is string => Boolean(key));
      }

      const place: Record<string, [number, number]> = {};
      for (const [id, box] of Object.entries(view.place ?? {})) {
        const key = groupIdByKey.get(id);
        if (key) place[key] = [Math.round(box.x), Math.round(box.y)];
      }
      if (Object.keys(place).length) spec.place = place;

      views[view.id === E.MAIN_VIEW_ID ? 'main' : toKey(view.name, takenViewKeys)] = spec;
    }

    document.views = views;
  }

  const yaml = new Document(document);
  // Coordinates read far better inline than as a two-line block sequence.
  const flowPairs = (node: unknown) => {
    if (!isYAMLMap(node)) return;
    for (const pair of node.items) {
      if (pair.value instanceof YAMLSeq) pair.value.flow = true;
    }
  };
  flowPairs(yaml.get('layout', true));
  const edgesNode = yaml.get('edges', true);
  if (edgesNode instanceof YAMLSeq) {
    for (const edge of edgesNode.items) {
      if (!isYAMLMap(edge)) continue;
      const via = edge.get('via', true);
      if (via instanceof YAMLSeq) {
        via.flow = true;
        for (const pair of via.items) if (pair instanceof YAMLSeq) pair.flow = true;
      }
      const ports = edge.get('ports', true);
      if (ports instanceof YAMLSeq) ports.flow = true;
    }
  }
  const notesNode = yaml.get('notes', true);
  if (isYAMLMap(notesNode)) {
    for (const pair of notesNode.items) flowPairs(pair.value);
  }
  const viewsNode = yaml.get('views', true);
  if (isYAMLMap(viewsNode)) {
    for (const pair of viewsNode.items) {
      if (isYAMLMap(pair.value)) flowPairs(pair.value.get('place', true));
    }
  }

  return yaml.toString({
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
    flowCollectionPadding: false,
  });
}
