import { parse as parseYaml } from 'yaml';
import type { DslDocument, NodeSpec } from '@/lib/dsl';
import { matchServiceLabel, resolveService } from '@/lib/dsl/services';
import { serviceForImage } from '@/data/resourceServices';
import {
  ImportError,
  environmentFrom,
  keyMaker,
  titleFrom,
  type ImportResult,
  type ImportWarning,
} from './shared';

/**
 * A Compose file into an architecture.
 *
 * Compose is the one format here that people write *as* an architecture: a
 * service per box, `depends_on` per arrow. There is little to infer and the
 * job is mostly not to lose anything — the image says what a box is, the
 * profiles say which environment it belongs to, and a file that declares
 * several networks has already drawn its own boundaries.
 *
 * What the file cannot say is what a home-built service is. `build: .` names a
 * directory, not a role, so it stays a plain container. A service *name* that
 * states a role outright — `web`, `api`, `cache` — is trusted, but only for a
 * generic role and never for a cloud product: a service called `s3` in a
 * Compose file is an emulator, and drawing it as the real thing would be a lie.
 */

interface ComposeFile {
  name?: unknown;
  services?: Record<string, ComposeService | null | undefined>;
  networks?: Record<string, unknown>;
}

interface ComposeService {
  image?: unknown;
  build?: unknown;
  depends_on?: unknown;
  links?: unknown;
  networks?: unknown;
  profiles?: unknown;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** The names in a list, or the keys of the map form Compose also allows. */
const namesIn = (value: unknown): string[] =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : strings(value);

/**
 * Actors: the people and devices a system serves. Nothing a Compose file runs
 * is one, so `user-api` is an API about users, not a user.
 */
const ACTORS = new Set(['gen-user', 'gen-mobile', 'gen-desktop']);
const ACTOR_WORDS = /\b(users?|mobile|desktop)\b/gi;

/** A generic role the service name states outright, or nothing. */
function roleFromName(name: string): string | undefined {
  // `redis-cache`, `orders-postgres`: the name carries a product the image
  // table already knows.
  const byImage = serviceForImage(name);
  if (byImage) return byImage;
  // `database`, `queue`, `load-balancer`: a role the generic catalogue has.
  const generic = resolveService(`gen-${name}`);
  if (generic && !ACTORS.has(generic)) return generic;
  // `payments-api`: a role among other words, read past the actor words so
  // `user-api` still says API. Only a generic match counts; the loose matcher
  // would happily make `search` an Azure product.
  const role = name.replace(/[_-]+/g, ' ').replace(ACTOR_WORDS, ' ').trim();
  const loose = role ? matchServiceLabel(role) : null;
  return loose?.startsWith('gen-') && !ACTORS.has(loose) ? loose : undefined;
}

/**
 * What a service is, and whether that was a guess.
 *
 * An image the catalogue does not know is a guess worth admitting; a build is
 * the person's own code, and a container is exactly what it is.
 */
function serviceOf(name: string, image: string | undefined): { service: string; guessed: boolean } {
  const fromImage = image ? serviceForImage(image) : undefined;
  if (fromImage) return { service: fromImage, guessed: false };
  const fromName = roleFromName(name);
  if (fromName) return { service: fromName, guessed: false };
  return { service: 'gen-container', guessed: Boolean(image) };
}

export function fromCompose(source: string): ImportResult {
  const text = source.trim();
  if (!text) throw new ImportError('Nothing to import.', 'empty');

  let file: ComposeFile;
  try {
    // `merge` for the `<<: *defaults` idiom half of all Compose files use to
    // share settings; YAML 1.2 dropped it and the parser follows suit unless
    // told. `logLevel` keeps Compose's own `!reset` and `!override` tags,
    // which the parser does not know, from being announced on stderr.
    file = parseYaml(text, { merge: true, logLevel: 'error' }) as ComposeFile;
  } catch {
    throw new ImportError('That is not readable YAML.', 'unreadable');
  }

  const services = file && typeof file === 'object' ? file.services : undefined;
  if (!services || typeof services !== 'object' || Array.isArray(services)) {
    throw new ImportError('No Compose services found.', 'unrecognised');
  }

  const warnings: ImportWarning[] = [];
  const key = keyMaker();
  const nodes: Record<string, NodeSpec> = {};
  const keyByName = new Map<string, string>();
  const unknownImages = new Set<string>();

  // Boundaries only when the file itself segments: one network is the default
  // everything shares, and drawing it around everything would say nothing.
  const declaredNetworks = Object.keys(file.networks ?? {}).filter((n) => n !== 'default');
  const segmented = declaredNetworks.length >= 2;
  const boundaries = new Map<string, string>();

  const entries = Object.entries(services).map(
    ([name, service]) => [name, service ?? {}] as [string, ComposeService],
  );

  for (const [name, service] of entries) {
    const image = typeof service.image === 'string' ? service.image : undefined;
    const { service: resolved, guessed } = serviceOf(name, image);
    if (guessed && image) unknownImages.add(image);

    const nodeKey = key(name);
    keyByName.set(name, nodeKey);
    const spec: NodeSpec = { service: resolved, label: titleFrom(name) };

    // The tag is the version running, which is the useful half of an image
    // reference; the registry path is noise on a diagram.
    if (image)
      spec.technology = image
        .replace(/@sha256:.*$/, '')
        .split('/')
        .pop();
    else if (service.build !== undefined) spec.technology = 'build';

    const profiles = strings(service.profiles);
    if (profiles.length) spec.tags = profiles;
    const environment =
      environmentFrom(name) ?? profiles.map(environmentFrom).find((e) => e !== undefined);
    if (environment) spec.environment = environment;

    const networks = namesIn(service.networks);
    if (segmented && networks.length === 1 && declaredNetworks.includes(networks[0])) {
      const network = networks[0];
      const boundaryKey = boundaries.get(network) ?? key(network);
      boundaries.set(network, boundaryKey);
      spec.in = boundaryKey;
    }

    nodes[nodeKey] = spec;
  }

  const edges: { from: string; to: string; label: string; style: 'solid' }[] = [];
  const drawn = new Set<string>();
  const connect = (fromName: string, toName: string) => {
    const from = keyByName.get(fromName);
    const to = keyByName.get(toName);
    if (!from || !to || from === to || drawn.has(`${from}>${to}`)) return;
    drawn.add(`${from}>${to}`);
    edges.push({ from, to, label: '', style: 'solid' });
  };

  for (const [name, service] of entries) {
    for (const dependency of namesIn(service.depends_on)) connect(name, dependency);
    // A link is `service:alias`; the alias is what the code calls it, the
    // service is what it reaches.
    for (const link of strings(service.links)) connect(name, link.split(':')[0]);
  }

  if (!entries.length) warnings.push({ kind: 'noResources' });
  if (unknownImages.size) {
    warnings.push({
      kind: 'unknownImages',
      values: { images: [...unknownImages].sort().join(', ') },
    });
  }

  const document: DslDocument = { version: 1, nodes, edges };
  if (typeof file.name === 'string' && file.name.trim()) document.title = file.name.trim();
  if (boundaries.size) {
    document.boundaries = Object.fromEntries(
      [...boundaries].map(([network, boundaryKey]) => [
        boundaryKey,
        { label: titleFrom(network), variant: 'sub' as const },
      ]),
    );
  }

  return { format: 'compose', document, warnings };
}
