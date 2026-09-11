/**
 * Domain schemas for the diagram model.
 *
 * These Zod schemas are the single source of truth: every TypeScript type in the
 * app is derived from them with `z.infer`. Anything read from persistence (local
 * IndexedDB today, a remote API later) is parsed through `parseDiagramModel`, so
 * a corrupt or outdated payload fails loudly at the boundary instead of leaking
 * malformed shapes into the editor.
 */
import { z } from 'zod';
import { RuleSchema } from '@/lib/rules/schema';

/**
 * Bumped whenever a stored model needs a migration.
 *
 * 4: `region`, `note` and `text` shapes. Additive, so every earlier document
 * reads unchanged and is re-stamped on the way in; a document written by a
 * *later* build is refused rather than opened with whatever this build happens
 * to understand of it.
 */
export const CURRENT_SCHEMA_VERSION = 4;

/**
 * What a shape is, in paint order.
 *
 * `boundary`, `group`, `container` and `item` are the cloud family: a service
 * is an item inside a container inside a group, and the analysis, the DSL and
 * the cloud switch all read that hierarchy. The other three are decoration —
 * a tinted `region` under everything, a `note` and a free `text` over it — and
 * mean nothing to any of those: they are for the reader, not for the model.
 */
export const ShapeTypeSchema = z.enum([
  'region',
  'boundary',
  'group',
  'container',
  'item',
  'note',
  'text',
]);

const DECORATIVE_TYPES: ReadonlySet<string> = new Set(['region', 'note', 'text']);

/** Whether a shape is decoration: drawn, never counted, connected or analysed. */
export function isDecorative(shape: { type: string }): boolean {
  return DECORATIVE_TYPES.has(shape.type);
}
export const BoundaryVariantSchema = z.enum(['outer', 'sub']);
export const ConnectorStyleSchema = z.enum(['solid', 'dashed']);
export const StackedGapSchema = z.enum(['tight', 'wide']);
export const CloudProviderSchema = z.enum(['aws', 'azure', 'gcp', 'oci', 'ibm', 'aion', 'generic']);

export const IconRefSchema = z.object({
  kind: z.enum(['symbol', 'logo']),
  key: z.string(),
});

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

/**
 * The fills the engine used to write into every shape it created.
 *
 * They were theme colours, not choices: a group was born `#FAFBFC` whatever the
 * theme, so in dark mode a diagram came back as white cards on a dark canvas.
 * A shape carries no fill now — an absent fill means "whatever the theme says"
 * — and these are dropped on the way in so diagrams written by the old engine
 * follow the theme as well.
 *
 * Compared case-sensitively on purpose: the engine wrote them upper-case and a
 * colour input only ever produces lower-case, so a fill somebody deliberately
 * set to this exact grey is left alone.
 */
const LEGACY_THEME_FILLS: Record<string, string> = {
  boundary: '#F8F9FA',
  group: '#FAFBFC',
  container: '#9AA0A6',
  item: '#F1F3F4',
};

/**
 * What a node is, beyond where it sits.
 *
 * The diagram was a drawing: geometry and decoration, with nothing that says
 * what a box *is*. Everything worth building on top — who to call when it
 * breaks, what talks to it, whether it may hold customer data — needs the model
 * to carry that, so it lives here rather than in a note field nobody can query.
 *
 * Every field is optional on purpose. A form of twenty required boxes is a form
 * nobody fills, and a diagram is useful long before it is fully described.
 */
export const EnvironmentSchema = z.enum(['dev', 'qa', 'staging', 'prod']);
export const CriticalitySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const LifecycleSchema = z.enum(['planned', 'active', 'deprecated', 'retired']);

export const NodeMetaSchema = z.object({
  /** What it is built with: `FastAPI`, `PostgreSQL 16`, `Node 20`. */
  technology: z.string().optional(),
  /** The team that answers for it. */
  owner: z.string().optional(),
  repository: z.string().optional(),
  environment: EnvironmentSchema.optional(),
  criticality: CriticalitySchema.optional(),
  lifecycle: LifecycleSchema.optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * What an arrow means.
 *
 * `A -> B` says almost nothing. Whether the call is synchronous, what protocol
 * carries it and whether customer data travels along it are the difference
 * between a picture and something that can be checked.
 */
export const ProtocolSchema = z.enum([
  'http',
  'https',
  'grpc',
  'websocket',
  'kafka',
  'amqp',
  'sql',
  'redis',
  'file',
  'other',
]);
export const EdgeKindSchema = z.enum(['sync', 'async', 'event', 'data', 'dependency']);
export const DataClassSchema = z.enum(['public', 'internal', 'confidential', 'pii', 'pci', 'phi']);

export const EdgeMetaSchema = z.object({
  protocol: ProtocolSchema.optional(),
  kind: EdgeKindSchema.optional(),
  /** How the caller proves who it is: `OAuth2`, `mTLS`, `API key`. */
  auth: z.string().optional(),
  /** What travels along it, for data-flow and privacy questions. */
  dataClass: DataClassSchema.optional(),
});

/**
 * A named way of looking at the same architecture.
 *
 * The model is the truth; a view is a reading of it. One service exists once and
 * can appear in the executive view, the payments view and the PCI-scope view
 * without being copied — so renaming it renames it everywhere, which is the
 * whole reason not to keep three diagram files instead.
 *
 * A view is deliberately *thin*. It says which shapes it includes and, only
 * where somebody dragged something, where it puts them; everything else falls
 * back to the shape's own geometry. That keeps an existing diagram working
 * untouched — it is simply a model whose single view overrides nothing — and
 * leaves the engine, the DSL, the diff and the renderer unaware that views
 * exist at all.
 */
export const ViewKindSchema = z.enum([
  /* The default. A view is a selection, not a methodology: C4's levels are
     offered below because they help, never because the tool insists. */
  'free',
  'context',
  'container',
  'component',
  'deployment',
  'dataflow',
  'security',
]);

export const ViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: ViewKindSchema.default('free'),
  /**
   * Shape ids this view shows. Absent means "everything" — which is what the
   * main view of every existing diagram means, and storing it as absence keeps
   * that view from having to be rewritten every time a shape is added.
   */
  include: z.array(z.string()).optional(),
  /** Per-view geometry, written only for a shape actually moved in this view. */
  place: z.record(z.string(), BBoxSchema).optional(),
});

export const ShapeSchema = z
  .object({
    id: z.string(),
    type: ShapeTypeSchema,
    parentId: z.string().nullable(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    /** The name — or, for a note and a text, the whole of what they say. */
    title: z.string().optional(),
    subtitle: z.string().optional(),
    note: z.string().optional(),
    /** A colour of the author's: a card's fill, a region's tint, a note's paper, a text's ink. */
    fill: z.string().optional(),
    icon: IconRefSchema.optional(),
    variant: BoundaryVariantSchema.optional(),
    stacked_gap: StackedGapSchema.optional(),
    order: z.number().optional(),
    manualSize: z.boolean().optional(),
    meta: NodeMetaSchema.optional(),
  })
  .transform((shape) =>
    shape.fill && LEGACY_THEME_FILLS[shape.type] === shape.fill
      ? { ...shape, fill: undefined }
      : shape,
  );

export const ConnectorSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  label: z.string().default(''),
  style: ConnectorStyleSchema.default('solid'),
  waypoints: z.array(PointSchema).default([]),
  meta: EdgeMetaSchema.optional(),
});

/**
 * An icon of the author's own.
 *
 * Either a vector — the sanitised body of an SVG with its viewBox — or a
 * raster as a data URL. The key carries the `custom-` prefix, which is how the
 * renderer, the DSL and the icon picker tell it from the catalogue.
 */
export const CustomIconSchema = z.object({
  key: z.string().regex(/^custom-[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1).max(60),
  description: z.string().max(240).optional(),
  /** Where it comes from, in the author's words: a vendor, a team, "internal". */
  source: z.string().max(40).optional(),
  tags: z.array(z.string().max(30)).max(12).optional(),
  svg: z.object({ viewBox: z.string(), body: z.string().max(200_000) }).optional(),
  image: z.string().max(400_000).optional(),
  createdAt: z.string(),
});

export const DiagramModelSchema = z.object({
  /**
   * Absent in pre-versioned files written by the original editor. Every
   * version up to the current one reads as the current one — the changes so
   * far have all been additive — and comes out stamped with it; a higher one
   * is a document from a newer build, and is refused rather than quietly read
   * as less than it is.
   */
  schemaVersion: z
    .number()
    .max(CURRENT_SCHEMA_VERSION, { message: 'Written by a newer version of AC Graph' })
    .default(CURRENT_SCHEMA_VERSION)
    .transform(() => CURRENT_SCHEMA_VERSION),
  canvas: z.object({ w: z.number(), h: z.number() }),
  shapes: z.array(ShapeSchema),
  connectors: z.array(ConnectorSchema),
  showFooter: z.boolean().default(false),
  /**
   * Empty for every diagram written before views existed, and for any diagram
   * the author never split. `resolveView` reads that as one implicit view over
   * the whole model, so there is nothing to migrate.
   */
  views: z.array(ViewSchema).default([]),
  /**
   * The standards this architecture holds itself to.
   *
   * On the model rather than beside it so they ride the same persistence,
   * history, share link and export path as the diagram — a rule kept somewhere
   * else is a rule that goes missing the first time somebody sends the diagram
   * to a colleague.
   */
  rules: z.array(RuleSchema).optional(),
  /**
   * Icons the author uploaded, embedded so the document is self-contained: a
   * shared link, an export or a colleague's browser all draw them without
   * knowing where they came from. Absent on every document made before they
   * existed and on any that uses only the catalogue.
   */
  customIcons: z.array(CustomIconSchema).optional(),
});

export type Environment = z.infer<typeof EnvironmentSchema>;
export type Criticality = z.infer<typeof CriticalitySchema>;
export type Lifecycle = z.infer<typeof LifecycleSchema>;
export type NodeMeta = z.infer<typeof NodeMetaSchema>;
export type Protocol = z.infer<typeof ProtocolSchema>;
export type EdgeKind = z.infer<typeof EdgeKindSchema>;
export type DataClass = z.infer<typeof DataClassSchema>;
export type EdgeMeta = z.infer<typeof EdgeMetaSchema>;
export type ShapeType = z.infer<typeof ShapeTypeSchema>;
export type BoundaryVariant = z.infer<typeof BoundaryVariantSchema>;
export type ConnectorStyle = z.infer<typeof ConnectorStyleSchema>;
export type StackedGap = z.infer<typeof StackedGapSchema>;
export type CloudProvider = z.infer<typeof CloudProviderSchema>;
export type IconRef = z.infer<typeof IconRefSchema>;
export type Point = z.infer<typeof PointSchema>;
export type BBox = z.infer<typeof BBoxSchema>;
export type Shape = z.infer<typeof ShapeSchema>;
export type ViewKind = z.infer<typeof ViewKindSchema>;
export type View = z.infer<typeof ViewSchema>;
export type Connector = z.infer<typeof ConnectorSchema>;
export type CustomIcon = z.infer<typeof CustomIconSchema>;
export type DiagramModel = z.infer<typeof DiagramModelSchema>;

/** Throws a ZodError when the payload is not a usable diagram. */
export function parseDiagramModel(raw: unknown): DiagramModel {
  return DiagramModelSchema.parse(raw);
}

/** Non-throwing variant for untrusted input (file import, pasted JSON). */
export function safeParseDiagramModel(raw: unknown) {
  return DiagramModelSchema.safeParse(raw);
}
