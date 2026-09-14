import type { DslDocument, NodeSpec } from '@/lib/dsl';
import { dominantCloud } from '@/lib/dsl/services';
import { serviceForPulumiType } from '@/data/resourceServices';
import {
  ImportError,
  environmentFrom,
  keyMaker,
  titleFrom,
  wordsFrom,
  type ImportResult,
  type ImportWarning,
} from './shared';

/**
 * Pulumi into an architecture.
 *
 * Two inputs, for the same reason as Terraform: `pulumi stack export` is what
 * exists, and `pulumi preview --json` is what is about to. Both carry the same
 * resource records — a URN, a type, the inputs, and the URNs this one depends
 * on — so one reader serves both once the preview's steps are unwrapped.
 *
 * What a Pulumi program has that a Terraform plan lacks is components: a class
 * somebody wrote to mean "the orders service", with the queue, the function
 * and the table created inside it. The `parent` chain records that, and it is
 * the best grouping a diagram could ask for, so a component with anything in
 * it becomes a boundary. Nested components fold into the outermost one: the
 * author's own grouping, not the library's.
 */

interface PulumiResource {
  urn?: string;
  type?: string;
  custom?: boolean;
  parent?: string;
  /** Set on an export while the resource is still being torn down. */
  delete?: boolean;
  dependencies?: unknown;
  propertyDependencies?: Record<string, unknown> | null;
}

interface PulumiJson {
  version?: number;
  deployment?: { resources?: PulumiResource[] };
  steps?: ({ op?: string; urn?: string; newState?: PulumiResource | null } | null)[];
}

/** Steps whose resource is going away, and so has no place in a picture of what will exist. */
const DELETING = new Set([
  'delete',
  'delete-replaced',
  'discard',
  'discard-replaced',
  'remove-pending-replace',
  'read-discard',
]);

/**
 * Providers whose resources are Pulumi's own bookkeeping, or values rather
 * than infrastructure: a random password is not a box on a diagram.
 */
const IGNORED_PROVIDERS = new Set(['pulumi', 'random', 'tls', 'time', 'null', 'command', 'std']);

/**
 * Types the catalogue would draw that a diagram does not want: a subnet is a
 * line in a VPC, an IAM role is a permission, a log group is a side effect.
 * Checked before the catalogue, which is what keeps them out — and why the
 * Kubernetes kinds the manifest reader ignores are here rather than among the
 * families below: every `kubernetes:` type has a catalogue answer.
 */
const PLUMBING_TYPES = [
  'aws:iam/',
  'aws:ec2/subnet:',
  'aws:ec2/natGateway:',
  'aws:cloudwatch/log',
  'kubernetes:core/v1:Namespace',
  'kubernetes:core/v1:ServiceAccount',
  'kubernetes:core/v1:ResourceQuota',
  'kubernetes:core/v1:LimitRange',
  'kubernetes:rbac.authorization.k8s.io/',
  'kubernetes:networking.k8s.io/v1:NetworkPolicy',
  'kubernetes:policy/',
  'kubernetes:apiextensions.k8s.io/',
];

/**
 * Families whose members are wiring unless the catalogue names one outright:
 * `aws:ec2/vpc:Vpc` is a node, the route tables around it are not. Anything
 * outside these families that the catalogue cannot place is still drawn, as a
 * plain server and with a warning — a SageMaker endpoint is architecture
 * whether or not this has heard of it.
 */
const PLUMBING_FAMILIES = [
  // AWS
  'aws:ec2/',
  'aws:apigateway/',
  'aws:apigatewayv2/',
  'aws:lambda/',
  'aws:lb/',
  'aws:alb/',
  'aws:elb/',
  'aws:cognito/',
  'aws:autoscaling/',
  'aws:appautoscaling/',
  'aws:acm/',
  'aws:s3/',
  'aws:sqs/',
  'aws:sns/',
  'aws:kms/',
  'aws:ecr/',
  'aws:cloudfront/',
  'aws:route53/',
  'aws:secretsmanager/',
  'aws:ssm/',
  'aws:servicediscovery/',
  'aws:cloudwatch/',
  'aws:ecs/',
  'aws:eks/',
  'aws:rds/',
  'aws:elasticache/',
  'aws:dynamodb/',
  'aws:efs/',
  'aws:kinesis/',
  'aws:glue/',
  'aws:athena/',
  'aws:batch/',
  'aws:sfn/',
  // Azure
  'azure-native:resources:',
  'azure-native:authorization:',
  'azure-native:managedidentity:',
  'azure-native:insights:',
  'azure-native:operationalinsights:',
  'azure-native:network:',
  'azure-native:storage:',
  'azure-native:web:',
  'azure-native:keyvault:',
  'azure-native:sql:',
  'azure-native:documentdb:',
  'azure-native:app:',
  'azure-native:servicebus:',
  'azure-native:eventhub:',
  'azure-native:eventgrid:',
  'azure-native:dbforpostgresql:',
  'azure-native:dbformysql:',
  'azure-native:compute:',
  'azure-native:cdn:',
  'azure-native:apimanagement:',
  'azure:core/',
  'azure:authorization/',
  'azure:role/',
  'azure:monitoring/',
  'azure:appinsights/',
  'azure:network/',
  'azure:storage/',
  'azure:keyvault/',
  'azure:appservice/',
  'azure:mssql/',
  'azure:cosmosdb/',
  'azure:servicebus/',
  // Google Cloud
  'gcp:projects/',
  'gcp:serviceaccount/',
  'gcp:iam/',
  'gcp:organizations/',
  'gcp:logging/',
  'gcp:monitoring/',
  'gcp:servicenetworking/',
  'gcp:vpcaccess/',
  'gcp:compute/',
  'gcp:storage/',
  'gcp:cloudrun/',
  'gcp:cloudrunv2/',
  'gcp:cloudfunctions/',
  'gcp:cloudfunctionsv2/',
  'gcp:pubsub/',
  'gcp:secretmanager/',
  'gcp:kms/',
  'gcp:sql/',
  'gcp:container/',
  'gcp:artifactregistry/',
  'gcp:dns/',
  // Docker
  'docker:index/',
  'docker-build:',
  'awsx:ecr:Image',
];

/**
 * Plumbing that is really an arrow: the resource exists to say that one thing
 * feeds another. The property naming the source, then the ones naming what it
 * feeds; `propertyDependencies` says which URN each property came from.
 */
const WIRING: Record<string, [string, string[]]> = {
  'aws:lambda/eventSourceMapping:EventSourceMapping': ['eventSourceArn', ['functionName']],
  'aws:lambda/permission:Permission': ['sourceArn', ['function']],
  'aws:sns/topicSubscription:TopicSubscription': ['topic', ['endpoint']],
  'aws:apigatewayv2/integration:Integration': ['apiId', ['integrationUri']],
  'aws:apigateway/integration:Integration': ['restApi', ['uri']],
  'aws:cloudwatch/eventTarget:EventTarget': ['rule', ['arn']],
  'aws:s3/bucketNotification:BucketNotification': [
    'bucket',
    ['lambdaFunctions', 'queues', 'topics'],
  ],
};

type Role = { kind: 'node'; service: string } | { kind: 'plumbing' } | { kind: 'unknown' };

function classify(type: string): Role {
  const provider = type.slice(0, type.indexOf(':'));
  if (IGNORED_PROVIDERS.has(provider)) return { kind: 'plumbing' };
  if (PLUMBING_TYPES.some((prefix) => type.startsWith(prefix))) return { kind: 'plumbing' };
  const service = serviceForPulumiType(type);
  if (service) return { kind: 'node', service };
  if (PLUMBING_FAMILIES.some((prefix) => type.startsWith(prefix))) return { kind: 'plumbing' };
  return { kind: 'unknown' };
}

/** `urn:pulumi:prod::shop::aws:s3/bucket:Bucket::assets` taken apart. */
function parseUrn(urn: string): { stack: string; project: string; name: string } | undefined {
  const parts = urn.split('::');
  if (parts.length < 4 || !parts[0].startsWith('urn:pulumi:')) return undefined;
  // A name may itself contain `::`, so it is everything after the type.
  return {
    stack: parts[0].slice('urn:pulumi:'.length),
    project: parts[1],
    name: parts.slice(3).join('::'),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The URNs in a dependency list, whatever else a hand-edited file put there. */
const urnsIn = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * The resource records, one per URN, from whichever of the two files this is.
 *
 * Last word wins per URN. A preview replaces a thing with a delete step and a
 * create step for the same URN, and an export mid-update can hold the old copy
 * flagged `delete` beside the new one; in both the one describing what will
 * exist is the one to keep.
 */
function collect(parsed: PulumiJson): PulumiResource[] | undefined {
  const byUrn = new Map<string, PulumiResource>();
  const exported = parsed.deployment?.resources;
  if (Array.isArray(exported)) {
    for (const record of exported) {
      if (!isRecord(record) || record.delete === true) continue;
      if (typeof record.urn === 'string') byUrn.set(record.urn, record as PulumiResource);
    }
    return [...byUrn.values()];
  }
  if (Array.isArray(parsed.steps)) {
    for (const step of parsed.steps) {
      if (!isRecord(step) || DELETING.has(String(step.op ?? ''))) continue;
      const state = step.newState;
      if (!isRecord(state)) continue;
      const urn = state.urn ?? step.urn;
      if (typeof urn === 'string') byUrn.set(urn, { ...(state as PulumiResource), urn });
    }
    return [...byUrn.values()];
  }
  return undefined;
}

export function fromPulumi(source: string): ImportResult {
  const text = source.trim();
  if (!text) throw new ImportError('Nothing to import.', 'empty');

  let parsed: PulumiJson;
  try {
    parsed = JSON.parse(text) as PulumiJson;
  } catch {
    throw new ImportError('That is not readable JSON.', 'unreadable');
  }

  const records = parsed && typeof parsed === 'object' ? collect(parsed) : undefined;
  if (!records) throw new ImportError('No Pulumi stack export or preview found.', 'unrecognised');

  const resources = records.filter(
    (r): r is PulumiResource & { urn: string; type: string } =>
      typeof r?.urn === 'string' && typeof r.type === 'string',
  );
  type Known = PulumiResource & { urn: string; type: string };
  const byUrn = new Map<string, Known>(resources.map((r) => [r.urn, r]));
  const parents = new Set(resources.map((r) => r.parent).filter((p): p is string => Boolean(p)));

  /* A component is what the program declared as one, or — in a file that does
     not say — anything with children other than the stack itself. */
  const isComponent = (r: Known) =>
    r.type !== 'pulumi:pulumi:Stack' &&
    (r.custom === false || (r.custom === undefined && parents.has(r.urn)));

  /** The outermost component above a resource, which is the author's own grouping. */
  const componentOf = (r: Known): Known | undefined => {
    let found: Known | undefined;
    const visited = new Set<string>();
    let parent = r.parent ? byUrn.get(r.parent) : undefined;
    while (parent && !visited.has(parent.urn)) {
      visited.add(parent.urn);
      if (isComponent(parent)) found = parent;
      parent = parent.parent ? byUrn.get(parent.parent) : undefined;
    }
    return found;
  };

  const warnings: ImportWarning[] = [];
  const key = keyMaker();
  const nodes: Record<string, NodeSpec> = {};
  const keyByUrn = new Map<string, string>();
  const boundaries = new Map<string, string>();
  const unknown = new Set<string>();
  let project: string | undefined;

  for (const resource of resources) {
    const urn = parseUrn(resource.urn);
    if (!urn) continue;
    if (!project) project = urn.project;
    if (isComponent(resource)) continue;

    const role = classify(resource.type);
    if (role.kind === 'plumbing') continue;
    if (role.kind === 'unknown') unknown.add(resource.type);

    const words = wordsFrom(urn.name);
    const nodeKey = key(words);
    keyByUrn.set(resource.urn, nodeKey);
    const spec: NodeSpec = {
      service: role.kind === 'node' ? role.service : 'gen-server',
      label: titleFrom(words),
      // The type is what somebody greps for when they go looking in the program.
      technology: resource.type,
    };
    const environment = environmentFrom(urn.stack);
    if (environment) spec.environment = environment;

    const component = componentOf(resource);
    if (component) {
      const name = wordsFrom(parseUrn(component.urn)?.name ?? component.urn);
      const boundaryKey = boundaries.get(component.urn) ?? key(name);
      boundaries.set(component.urn, boundaryKey);
      spec.in = boundaryKey;
    }
    nodes[nodeKey] = spec;
  }

  const edges: { from: string; to: string; label: string; style: 'solid' }[] = [];
  const drawn = new Set<string>();
  const connect = (fromUrn: string, toUrn: string) => {
    const from = keyByUrn.get(fromUrn);
    const to = keyByUrn.get(toUrn);
    if (!from || !to || from === to || drawn.has(`${from}>${to}`)) return;
    drawn.add(`${from}>${to}`);
    edges.push({ from, to, label: '', style: 'solid' });
  };

  for (const resource of resources) {
    const byProperty = isRecord(resource.propertyDependencies) ? resource.propertyDependencies : {};
    const wiring = WIRING[resource.type];
    if (wiring) {
      for (const from of urnsIn(byProperty[wiring[0]])) {
        for (const property of wiring[1])
          for (const to of urnsIn(byProperty[property])) connect(from, to);
      }
      continue;
    }
    if (!keyByUrn.has(resource.urn)) continue;
    // A dependency runs from the dependent to what it depends on, which is
    // the direction the data and the deploy both go.
    const dependencies = new Set(urnsIn(resource.dependencies));
    for (const urns of Object.values(byProperty))
      for (const urn of urnsIn(urns)) dependencies.add(urn);
    for (const dependency of dependencies) connect(resource.urn, dependency);
  }

  if (!Object.keys(nodes).length) warnings.push({ kind: 'noResources' });
  if (unknown.size) {
    warnings.push({
      kind: 'unknownResourceTypes',
      values: { types: [...unknown].sort().join(', ') },
    });
  }

  const document: DslDocument = { version: 1, nodes, edges };
  const cloud = dominantCloud(Object.values(nodes).map((n) => n.service));
  if (cloud) document.cloud = cloud;
  if (project) document.title = project;
  if (boundaries.size) {
    document.boundaries = Object.fromEntries(
      [...boundaries].map(([urn, boundaryKey]) => [
        boundaryKey,
        { label: titleFrom(wordsFrom(parseUrn(urn)?.name ?? urn)), variant: 'sub' as const },
      ]),
    );
  }

  return { format: 'pulumi', document, warnings };
}
