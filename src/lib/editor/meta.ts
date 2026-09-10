import type { Connector, EdgeMeta, NodeMeta, Shape } from '@/lib/domain';
import { isDarkCanvas, mixHex, type CanvasTheme } from '@/lib/design/tokens';

/**
 * How the facts recorded about a service or a call are drawn on the canvas.
 *
 * The inspector lets an author say that a service runs in `prod`, is
 * `critical`, is built on FastAPI and belongs to a team; and that a call is
 * asynchronous, goes over gRPC, is authenticated and carries PII. Until this
 * module existed those answers were stored and exported and never seen: a
 * diagram with a full inventory looked identical to one with none. The rules
 * here turn each fact into one small, consistent mark — a chip on the card, a
 * dash pattern or a tag on the arrow — so the drawing says what the data says.
 *
 * Everything is derived; nothing is stored. The words on the chips are the
 * DSL's own (`prod`, `pii`) so that what is read here matches what is written
 * in the YAML panel, in both interface languages.
 */

/** The hue a mark takes; the theme decides how loud it is. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export interface Badge {
  /** The word on the chip, already upper-cased by the renderer. */
  text: string;
  tone: Tone;
  /** What the badge stands for, for a tooltip or a screen reader. */
  kind: 'environment' | 'criticality' | 'lifecycle' | 'technology' | 'owner' | 'repository' | 'tag';
}

export interface ToneColors {
  fill: string;
  text: string;
  stroke: string;
}

const TONE_BASE: Record<Tone, string> = {
  neutral: '#64748b',
  info: '#0284c7',
  success: '#15803d',
  warning: '#d97706',
  danger: '#dc2626',
  accent: '#6d28d9',
};

/**
 * Colours for a tone on a given card background, in the current theme.
 *
 * A chip is a tint of its hue over the card it sits on rather than a saturated
 * block: on a dark card the tint is stronger and the text lighter, on paper the
 * tint is faint and the text darker, so the same `prod` reads as the same
 * green in both without shouting in either.
 */
export function toneColors(tone: Tone, background: string, theme: CanvasTheme): ToneColors {
  const base = TONE_BASE[tone];
  const dark = isDarkCanvas(theme);
  return {
    fill: mixHex(background, base, dark ? 0.28 : 0.13),
    text: dark ? mixHex(base, '#ffffff', 0.42) : mixHex(base, '#000000', 0.2),
    stroke: mixHex(background, base, dark ? 0.5 : 0.3),
  };
}

const ENVIRONMENT_TONE: Record<NonNullable<NodeMeta['environment']>, Tone> = {
  dev: 'neutral',
  qa: 'info',
  staging: 'warning',
  prod: 'success',
};

const CRITICALITY_TONE: Record<NonNullable<NodeMeta['criticality']>, Tone> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};

const LIFECYCLE_TONE: Record<NonNullable<NodeMeta['lifecycle']>, Tone> = {
  planned: 'accent',
  active: 'success',
  deprecated: 'warning',
  retired: 'neutral',
};

/**
 * The short name of a repository: the last path segment, without `.git`.
 *
 * `github.com/aion/payments-api.git` and `aion/payments-api` are both the
 * repository `payments-api`, and the card has room for that and not the rest.
 */
export function repositoryName(repository: string): string {
  const trimmed = repository
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  const segment = trimmed.split('/').filter(Boolean).at(-1) ?? trimmed;
  return segment || trimmed;
}

/**
 * The chips a service card shows, in reading order.
 *
 * Environment first because it is the question asked most often of a diagram
 * ("is this prod?"), then how much it matters, then where it is in its life —
 * but `active` is the default state of anything drawn and says nothing, so it
 * is left off. Then the names: what it is built with, who answers for it
 * (`@team`, the way a handle is written), which repository holds it, and its
 * tags (`#tag`). Every field the inspector offers has a chip; a fact typed
 * into the panel and never seen again was the reason this exists.
 */
export function itemBadges(shape: Pick<Shape, 'meta'>): Badge[] {
  const meta = shape.meta;
  if (!meta) return [];
  const badges: Badge[] = [];
  if (meta.environment) {
    badges.push({
      text: meta.environment,
      tone: ENVIRONMENT_TONE[meta.environment],
      kind: 'environment',
    });
  }
  if (meta.criticality) {
    badges.push({
      text: meta.criticality,
      tone: CRITICALITY_TONE[meta.criticality],
      kind: 'criticality',
    });
  }
  if (meta.lifecycle && meta.lifecycle !== 'active') {
    badges.push({ text: meta.lifecycle, tone: LIFECYCLE_TONE[meta.lifecycle], kind: 'lifecycle' });
  }
  if (meta.technology) badges.push({ text: meta.technology, tone: 'neutral', kind: 'technology' });
  if (meta.owner) badges.push({ text: `@${meta.owner}`, tone: 'neutral', kind: 'owner' });
  if (meta.repository) {
    badges.push({ text: repositoryName(meta.repository), tone: 'accent', kind: 'repository' });
  }
  for (const tag of meta.tags ?? []) {
    if (tag.trim()) badges.push({ text: `#${tag.trim()}`, tone: 'info', kind: 'tag' });
  }
  return badges;
}

/** The width of the small glyph drawn before a repository name. */
export const REPO_GLYPH_W = 9;

/** Roughly how wide a chip with this text is, in canvas units. */
export function badgeWidth(text: string, fontSizePx: number, kind?: Badge['kind']): number {
  // Upper-case small caps are wider than lower-case; 0.62em is a fair average
  // for a semibold sans at this size, plus the padding either side.
  return (
    Math.ceil(text.length * fontSizePx * 0.62) + 12 + (kind === 'repository' ? REPO_GLYPH_W : 0)
  );
}

export interface FittedBadges {
  kept: Badge[];
  /** How many did not fit; drawn as a `+N` chip when there is room for it. */
  hidden: number;
}

/**
 * Which of the badges fit on a card of this width, in order, never a partial.
 *
 * A chip clipped in half is worse than a chip left off: the first is a bug the
 * reader sees, the second is a diagram that says less than it knows — and the
 * inspector still holds the rest. When something is left off, the card says
 * how much with a `+N` chip, so a reader knows to open the inspector.
 */
export function fitBadges(
  badges: Badge[],
  width: number,
  fontSizePx: number,
  gap = 4,
): FittedBadges {
  const kept: Badge[] = [];
  let used = 0;
  for (let i = 0; i < badges.length; i++) {
    const badge = badges[i];
    const w = badgeWidth(badge.text, fontSizePx, badge.kind);
    const remaining = badges.length - i - 1;
    // Leave room for the `+N` chip if this is not the last one and the rest
    // would not all fit anyway.
    const reserve = remaining > 0 ? badgeWidth(`+${remaining}`, fontSizePx) + gap : 0;
    const restWidth = badges
      .slice(i + 1)
      .reduce((sum, b) => sum + badgeWidth(b.text, fontSizePx, b.kind) + gap, 0);
    const needsReserve = used + w + gap + restWidth > width;
    if (used + w + (needsReserve ? reserve : 0) > width) break;
    kept.push(badge);
    used += w + gap;
  }
  return { kept, hidden: badges.length - kept.length };
}

/** How a planned, deprecated or retired service is drawn, beyond its chips. */
export function lifecycleStyle(shape: Pick<Shape, 'meta'>): {
  dashed: boolean;
  opacity: number;
} {
  const lifecycle = shape.meta?.lifecycle;
  return {
    // Planned: an outline of something that does not exist yet.
    dashed: lifecycle === 'planned',
    // Retired: still on the map, no longer in the way.
    opacity: lifecycle === 'retired' ? 0.55 : 1,
  };
}

const PROTOCOL_LABEL: Record<NonNullable<EdgeMeta['protocol']>, string> = {
  http: 'HTTP',
  https: 'HTTPS',
  grpc: 'gRPC',
  websocket: 'WebSocket',
  kafka: 'Kafka',
  amqp: 'AMQP',
  sql: 'SQL',
  redis: 'Redis',
  file: 'File',
  other: '',
};

/** The word for a protocol as an engineer would write it, or nothing. */
export function protocolLabel(protocol: EdgeMeta['protocol']): string {
  return protocol ? PROTOCOL_LABEL[protocol] : '';
}

/**
 * The text on a connector's chip: what the author wrote, or failing that the
 * protocol, so a call described only in the inspector still names itself.
 */
export function connectorLabel(connector: Pick<Connector, 'label' | 'meta'>): string {
  return connector.label || protocolLabel(connector.meta?.protocol);
}

export interface StrokeStyle {
  dasharray?: string;
  width: number;
}

/**
 * How a kind of call is stroked.
 *
 * Sync is the plain line every arrow was before kinds existed. Async and
 * events are broken lines — the caller does not wait — with events the finer
 * of the two. A data flow is a pipe: heavier. A dependency is the faintest,
 * a short dash: nothing travels along it at runtime. An explicit `dashed`
 * style set by hand wins over the kind; the author asked for it.
 */
export function strokeFor(connector: Pick<Connector, 'style' | 'meta'>): StrokeStyle {
  if (connector.style === 'dashed') return { dasharray: '7 5', width: 1.8 };
  switch (connector.meta?.kind) {
    case 'async':
      return { dasharray: '8 6', width: 1.8 };
    case 'event':
      return { dasharray: '2 5', width: 1.8 };
    case 'data':
      return { width: 2.6 };
    case 'dependency':
      return { dasharray: '3 4', width: 1.4 };
    default:
      return { width: 1.8 };
  }
}

const DATA_CLASS_TONE: Record<NonNullable<EdgeMeta['dataClass']>, Tone> = {
  public: 'neutral',
  internal: 'neutral',
  confidential: 'warning',
  pii: 'danger',
  pci: 'danger',
  phi: 'danger',
};

export interface EdgeTag {
  text: string;
  tone: Tone;
  kind: 'protocol' | 'dataClass' | 'auth';
}

/**
 * The small tags beside a connector's label: the protocol, what the call
 * carries, and how it is authenticated.
 *
 * The protocol is a tag whenever the label does not already say it — an arrow
 * labelled "Pagos" over gRPC shows both, one labelled "gRPC" shows it once.
 * Every data class is tagged, `public` included: an answer given in the
 * inspector must be visible on the arrow, or the field is decoration. The
 * regulated classes are red because a reader scanning for scope has to find
 * them at a glance.
 */
export function connectorTags(connector: Pick<Connector, 'label' | 'meta'>): EdgeTag[] {
  const tags: EdgeTag[] = [];
  const protocol = protocolLabel(connector.meta?.protocol);
  if (
    protocol &&
    connector.label &&
    connector.label.trim().toLowerCase() !== protocol.toLowerCase()
  ) {
    tags.push({ text: protocol, tone: 'accent', kind: 'protocol' });
  }
  const dataClass = connector.meta?.dataClass;
  if (dataClass)
    tags.push({ text: dataClass, tone: DATA_CLASS_TONE[dataClass], kind: 'dataClass' });
  if (connector.meta?.auth) tags.push({ text: connector.meta.auth, tone: 'info', kind: 'auth' });
  return tags;
}
