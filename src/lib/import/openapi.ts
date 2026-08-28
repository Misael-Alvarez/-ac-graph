import { parse as parseYaml } from 'yaml';
import type { NodeSpec } from '@/lib/dsl';
import {
  ImportError,
  environmentFrom,
  keyMaker,
  titleFrom,
  type ImportResult,
  type ImportWarning,
} from './shared';
import { translate, type Locale } from '@/lib/i18n/messages';

/**
 * An OpenAPI description into an architecture.
 *
 * A spec describes one service's surface, not a system, so the diagram it
 * deserves is the API and what it exposes — not two hundred boxes, one per path.
 * Operations group by tag, which is what tags are for and what the spec's own
 * authors already decided; a spec with no tags groups by the first path segment,
 * which is the same decision made implicitly by whoever chose the URLs.
 *
 * The result is a Context-level picture: clients, the API, its resource areas,
 * and anything the spec says it calls out to.
 */

interface Operation {
  tags?: string[];
  summary?: string;
  operationId?: string;
  security?: Record<string, unknown>[];
}

interface Spec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: { url?: string; description?: string }[];
  host?: string;
  tags?: { name?: string; description?: string }[];
  paths?: Record<string, Record<string, Operation> | undefined>;
  components?: { securitySchemes?: Record<string, { type?: string; scheme?: string }> };
  securityDefinitions?: Record<string, { type?: string }>;
  security?: Record<string, unknown>[];
}

const METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);

/** The area an operation belongs to: its first tag, else its first path segment. */
function areaOf(path: string, operation: Operation): string {
  const tag = operation.tags?.[0];
  if (tag) return tag;
  const segment = path.split('/').find((s) => s && !s.startsWith('{'));
  return segment ?? 'root';
}

/** How the API says callers prove who they are, in the words the spec used. */
function authOf(spec: Spec): string | undefined {
  const schemes = spec.components?.securitySchemes ?? spec.securityDefinitions ?? {};
  const first = Object.values(schemes)[0] as { type?: string; scheme?: string } | undefined;
  if (!first) return undefined;
  if (first.type === 'http' && first.scheme)
    return first.scheme === 'bearer' ? 'Bearer' : first.scheme;
  if (first.type === 'oauth2') return 'OAuth2';
  if (first.type === 'apiKey') return 'API key';
  if (first.type === 'openIdConnect') return 'OpenID Connect';
  return first.type;
}

/**
 * `locale` because the labels and subtitles here are *written*, not read out of
 * the description: "Clients" and "4 operations" are this importer's own words,
 * and they end up on the author's diagram. Everything the spec itself says —
 * titles, tag descriptions — is carried through untouched.
 */
export function fromOpenApi(source: string, locale: Locale = 'en'): ImportResult {
  const text = source.trim();
  if (!text) throw new ImportError('Nothing to import.', 'empty');

  let spec: Spec;
  try {
    // A spec is JSON or YAML, and YAML parses JSON, so one path handles both.
    spec = parseYaml(text) as Spec;
  } catch {
    throw new ImportError('That is not readable YAML or JSON.', 'unreadable');
  }

  if (!spec || typeof spec !== 'object' || (!spec.openapi && !spec.swagger)) {
    throw new ImportError('No OpenAPI description found.', 'unrecognised');
  }

  const warnings: ImportWarning[] = [];
  const key = keyMaker();
  const nodes: Record<string, NodeSpec> = {};
  const edges: { from: string; to: string; label: string; style: 'solid' }[] = [];

  const title = spec.info?.title ?? 'API';
  const apiKey = key(title);
  const apiSpec: NodeSpec = { service: 'gen-api', label: title };
  if (spec.info?.version)
    apiSpec.technology = `${spec.openapi ? 'OpenAPI' : 'Swagger'} ${spec.info.version}`;
  const server = spec.servers?.[0]?.url ?? spec.host;
  if (server) {
    const environment = environmentFrom(server);
    if (environment) apiSpec.environment = environment;
  }
  nodes[apiKey] = apiSpec;

  // Whoever calls it. A spec with no client on the diagram is a box with arrows
  // coming out of nowhere, which is the one thing every reader asks about first.
  const clientKey = key('clients');
  nodes[clientKey] = { service: 'gen-user', label: translate(locale, 'import.clients') };
  const auth = authOf(spec);
  edges.push({ from: clientKey, to: apiKey, label: auth ?? 'HTTPS', style: 'solid' });

  const areas = new Map<string, { operations: number; methods: Set<string> }>();
  let operations = 0;

  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (!item || typeof item !== 'object') continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!METHODS.has(method.toLowerCase())) continue;
      operations += 1;
      const area = areaOf(path, operation ?? {});
      const bucket = areas.get(area) ?? { operations: 0, methods: new Set<string>() };
      bucket.operations += 1;
      bucket.methods.add(method.toUpperCase());
      areas.set(area, bucket);
    }
  }

  if (!operations) {
    warnings.push({ kind: 'noOperations' });
  }

  const described = new Map((spec.tags ?? []).map((t) => [t.name ?? '', t.description ?? '']));

  for (const [area, bucket] of areas) {
    const areaKey = key(area);
    const spec_: NodeSpec = {
      service: 'gen-server',
      label: titleFrom(area),
      subtitle: translate(
        locale,
        bucket.operations === 1 ? 'import.operationOne' : 'import.operationMany',
        { count: bucket.operations },
      ),
    };
    const description = described.get(area);
    if (description) spec_.note = description;
    nodes[areaKey] = spec_;

    // The verbs are what the area actually offers, which is more use on a
    // diagram than repeating the tag name on the arrow.
    const verbs = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
      .filter((m) => bucket.methods.has(m))
      .join(' ');
    edges.push({ from: apiKey, to: areaKey, label: verbs, style: 'solid' });
  }

  return {
    format: 'openapi',
    document: { version: 1, nodes, edges, title },
    warnings,
  };
}
