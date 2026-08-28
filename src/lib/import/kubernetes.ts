import { parseAllDocuments } from 'yaml';
import type { DslDocument, NodeSpec } from '@/lib/dsl';
import { KUBERNETES_SERVICES, serviceForImage } from '@/data/resourceServices';
import {
  ImportError,
  environmentFrom,
  keyMaker,
  titleFrom,
  type ImportResult,
  type ImportWarning,
} from './shared';

/**
 * Kubernetes manifests into an architecture.
 *
 * A cluster's manifests already describe an architecture; they just describe it
 * as a list. What is missing from the list — and what a reader wants — is the
 * arrows: which Service fronts which workload, which Ingress admits traffic to
 * which Service. Those are recoverable, because a Service's selector is exactly
 * the statement "I route to whatever carries these labels".
 *
 * Namespaces become boundaries, which is the honest reading: they are the
 * grouping the cluster itself uses.
 */

/* Only the fields this reads. Manifests carry far more, and typing all of it
   would be typing the Kubernetes API rather than an importer. */
interface Manifest {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: {
    selector?: Record<string, unknown> | { matchLabels?: Record<string, string> };
    ports?: { port?: number; targetPort?: number | string; protocol?: string; name?: string }[];
    type?: string;
    replicas?: number;
    template?: { metadata?: { labels?: Record<string, string> }; spec?: PodSpec };
    jobTemplate?: {
      spec?: { template?: { metadata?: { labels?: Record<string, string> }; spec?: PodSpec } };
    };
    rules?: {
      host?: string;
      http?: { paths?: { path?: string; backend?: IngressBackend }[] };
    }[];
  };
}

interface PodSpec {
  containers?: { name?: string; image?: string }[];
}

interface IngressBackend {
  service?: { name?: string; port?: { number?: number; name?: string } };
  serviceName?: string;
}

const WORKLOAD_KINDS = new Set([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Job',
  'CronJob',
  'Pod',
]);

/** Kinds that describe configuration rather than a moving part of the system. */
const IGNORED_KINDS = new Set([
  'Namespace',
  'ServiceAccount',
  'Role',
  'RoleBinding',
  'ClusterRole',
  'ClusterRoleBinding',
  'NetworkPolicy',
  'PodDisruptionBudget',
  'ResourceQuota',
  'LimitRange',
  'CustomResourceDefinition',
]);

interface Entry {
  key: string;
  manifest: Manifest;
  labels: Record<string, string>;
}

const podSpecOf = (m: Manifest): PodSpec | undefined =>
  m.spec?.template?.spec ?? m.spec?.jobTemplate?.spec?.template?.spec;

const podLabelsOf = (m: Manifest): Record<string, string> =>
  m.spec?.template?.metadata?.labels ??
  m.spec?.jobTemplate?.spec?.template?.metadata?.labels ??
  m.metadata?.labels ??
  {};

/** The image a workload runs, taking the first container as the main one. */
function imageOf(m: Manifest): string | undefined {
  return podSpecOf(m)?.containers?.[0]?.image;
}

/**
 * What a workload *is*.
 *
 * The image beats the kind: a StatefulSet running `postgres:16` is a database,
 * and only the image says so. A kind nobody recognises still becomes a node —
 * an operator's custom resource is part of the architecture whether or not this
 * importer has heard of it.
 */
function serviceFor(m: Manifest): string {
  const image = imageOf(m);
  const fromImage = image ? serviceForImage(image) : undefined;
  if (fromImage) return fromImage;
  return KUBERNETES_SERVICES[m.kind ?? ''] ?? 'gen-server';
}

/** Whether a workload's pod labels satisfy a Service's selector. */
function selectorMatches(
  selector: Record<string, string>,
  labels: Record<string, string>,
): boolean {
  const pairs = Object.entries(selector);
  // An empty selector selects everything in Kubernetes, which as an arrow means
  // "this Service points at every workload here" — noise, not information.
  if (!pairs.length) return false;
  return pairs.every(([k, v]) => labels[k] === v);
}

function metaFor(m: Manifest, namespace: string | undefined): Partial<NodeSpec> {
  const labels = m.metadata?.labels ?? {};
  const spec: Partial<NodeSpec> = {};

  const image = imageOf(m);
  // The tag is the version running, which is the useful half of an image
  // reference; the registry path is noise on a diagram.
  if (image) spec.technology = image.split('/').pop();

  const owner = labels['app.kubernetes.io/part-of'] ?? labels['owner'] ?? labels['team'];
  if (owner) spec.owner = owner;

  const environment = environmentFrom(namespace ?? '') ?? environmentFrom(labels['env'] ?? '');
  if (environment) spec.environment = environment;

  const component = labels['app.kubernetes.io/component'];
  if (component) spec.tags = [component];

  return spec;
}

export function fromKubernetes(source: string): ImportResult {
  if (!source.trim()) throw new ImportError('Nothing to import.', 'empty');

  let parsed: unknown[];
  try {
    // Manifests arrive as a `---` separated stream far more often than singly,
    // which is what `kubectl get -o yaml` and every Helm render produce.
    parsed = parseAllDocuments(source)
      .map((d) => d.toJS())
      .filter((d) => d !== null && d !== undefined);
  } catch {
    throw new ImportError('That is not readable YAML.', 'unreadable');
  }

  const manifests = parsed.filter(
    (d): d is Manifest => typeof d === 'object' && d !== null && 'kind' in d,
  );
  if (!manifests.length) throw new ImportError('No Kubernetes manifests found.', 'unrecognised');

  const warnings: ImportWarning[] = [];
  const key = keyMaker();
  const nodes: Record<string, NodeSpec> = {};
  const edges: { from: string; to: string; label: string }[] = [];
  const namespaces = new Map<string, string>();

  const workloads: Entry[] = [];
  const services: Entry[] = [];
  const ingresses: Entry[] = [];

  const boundaryFor = (namespace: string | undefined): string | undefined => {
    if (!namespace || namespace === 'default') return undefined;
    const existing = namespaces.get(namespace);
    if (existing) return existing;
    const boundaryKey = key(namespace);
    namespaces.set(namespace, boundaryKey);
    return boundaryKey;
  };

  for (const m of manifests) {
    const kind = m.kind ?? '';
    if (IGNORED_KINDS.has(kind)) continue;

    const name = m.metadata?.name;
    if (!name) {
      warnings.push({ kind: 'unnamed', values: { what: kind || 'manifest' } });
      continue;
    }

    const namespace = m.metadata?.namespace;
    const nodeKey = key(name);
    const spec: NodeSpec = {
      service: serviceFor(m),
      label: name,
      ...metaFor(m, namespace),
    };
    const boundary = boundaryFor(namespace);
    if (boundary) spec.in = boundary;
    nodes[nodeKey] = spec;

    const entry: Entry = { key: nodeKey, manifest: m, labels: podLabelsOf(m) };
    if (WORKLOAD_KINDS.has(kind)) workloads.push(entry);
    else if (kind === 'Service') services.push(entry);
    else if (kind === 'Ingress') ingresses.push(entry);
    else if (!KUBERNETES_SERVICES[kind]) {
      warnings.push({ kind: 'unknownKind', values: { what: kind } });
    }
  }

  if (!Object.keys(nodes).length) {
    throw new ImportError('No Kubernetes manifests found.', 'unrecognised');
  }

  // A Service's selector is the arrow: it says, in the cluster's own words,
  // which workloads it routes to.
  const serviceKeyByName = new Map<string, string>();
  for (const service of services) {
    const name = service.manifest.metadata?.name;
    if (name) serviceKeyByName.set(name, service.key);

    const selector = (service.manifest.spec?.selector ?? {}) as Record<string, string>;
    const port = service.manifest.spec?.ports?.[0]?.port;
    const label = port ? `:${port}` : '';

    const matched = workloads.filter((w) => selectorMatches(selector, w.labels));
    for (const workload of matched) {
      edges.push({ from: service.key, to: workload.key, label });
    }
    if (!matched.length) {
      warnings.push({ kind: 'serviceSelectsNothing', values: { name: name ?? '' } });
    }
  }

  for (const ingress of ingresses) {
    for (const rule of ingress.manifest.spec?.rules ?? []) {
      for (const path of rule.http?.paths ?? []) {
        const backend = path.backend?.service?.name ?? path.backend?.serviceName;
        const target = backend ? serviceKeyByName.get(backend) : undefined;
        if (!target) {
          if (backend) warnings.push({ kind: 'ingressMissingService', values: { name: backend } });
          continue;
        }
        edges.push({ from: ingress.key, to: target, label: path.path ?? rule.host ?? 'HTTP' });
      }
    }
  }

  const document: DslDocument = {
    version: 1,
    nodes,
    edges: edges.map((e) => ({ ...e, style: 'solid' as const })),
  };
  if (namespaces.size) {
    document.boundaries = Object.fromEntries(
      [...namespaces].map(([name, boundaryKey]) => [
        boundaryKey,
        { label: titleFrom(name), variant: 'outer' as const },
      ]),
    );
  }

  return { format: 'kubernetes', document, warnings };
}
