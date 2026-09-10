import { SERVICE_ICONS } from '@/data/serviceIcons';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import type { Locale } from '@/lib/i18n/messages';

/**
 * The clouds a document can default to.
 *
 * The same five the equivalence table can retarget a diagram between. It was
 * three for as long as the catalogue was three: an Oracle or IBM diagram could
 * be drawn but not written down, because `cloud: oci` was not a value the
 * schema accepted.
 */
export type CloudPrefix = 'aws' | 'azure' | 'gcp' | 'oci' | 'ibm';

export const CLOUD_PREFIXES: CloudPrefix[] = ['aws', 'azure', 'gcp', 'oci', 'ibm'];

const PREFIX: Record<CloudPrefix, string> = {
  aws: 'aws-',
  azure: 'az-',
  gcp: 'gcp-',
  oci: 'oci-',
  ibm: 'ibm-',
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Every way a service can be written, mapped to its canonical key.
 *
 * First write wins, and the catalogue is ordered by cloud, so an ambiguous name
 * such as "API Gateway" — which four clouds use — resolves to the same service
 * every time instead of whichever happened to be listed last.
 */
const BY_ALIAS = new Map<string, string>();
const alias = (name: string, key: string) => {
  if (name && !BY_ALIAS.has(name)) BY_ALIAS.set(name, key);
};
for (const service of SERVICE_ICONS) {
  BY_ALIAS.set(service.key, service.key);
  alias(slug(service.key), service.key);
  alias(slug(service.label), service.key);
  // Bare name without the cloud prefix, e.g. `lambda` for `aws-lambda`.
  alias(service.key.replace(/^(aws|az|gcp|oci|ibm|gen|aion)-/, ''), service.key);
}

/**
 * Resolves a service name written in the DSL to a catalogue key.
 *
 * A document may say `lambda`, `aws-lambda` or `Lambda`; with `cloud: aws` set,
 * an unprefixed name resolves inside that cloud first, so the same document can
 * be retargeted by changing one line.
 */
export function resolveService(name: string, cloud?: CloudPrefix): string | null {
  const raw = name.trim();
  if (!raw) return null;
  // An icon the author uploaded is not in the catalogue and needs no alias:
  // its key is its name, and the document carries the picture.
  if (raw.startsWith('custom-')) return raw;

  if (cloud) {
    const prefixed = BY_ALIAS.get(slug(PREFIX[cloud] + raw));
    if (prefixed) return prefixed;
  }
  return BY_ALIAS.get(raw) ?? BY_ALIAS.get(slug(raw)) ?? null;
}

/** Shortest unambiguous way to write a key, given the document's default cloud. */
export function shortenService(key: string, cloud?: CloudPrefix): string {
  if (!cloud) return key;
  return key.startsWith(PREFIX[cloud]) ? key.slice(PREFIX[cloud].length) : key;
}

/** The cloud every service belongs to, or undefined when they are mixed. */
export function dominantCloud(keys: string[]): CloudPrefix | undefined {
  const clouds = new Set<CloudPrefix>();
  for (const key of keys) {
    // Cloud-neutral services do not vote.
    const cloud = CLOUD_PREFIXES.find((candidate) => key.startsWith(PREFIX[candidate]));
    if (cloud) clouds.add(cloud);
  }
  return clouds.size === 1 ? [...clouds][0] : undefined;
}

const TOKENS = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);

/**
 * Cloud preference used to break a tie.
 *
 * Several clouds offer a service under the same name — "API Gateway" exists in
 * four of them — so with no hint the answer has to be deterministic rather than
 * whichever happened to sort first.
 */
const CLOUD_RANK = ['aws-', 'az-', 'gcp-', 'oci-', 'ibm-', 'gen-', 'aion-'];

const rankOf = (key: string) => {
  const index = CLOUD_RANK.findIndex((prefix) => key.startsWith(prefix));
  return index === -1 ? CLOUD_RANK.length : index;
};

/** Every service's label reduced to tokens, most specific label first. */
const LABEL_TOKENS = SERVICE_ICONS.map((service) => ({
  key: service.key,
  tokens: TOKENS(service.label),
  weight: service.label.length,
})).sort((a, b) => b.weight - a.weight || rankOf(a.key) - rankOf(b.key));

/**
 * Loose match of a human-written label to a service.
 *
 * Deliberately separate from `resolveService`, which stays strict: a DSL
 * document naming an unknown service must fail loudly. Mermaid labels are prose
 * written for a reader — "S3 Bucket", "RDS Database" — so importing them needs
 * to look past the extra words. A service matches when every token of its label
 * appears in the text; the longest such label wins.
 */
export function matchServiceLabel(text: string, cloud?: CloudPrefix): string | null {
  const strict = resolveService(text, cloud);
  if (strict) return strict;

  const words = new Set(TOKENS(text));
  if (!words.size) return null;

  const matches = LABEL_TOKENS.filter(
    (candidate) => candidate.tokens.length > 0 && candidate.tokens.every((t) => words.has(t)),
  );
  if (!matches.length) return null;

  // Several clouds can offer the same role under the same label; honour the hint.
  if (cloud) {
    const preferred = matches.find((m) => m.key.startsWith(PREFIX[cloud]));
    if (preferred) return preferred.key;
  }

  // No hint: take the most specific label, and among equals the earliest cloud.
  const best = matches[0].weight;
  return matches.filter((m) => m.weight === best).sort((a, b) => rankOf(a.key) - rankOf(b.key))[0]
    .key;
}

/** Completion candidates for the code editor. */
export function serviceCompletions(cloud?: CloudPrefix, locale: Locale = 'en') {
  return SERVICE_ICONS.map((service) => ({
    label: shortenService(service.key, cloud),
    detail: service.label,
    info: serviceDescription(service, locale) || undefined,
    category: service.category,
  }));
}
