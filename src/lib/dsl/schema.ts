import { z } from 'zod';
import type { ConnectorCurve, ConnectorWeight, EdgeMeta, NodeMeta, Port } from '@/lib/domain';
import { RuleSchema } from '@/lib/rules/schema';
import {
  ViewKindSchema,
  ConnectorCurveSchema,
  ConnectorWeightSchema,
  CriticalitySchema,
  DataClassSchema,
  EdgeKindSchema,
  EnvironmentSchema,
  LifecycleSchema,
  PortSchema,
  ProtocolSchema,
} from '@/lib/domain';

/**
 * The diagram-as-code document.
 *
 * The DSL deliberately does not mirror `DiagramModel`. That model carries the
 * boundary/group/container/item hierarchy and absolute geometry, none of which a
 * developer wants to hand-write. A document here declares intent — which
 * services exist and how they connect — and the engine's auto-layout derives the
 * geometry, with an optional `layout` block to pin anything positioned by hand.
 */

export const DSL_VERSION = 1;

/** Position as `[x, y]`, written by the canvas so manual placement survives. */
export const PositionSchema = z.tuple([z.number(), z.number()]);

export const NodeSpecSchema = z.object({
  /** Service key, with or without a cloud prefix (`lambda` or `aws-lambda`). */
  service: z.string(),
  label: z.string().optional(),
  subtitle: z.string().optional(),
  note: z.string().optional(),
  /** Id of the boundary this node sits inside. */
  in: z.string().optional(),

  /* What the node is, flat rather than under a `meta:` key — the whole point of
     a document you hand-write is that `owner: payments` is one line. */
  technology: z.string().optional(),
  owner: z.string().optional(),
  repository: z.string().optional(),
  environment: EnvironmentSchema.optional(),
  criticality: CriticalitySchema.optional(),
  lifecycle: LifecycleSchema.optional(),
  tags: z.array(z.string()).optional(),
});

/** `fn: lambda` is shorthand for `fn: { service: lambda }`. */
export const NodeEntrySchema = z.union([z.string(), NodeSpecSchema]);

export const BoundarySpecSchema = z.object({
  label: z.string().optional(),
  variant: z.enum(['outer', 'sub']).default('outer'),
  service: z.string().optional(),
});

/**
 * An edge is a single-key map whose key is `from -> to` and whose value is the
 * label: `- api -> fn: invoke`. It reads like a sentence and stays valid YAML.
 * The long form `{ from, to, label, style }` is accepted for anything richer.
 */
export const EdgeLongSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  style: z.enum(['solid', 'dashed']).optional(),
  protocol: ProtocolSchema.optional(),
  kind: EdgeKindSchema.optional(),
  auth: z.string().optional(),
  dataClass: DataClassSchema.optional(),

  /* How the line is drawn, when the author drew it. Geometry, like `layout`:
     written by the canvas so a hand-made route survives the next parse, and
     never something one has to write by hand. */
  /** Points on a manual route; endpoint coordinates also preserve a route with no bends. */
  via: z.array(PositionSchema).optional(),
  /** The faces the line uses: `[from, to]`, either may be `auto`. */
  ports: z.tuple([PortSchema.or(z.literal('auto')), PortSchema.or(z.literal('auto'))]).optional(),
  /** Where the label sits along the line, 0 at `from` and 1 at `to`. */
  labelAt: z.number().min(0).max(1).optional(),
  color: z.string().optional(),
  weight: ConnectorWeightSchema.optional(),
  curve: ConnectorCurveSchema.optional(),
});

/**
 * A named reading of the document.
 *
 * Everything here is keyed by *node key* — the same `api-gateway` the `nodes`
 * and `layout` blocks use — never by shape id. `compile` rebuilds the model with
 * fresh ids on every keystroke in the code panel, so a view written in ids would
 * point at nothing the moment somebody typed. This is the same reason `layout`
 * is keyed the way it is: `views` is to selection what `layout` already is to
 * position.
 */
export const ViewSpecSchema = z.object({
  /** Absent for the main view, which the interface names in the reader's own
   *  language rather than pinning one into the document. */
  name: z.string().default(''),
  kind: ViewKindSchema.default('free'),
  /** Node keys this view shows. Absent means all of them. */
  include: z.array(z.string()).optional(),
  /** Where this view puts a node, when it puts it somewhere of its own. */
  place: z.record(z.string(), PositionSchema).optional(),
});

/**
 * What is written beside the architecture: a note, a free text or a region.
 *
 * Unlike a node, a note has no service to derive anything from — no label, no
 * size, no place in a layer of the auto-layout — so it carries its own
 * geometry inline rather than in `layout`, and is keyed like everything else
 * so a view can `include` it. `text` is the little markup the canvas reads:
 * `**bold**`, `- ` bullets, `# ` headings.
 */
export const NoteSpecSchema = z.object({
  kind: z.enum(['note', 'text', 'region']).default('note'),
  text: z.string().default(''),
  /** Where it sits; a note that says nothing about it is put below the diagram. */
  at: PositionSchema.optional(),
  size: z.tuple([z.number(), z.number()]).optional(),
  /** The note's paper, the region's tint or the text's ink. */
  fill: z.string().optional(),
});

export const DslDocumentSchema = z.object({
  version: z.number().default(DSL_VERSION),
  /** Default cloud used to resolve unprefixed service names. */
  cloud: z.enum(['aws', 'azure', 'gcp', 'oci', 'ibm']).optional(),
  title: z.string().optional(),
  boundaries: z.record(z.string(), BoundarySpecSchema).optional(),
  /** Absent for a page that so far only has notes on it. */
  nodes: z.record(z.string(), NodeEntrySchema).default({}),
  edges: z
    .array(
      z.union([
        EdgeLongSchema,
        // Invalid long-form values must not bypass validation as shorthand.
        z.record(z.string(), z.string()).refine((edge) => !('from' in edge && 'to' in edge)),
      ]),
    )
    .default([]),
  notes: z.record(z.string(), NoteSpecSchema).optional(),
  layout: z.record(z.string(), PositionSchema).optional(),
  views: z.record(z.string(), ViewSpecSchema).optional(),
  /** Standards this architecture holds itself to. See lib/rules. */
  rules: z.array(RuleSchema).optional(),
});

export type Position = z.infer<typeof PositionSchema>;
export type NodeSpec = z.infer<typeof NodeSpecSchema>;
export type BoundarySpec = z.infer<typeof BoundarySpecSchema>;
export type NoteSpec = z.infer<typeof NoteSpecSchema>;
export type DslDocument = z.infer<typeof DslDocumentSchema>;

/** An edge after both notations have been reduced to one shape. */
export interface NormalisedEdge {
  from: string;
  to: string;
  label: string;
  style: 'solid' | 'dashed';
  meta?: EdgeMeta;
  /** The line as drawn, when the long form said so. */
  line?: EdgeLine;
}

export interface EdgeLine {
  via?: Position[];
  sourcePort?: Port;
  targetPort?: Port;
  labelAt?: number;
  color?: string;
  weight?: ConnectorWeight;
  curve?: ConnectorCurve;
}

/** The parts of a node spec that describe the service rather than draw it. */
export function pickNodeMeta(spec: NodeSpec): NodeMeta | undefined {
  const meta: NodeMeta = {};
  if (spec.technology) meta.technology = spec.technology;
  if (spec.owner) meta.owner = spec.owner;
  if (spec.repository) meta.repository = spec.repository;
  if (spec.environment) meta.environment = spec.environment;
  if (spec.criticality) meta.criticality = spec.criticality;
  if (spec.lifecycle) meta.lifecycle = spec.lifecycle;
  if (spec.tags?.length) meta.tags = spec.tags;
  return Object.keys(meta).length ? meta : undefined;
}

/** Matches `a -> b`, and tolerates `-->` and `→`. */
const ARROW = /^(.+?)\s*(?:->|-->|→)\s*(.+)$/;

/** The parts of a long-form edge that describe the call rather than the line. */
function pickEdgeMeta(edge: z.infer<typeof EdgeLongSchema>): EdgeMeta | undefined {
  const meta: EdgeMeta = {};
  if (edge.protocol) meta.protocol = edge.protocol;
  if (edge.kind) meta.kind = edge.kind;
  if (edge.auth) meta.auth = edge.auth;
  if (edge.dataClass) meta.dataClass = edge.dataClass;
  return Object.keys(meta).length ? meta : undefined;
}

/** The parts of a long-form edge that say how the line is drawn. */
function pickEdgeLine(edge: z.infer<typeof EdgeLongSchema>): EdgeLine | undefined {
  const line: EdgeLine = {};
  if (edge.via?.length) line.via = edge.via;
  if (edge.ports?.[0] && edge.ports[0] !== 'auto') line.sourcePort = edge.ports[0];
  if (edge.ports?.[1] && edge.ports[1] !== 'auto') line.targetPort = edge.ports[1];
  if (edge.labelAt !== undefined) line.labelAt = edge.labelAt;
  if (edge.color) line.color = edge.color;
  if (edge.weight) line.weight = edge.weight;
  if (edge.curve) line.curve = edge.curve;
  return Object.keys(line).length ? line : undefined;
}

export function normaliseEdges(edges: DslDocument['edges']): NormalisedEdge[] {
  const out: NormalisedEdge[] = [];
  for (const edge of edges) {
    if ('from' in edge && typeof edge.from === 'string' && 'to' in edge) {
      const long = edge as z.infer<typeof EdgeLongSchema>;
      out.push({
        from: long.from,
        to: long.to,
        label: long.label ?? '',
        style: long.style ?? 'solid',
        meta: pickEdgeMeta(long),
        line: pickEdgeLine(long),
      });
      continue;
    }
    for (const [key, value] of Object.entries(edge as Record<string, string>)) {
      const match = key.match(ARROW);
      if (!match) continue;
      out.push({
        from: match[1].trim(),
        to: match[2].trim(),
        label: typeof value === 'string' ? value : '',
        style: 'solid',
      });
    }
  }
  return out;
}

export function normaliseNode(entry: z.infer<typeof NodeEntrySchema>): NodeSpec {
  return typeof entry === 'string' ? { service: entry } : entry;
}
