import { parse as parseYaml } from 'yaml';
import type { DslDocument, NodeSpec } from '@/lib/dsl';
import { serviceForCloudFormationType } from '@/data/resourceServices';
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
 * CloudFormation and SAM templates into an architecture.
 *
 * A template is the nearest thing AWS has to a drawing of a stack: every
 * resource is named, typed, and refers to the others by logical id. What it
 * lacks is proportion. Half of any real template is IAM roles, permissions,
 * subnets and log groups, and nobody wants a box for those — so the types the
 * catalogue knows become nodes, the plumbing becomes an arrow where it carries
 * one (a subscription, an event source mapping, an API integration), and the
 * rest is left out on purpose.
 *
 * YAML templates use the short tags, `!Ref`, `!GetAtt`, `!Sub`, which the YAML
 * parser does not know. It keeps each value and drops the tag, so `!Ref Orders`
 * arrives as the string "Orders" and `!GetAtt Orders.Arn` as "Orders.Arn".
 * Rather than teach the parser a dozen intrinsics, the reference walker treats
 * any string that names a logical id, in the shapes the intrinsics leave
 * behind, as the reference it is. The JSON forms fall out of the same walk:
 * `{"Ref": "Orders"}` is an object holding that same string.
 */

interface Template {
  AWSTemplateFormatVersion?: string;
  Description?: unknown;
  Parameters?: Record<string, { Default?: unknown } | undefined>;
  Resources?: Record<string, ResourceDecl | undefined>;
}

interface ResourceDecl {
  Type?: string;
  Properties?: Record<string, unknown>;
  DependsOn?: unknown;
  /** SAM's embedded form: `Connectors: {Name: {Properties: {Destination: {Id: X}}}}`. */
  Connectors?: Record<string, { Properties?: { Destination?: unknown } } | undefined>;
}

interface SamEvent {
  Type?: string;
  Properties?: Record<string, unknown>;
}

/**
 * Families whose members are wiring unless the catalogue names one outright:
 * `AWS::EC2::VPC` is a node, the subnets and route tables around it are not;
 * `AWS::RDS::DBInstance` is a node, its subnet group and parameter group are not.
 */
const PLUMBING_FAMILIES = [
  'AWS::IAM::',
  'AWS::EC2::',
  'AWS::Logs::',
  'AWS::ApiGateway::',
  'AWS::ApiGatewayV2::',
  'AWS::Cognito::',
  'AWS::CertificateManager::',
  'AWS::AutoScaling::',
  'AWS::ApplicationAutoScaling::',
  'AWS::ElasticLoadBalancingV2::',
  'AWS::ElasticLoadBalancing::',
  'AWS::WAFv2::',
  'AWS::CDK::',
  'AWS::RDS::',
  'AWS::ElastiCache::',
  'AWS::CloudFront::',
  'AWS::Batch::',
  'AWS::Glue::',
  'AWS::Athena::',
  'AWS::SES::',
];

/** Types that configure or permit something rather than being something. */
const PLUMBING_TYPES = new Set([
  'AWS::Lambda::Permission',
  'AWS::Lambda::Version',
  'AWS::Lambda::Alias',
  'AWS::Lambda::LayerVersion',
  'AWS::Lambda::LayerVersionPermission',
  'AWS::Lambda::EventInvokeConfig',
  'AWS::Lambda::Url',
  'AWS::Lambda::EventSourceMapping',
  'AWS::Serverless::LayerVersion',
  'AWS::Serverless::Connector',
  'AWS::SNS::Subscription',
  'AWS::SNS::TopicPolicy',
  'AWS::SQS::QueuePolicy',
  'AWS::S3::BucketPolicy',
  'AWS::KMS::Alias',
  'AWS::SSM::Parameter',
  'AWS::Events::EventBusPolicy',
  'AWS::ECR::RepositoryPolicy',
  'AWS::SecretsManager::SecretTargetAttachment',
  'AWS::SecretsManager::RotationSchedule',
  'AWS::SecretsManager::ResourcePolicy',
  'AWS::CloudFormation::WaitCondition',
  'AWS::CloudFormation::WaitConditionHandle',
  'AWS::CloudFormation::Macro',
]);

/**
 * Plumbing that is really an arrow: the resource exists to say that one thing
 * feeds another. The pair is the property naming each end, source first.
 */
const WIRING: Record<string, [string, string]> = {
  'AWS::Lambda::EventSourceMapping': ['EventSourceArn', 'FunctionName'],
  'AWS::SNS::Subscription': ['TopicArn', 'Endpoint'],
  'AWS::ApiGatewayV2::Integration': ['ApiId', 'IntegrationUri'],
  'AWS::ApiGateway::Method': ['RestApiId', 'Integration'],
  'AWS::Serverless::Connector': ['Source', 'Destination'],
};

/**
 * The property of a SAM event that names what sends the events. Everything
 * else in the event — a failure destination, say — is something the function
 * talks to, and is read the ordinary way round.
 */
const EVENT_SOURCE: Record<string, string> = {
  Api: 'RestApiId',
  HttpApi: 'ApiId',
  Sqs: 'Queue',
  SQS: 'Queue',
  SNS: 'Topic',
  DynamoDB: 'Stream',
  Kinesis: 'Stream',
  S3: 'Bucket',
  MSK: 'Stream',
  MQ: 'Broker',
  DocumentDB: 'Cluster',
  Cognito: 'UserPool',
  EventBridgeRule: 'EventBusName',
  CloudWatchEvent: 'EventBusName',
};

/** The resource SAM makes for an `Api` or `HttpApi` event that names no API, under SAM's own name. */
const IMPLICIT_API: Record<string, { id: string; explicit: string; type: string }> = {
  Api: {
    id: 'ServerlessRestApi',
    explicit: 'AWS::Serverless::Api',
    type: 'AWS::ApiGateway::RestApi',
  },
  HttpApi: {
    id: 'ServerlessHttpApi',
    explicit: 'AWS::Serverless::HttpApi',
    type: 'AWS::ApiGatewayV2::Api',
  },
};

type Role = { kind: 'node'; service: string } | { kind: 'plumbing' } | { kind: 'unknown' };

function classify(type: string): Role {
  const service = serviceForCloudFormationType(type);
  if (service) return { kind: 'node', service };
  if (PLUMBING_TYPES.has(type) || PLUMBING_FAMILIES.some((family) => type.startsWith(family))) {
    return { kind: 'plumbing' };
  }
  return { kind: 'unknown' };
}

/**
 * Every logical id a value refers to, in any shape an intrinsic leaves it.
 *
 * Only ids that exist count, which is what keeps parameters, conditions and
 * the pseudo parameters (`AWS::Region`) from ever looking like a resource.
 */
function referencesIn(
  value: unknown,
  ids: Set<string>,
  into: Set<string>,
  visited = new WeakSet<object>(),
): void {
  if (typeof value === 'string') {
    // `!Ref X`, and the JSON `{"Ref": "X"}`, both arrive as the bare id.
    if (ids.has(value)) {
      into.add(value);
      return;
    }
    // `!GetAtt X.Arn`, and the JSON `{"Fn::GetAtt": "X.Arn"}`.
    const attribute = value.match(/^([A-Za-z0-9]+)\.[A-Za-z0-9.]+$/);
    if (attribute && ids.has(attribute[1])) {
      into.add(attribute[1]);
      return;
    }
    // `!Sub "arn:aws:s3:::${Bucket}/*"`, with or without an attribute.
    for (const match of value.matchAll(/\$\{([A-Za-z0-9]+)(?:\.[A-Za-z0-9]+)*\}/g)) {
      if (ids.has(match[1])) into.add(match[1]);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  // A YAML alias can point back at its own anchor, which the parser faithfully
  // turns into a cycle; a place already walked has nothing new to say.
  if (visited.has(value)) return;
  visited.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    referencesIn(item, ids, into, visited);
  }
}

/** The first sentence of the description, cut to the length of a title. */
function titleOf(description: unknown): string | undefined {
  if (typeof description !== 'string') return undefined;
  const text = description.trim();
  const sentence = (text.match(/^(.*?[.!?])(?:\s|$)/)?.[1] ?? text).replace(/[.!?]+$/, '').trim();
  if (!sentence) return undefined;
  return sentence.length > 80 ? `${sentence.slice(0, 79).trimEnd()}…` : sentence;
}

/** The environment the whole stack is for, when a parameter default says so. */
function environmentOfStack(template: Template): NodeSpec['environment'] {
  for (const name of ['Environment', 'Env', 'Stage', 'StageName']) {
    const value = template.Parameters?.[name]?.Default;
    const environment = typeof value === 'string' ? environmentFrom(value) : undefined;
    if (environment) return environment;
  }
  return undefined;
}

export function fromCloudFormation(source: string): ImportResult {
  const text = source.trim();
  if (!text) throw new ImportError('Nothing to import.', 'empty');

  let template: Template;
  try {
    // YAML parses JSON too, so one path reads both notations. The short tags
    // are not in the parser's schema; `logLevel: 'error'` stops it announcing
    // each one on stderr while still refusing a file that will not parse.
    template = parseYaml(text, { logLevel: 'error' }) as Template;
  } catch {
    throw new ImportError('That is not readable YAML or JSON.', 'unreadable');
  }

  const declared = template && typeof template === 'object' ? template.Resources : undefined;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
    throw new ImportError('No CloudFormation template found.', 'unrecognised');
  }

  const resources = Object.entries(declared).filter(
    (entry): entry is [string, ResourceDecl & { Type: string }] =>
      typeof entry[1]?.Type === 'string',
  );
  const ids = new Set(resources.map(([id]) => id));
  const refsOf = (value: unknown): string[] => {
    const found = new Set<string>();
    referencesIn(value, ids, found);
    return [...found];
  };

  const warnings: ImportWarning[] = [];
  const key = keyMaker();
  const nodes: Record<string, NodeSpec> = {};
  const keyById = new Map<string, string>();
  const unknown = new Set<string>();
  const stackEnvironment = environmentOfStack(template);

  const addNode = (id: string, service: string, type: string) => {
    // The CDK ends every logical id in eight hex characters of path hash,
    // which are nobody's idea of a name.
    const words = wordsFrom(id.replace(/[0-9A-F]{8}$/, '') || id);
    const nodeKey = key(words);
    // The type is what somebody greps for when they go looking in the template.
    const spec: NodeSpec = { service, label: titleFrom(words), technology: type };
    const environment = environmentFrom(words) ?? stackEnvironment;
    if (environment) spec.environment = environment;
    nodes[nodeKey] = spec;
    keyById.set(id, nodeKey);
    return nodeKey;
  };

  /* A version or alias stands for its function: whatever points at the alias
     is, on a diagram, pointing at the function. */
  const standsFor = new Map<string, string>();

  for (const [id, resource] of resources) {
    const role = classify(resource.Type);
    if (role.kind === 'plumbing') {
      if (resource.Type === 'AWS::Lambda::Alias' || resource.Type === 'AWS::Lambda::Version') {
        const target = refsOf(resource.Properties?.FunctionName)[0];
        if (target) standsFor.set(id, target);
      }
      continue;
    }
    if (role.kind === 'unknown') unknown.add(resource.Type);
    addNode(id, role.kind === 'node' ? role.service : 'gen-server', resource.Type);
  }

  const edges: { from: string; to: string; label: string; style: 'solid' }[] = [];
  const drawn = new Set<string>();
  const connect = (fromId: string, toId: string) => {
    const from = keyById.get(standsFor.get(fromId) ?? fromId);
    const to = keyById.get(standsFor.get(toId) ?? toId);
    if (!from || !to || from === to || drawn.has(`${from}>${to}`)) return;
    drawn.add(`${from}>${to}`);
    edges.push({ from, to, label: '', style: 'solid' });
  };

  /** The API a SAM event without one lands on: the template's own, else SAM's implicit one. */
  const implicitApi = (eventType: string): string | undefined => {
    const implicit = IMPLICIT_API[eventType];
    if (!implicit) return undefined;
    const declaredApi = resources.find(([, r]) => r.Type === implicit.explicit)?.[0];
    if (declaredApi) return declaredApi;
    if (!keyById.has(implicit.id)) addNode(implicit.id, 'aws-apigateway', implicit.type);
    return implicit.id;
  };

  /** A SAM event is a source: the queue feeds the function, not the other way round. */
  const eventEdges = (functionId: string, eventName: string, event: SamEvent | undefined) => {
    const type = event?.Type ?? '';
    const properties = event?.Properties ?? {};
    const sourceProperty = EVENT_SOURCE[type];
    const sources = sourceProperty ? refsOf(properties[sourceProperty]) : [];

    if (type === 'Schedule' || type === 'ScheduleV2') {
      // SAM makes a rule per schedule event and names it after both, so the
      // box drawn here is the resource that will exist, under its own name.
      const ruleId = `${functionId}${eventName}`;
      if (!keyById.has(ruleId)) {
        addNode(
          ruleId,
          'aws-eventbridge',
          type === 'Schedule' ? 'AWS::Events::Rule' : 'AWS::Scheduler::Schedule',
        );
      }
      sources.push(ruleId);
    } else if (!sources.length) {
      const api = implicitApi(type);
      if (api) sources.push(api);
    }

    for (const from of sources) connect(from, functionId);
    for (const [name, value] of Object.entries(properties)) {
      if (name === sourceProperty) continue;
      for (const to of refsOf(value)) connect(functionId, to);
    }
  };

  for (const [id, resource] of resources) {
    const properties = resource.Properties ?? {};

    // `DependsOn` is the one dependency somebody wrote out by hand.
    const dependsOn = resource.DependsOn;
    for (const dep of Array.isArray(dependsOn) ? dependsOn : [dependsOn]) {
      if (typeof dep === 'string') connect(id, dep);
    }
    // SAM connectors say who talks to whom in so many words.
    for (const connector of Object.values(resource.Connectors ?? {})) {
      for (const to of refsOf(connector?.Properties?.Destination)) connect(id, to);
    }

    const wiring = WIRING[resource.Type];
    if (wiring) {
      for (const from of refsOf(properties[wiring[0]])) {
        for (const to of refsOf(properties[wiring[1]])) connect(from, to);
      }
      continue;
    }
    if (!keyById.has(id)) continue;

    if (
      resource.Type === 'AWS::Serverless::Function' ||
      resource.Type === 'AWS::Serverless::StateMachine'
    ) {
      const { Events: events, ...rest } = properties;
      for (const to of refsOf(rest)) connect(id, to);
      const declaredEvents = (events ?? {}) as Record<string, SamEvent | undefined>;
      for (const [name, event] of Object.entries(declaredEvents)) eventEdges(id, name, event);
      continue;
    }

    // A reference runs from the dependent to what it depends on, which is the
    // direction the data and the deploy both go.
    for (const to of refsOf(properties)) connect(id, to);
  }

  if (!Object.keys(nodes).length) warnings.push({ kind: 'noResources' });
  if (unknown.size) {
    // One warning for all of them: a CDK template can carry a dozen custom
    // resources, and a dozen warnings would bury anything else worth reading.
    warnings.push({
      kind: 'unknownResourceTypes',
      values: { types: [...unknown].sort().join(', ') },
    });
  }

  const document: DslDocument = { version: 1, cloud: 'aws', nodes, edges };
  const title = titleOf(template.Description);
  if (title) document.title = title;

  return { format: 'cloudformation', document, warnings };
}
