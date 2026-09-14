import { describe, expect, it } from 'vitest';
import { compile, fromMermaid, toMermaid } from '@/lib/dsl';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import {
  PULUMI_SERVICES,
  serviceForPulumiType,
  terraformTypeForPulumi,
} from '@/data/resourceServices';
import { fromPulumi } from './pulumi';
import { ImportError } from './shared';

const STACK = 'urn:pulumi:prod::shop::pulumi:pulumi:Stack::shop-prod';
const ORDERS = 'urn:pulumi:prod::shop::pkg:index:OrdersService::orders';
const inOrders = (type: string, name: string) =>
  `urn:pulumi:prod::shop::pkg:index:OrdersService$${type}::${name}`;
const TABLE = inOrders('aws:dynamodb/table:Table', 'orders-table');
const QUEUE = inOrders('aws:sqs/queue:Queue', 'orders-queue');
const ROLE = inOrders('aws:iam/role:Role', 'orders-role');
const FN = inOrders('aws:lambda/function:Function', 'ordersHandler');
const API = 'urn:pulumi:prod::shop::aws:apigatewayv2/api:Api::public-api';

/** `pulumi stack export`: the stack, a provider, a component with its children, and loose resources. */
const EXPORT = JSON.stringify({
  version: 3,
  deployment: {
    manifest: { time: '2026-09-01T10:00:00Z', magic: 'x', version: 'v3.150.0' },
    resources: [
      { urn: STACK, custom: false, type: 'pulumi:pulumi:Stack', outputs: {} },
      {
        urn: 'urn:pulumi:prod::shop::pulumi:providers:aws::default_6_0_0',
        custom: true,
        type: 'pulumi:providers:aws',
        inputs: { region: 'eu-west-1' },
      },
      { urn: ORDERS, custom: false, type: 'pkg:index:OrdersService', parent: STACK },
      {
        urn: TABLE,
        custom: true,
        type: 'aws:dynamodb/table:Table',
        parent: ORDERS,
        inputs: { billingMode: 'PAY_PER_REQUEST', hashKey: 'id' },
        outputs: { arn: 'arn:aws:dynamodb:eu-west-1:1:table/orders' },
      },
      { urn: QUEUE, custom: true, type: 'aws:sqs/queue:Queue', parent: ORDERS, inputs: {} },
      { urn: ROLE, custom: true, type: 'aws:iam/role:Role', parent: ORDERS, inputs: {} },
      {
        urn: FN,
        custom: true,
        type: 'aws:lambda/function:Function',
        parent: ORDERS,
        inputs: { runtime: 'nodejs20.x', environment: { variables: { TABLE: 'orders' } } },
        dependencies: [ROLE, TABLE],
        propertyDependencies: { role: [ROLE], environment: [TABLE], runtime: null },
      },
      {
        urn: inOrders('aws:lambda/eventSourceMapping:EventSourceMapping', 'orders-source'),
        custom: true,
        type: 'aws:lambda/eventSourceMapping:EventSourceMapping',
        parent: ORDERS,
        dependencies: [QUEUE, FN],
        propertyDependencies: { eventSourceArn: [QUEUE], functionName: [FN] },
      },
      { urn: API, custom: true, type: 'aws:apigatewayv2/api:Api', parent: STACK, inputs: {} },
      {
        urn: 'urn:pulumi:prod::shop::aws:apigatewayv2/integration:Integration::orders-integration',
        custom: true,
        type: 'aws:apigatewayv2/integration:Integration',
        parent: STACK,
        dependencies: [API, FN],
        propertyDependencies: { apiId: [API], integrationUri: [FN] },
      },
      {
        urn: 'urn:pulumi:prod::shop::aws:s3/bucket:Bucket::assets',
        custom: true,
        type: 'aws:s3/bucket:Bucket',
        parent: STACK,
      },
      {
        urn: 'urn:pulumi:prod::shop::random:index/randomId:RandomId::suffix',
        custom: true,
        type: 'random:index/randomId:RandomId',
        parent: STACK,
      },
      {
        urn: 'urn:pulumi:prod::shop::acme:index/thing:Thing::widget',
        custom: true,
        type: 'acme:index/thing:Thing',
        parent: STACK,
        dependencies: [API],
      },
    ],
  },
});

const DEV = 'urn:pulumi:dev::shop::pulumi:pulumi:Stack::shop-dev';
const ASSETS = 'urn:pulumi:dev::shop::aws:s3/bucket:Bucket::assets';
const CACHE = 'urn:pulumi:dev::shop::aws:dynamodb/table:Table::cache';

/** `pulumi preview --json`: one step per resource, including what is going away. */
const PREVIEW = JSON.stringify({
  steps: [
    {
      op: 'same',
      urn: DEV,
      newState: { urn: DEV, custom: false, type: 'pulumi:pulumi:Stack', inputs: {}, outputs: {} },
    },
    {
      op: 'create',
      urn: ASSETS,
      newState: {
        urn: ASSETS,
        custom: true,
        type: 'aws:s3/bucket:Bucket',
        parent: DEV,
        inputs: {},
      },
    },
    {
      op: 'update',
      urn: 'urn:pulumi:dev::shop::aws:lambda/function:Function::thumbs',
      oldState: { type: 'aws:lambda/function:Function' },
      newState: {
        urn: 'urn:pulumi:dev::shop::aws:lambda/function:Function::thumbs',
        custom: true,
        type: 'aws:lambda/function:Function',
        parent: DEV,
        dependencies: [ASSETS],
        propertyDependencies: { environment: [ASSETS] },
      },
      diffReasons: ['environment'],
    },
    {
      op: 'delete',
      urn: 'urn:pulumi:dev::shop::aws:sqs/queue:Queue::old-queue',
      oldState: {
        urn: 'urn:pulumi:dev::shop::aws:sqs/queue:Queue::old-queue',
        type: 'aws:sqs/queue:Queue',
      },
    },
    {
      op: 'replace',
      urn: CACHE,
      newState: { urn: CACHE, custom: true, type: 'aws:dynamodb/table:Table', parent: DEV },
    },
    {
      op: 'create-replacement',
      urn: CACHE,
      newState: { urn: CACHE, custom: true, type: 'aws:dynamodb/table:Table', parent: DEV },
    },
    {
      op: 'delete-replaced',
      urn: CACHE,
      oldState: { urn: CACHE, type: 'aws:dynamodb/table:Table' },
    },
  ],
  duration: 1234567,
  changeSummary: { create: 2, delete: 1, replace: 1, same: 1, update: 1 },
});

const nodes = (r: ReturnType<typeof fromPulumi>) => Object.keys(r.document.nodes).sort();
const specOf = (r: ReturnType<typeof fromPulumi>, key: string) => {
  const entry = r.document.nodes[key];
  return typeof entry === 'string' ? { service: entry } : entry;
};
const edge = (from: string, to: string) => ({ from, to, label: '', style: 'solid' });

describe('a stack export, which is what exists', () => {
  it('takes the resources and leaves out the stack, the provider and the plumbing', () => {
    expect(nodes(fromPulumi(EXPORT))).toEqual([
      'assets',
      'orders-handler',
      'orders-queue',
      'orders-table',
      'public-api',
      'widget',
    ]);
  });

  it('knows a type through its Terraform name', () => {
    // `aws:dynamodb/table:Table` is `aws_dynamodb_table` in different clothes.
    const result = fromPulumi(EXPORT);
    expect(specOf(result, 'orders-table').service).toBe('aws-dynamodb');
    expect(specOf(result, 'orders-queue').service).toBe('aws-sqs');
    expect(specOf(result, 'orders-handler').service).toBe('aws-lambda');
    expect(specOf(result, 'public-api').service).toBe('aws-apigateway');
  });

  it('makes a boundary of a component with something in it', () => {
    const result = fromPulumi(EXPORT);
    expect(result.document.boundaries).toEqual({ orders: { label: 'Orders', variant: 'sub' } });
    expect(specOf(result, 'orders-table').in).toBe('orders');
    expect(specOf(result, 'orders-handler').in).toBe('orders');
    expect(specOf(result, 'public-api').in).toBeUndefined();
  });

  it('draws a dependency from the dependent to what it depends on', () => {
    expect(fromPulumi(EXPORT).document.edges).toContainEqual(
      edge('orders-handler', 'orders-table'),
    );
  });

  it('turns wiring into the arrow it stands for', () => {
    // The mapping says the queue feeds the function; the integration says the
    // API calls it. Neither is a box.
    const edges = fromPulumi(EXPORT).document.edges;
    expect(edges).toContainEqual(edge('orders-queue', 'orders-handler'));
    expect(edges).toContainEqual(edge('public-api', 'orders-handler'));
  });

  it('draws no arrow to plumbing, nor anything twice', () => {
    const edges = fromPulumi(EXPORT).document.edges as { from: string; to: string }[];
    expect(edges.map((e) => e.to)).not.toContain('orders-role');
    expect(new Set(edges.map((e) => `${e.from}>${e.to}`)).size).toBe(edges.length);
    expect(edges).toHaveLength(4);
  });

  it('keeps a type it has never heard of, and says which', () => {
    const result = fromPulumi(EXPORT);
    expect(specOf(result, 'widget').service).toBe('gen-server');
    expect(result.document.edges).toContainEqual(edge('widget', 'public-api'));
    expect(result.warnings).toEqual([
      { kind: 'unknownResourceTypes', values: { types: 'acme:index/thing:Thing' } },
    ]);
  });

  it('leaves a component with nothing in it out altogether', () => {
    const result = fromPulumi(
      JSON.stringify({
        deployment: {
          resources: [
            { urn: STACK, custom: false, type: 'pulumi:pulumi:Stack' },
            { urn: ORDERS, custom: false, type: 'pkg:index:OrdersService', parent: STACK },
            { urn: ROLE, custom: true, type: 'aws:iam/role:Role', parent: ORDERS },
            { urn: API, custom: true, type: 'aws:apigatewayv2/api:Api', parent: STACK },
          ],
        },
      }),
    );
    expect(nodes(result)).toEqual(['public-api']);
    expect(result.document.boundaries).toBeUndefined();
  });

  it('folds nested components into the outermost, which is the author’s own grouping', () => {
    const inner = `${ORDERS.replace('::orders', '$awsx:ecs:FargateService::api')}`;
    const service =
      'urn:pulumi:prod::shop::pkg:index:OrdersService$awsx:ecs:FargateService$aws:ecs/service:Service::api';
    const result = fromPulumi(
      JSON.stringify({
        deployment: {
          resources: [
            { urn: STACK, custom: false, type: 'pulumi:pulumi:Stack' },
            { urn: ORDERS, custom: false, type: 'pkg:index:OrdersService', parent: STACK },
            { urn: inner, custom: false, type: 'awsx:ecs:FargateService', parent: ORDERS },
            { urn: service, custom: true, type: 'aws:ecs/service:Service', parent: inner },
          ],
        },
      }),
    );
    expect(specOf(result, 'api')).toMatchObject({ service: 'aws-ecs', in: 'orders' });
    expect(Object.keys(result.document.boundaries ?? {})).toEqual(['orders']);
  });
});

describe('exports that fight back', () => {
  it('draws a resource once while its old copy is still being torn down', () => {
    // Mid-update an export holds the outgoing copy, flagged `delete`, beside
    // the incoming one under the same URN.
    const result = fromPulumi(
      JSON.stringify({
        deployment: {
          resources: [
            { urn: ASSETS, custom: true, type: 'aws:s3/bucket:Bucket', delete: true },
            { urn: ASSETS, custom: true, type: 'aws:s3/bucket:Bucket' },
          ],
        },
      }),
    );
    expect(nodes(result)).toEqual(['assets']);
  });

  it('ignores the Kubernetes kinds the manifest reader ignores', () => {
    // Every `kubernetes:` type has a catalogue answer, so these have to be
    // turned away before the catalogue is asked.
    const k8s = (type: string, name: string) => ({
      urn: `urn:pulumi:dev::shop::${type}::${name}`,
      custom: true,
      type,
    });
    const result = fromPulumi(
      JSON.stringify({
        deployment: {
          resources: [
            k8s('kubernetes:apps/v1:Deployment', 'api'),
            k8s('kubernetes:core/v1:Service', 'api-svc'),
            k8s('kubernetes:rbac.authorization.k8s.io/v1:Role', 'api-role'),
            k8s('kubernetes:rbac.authorization.k8s.io/v1:RoleBinding', 'api-binding'),
            k8s('kubernetes:rbac.authorization.k8s.io/v1:ClusterRole', 'reader'),
            k8s('kubernetes:networking.k8s.io/v1:NetworkPolicy', 'deny-all'),
            k8s('kubernetes:policy/v1:PodDisruptionBudget', 'api-pdb'),
            k8s('kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition', 'widgets'),
            k8s('kubernetes:core/v1:ResourceQuota', 'quota'),
          ],
        },
      }),
    );
    expect(nodes(result)).toEqual(['api', 'api-svc']);
    expect(specOf(result, 'api').service).toBe('gen-container');
    expect(result.warnings).toEqual([]);
  });

  it('shrugs at a null step and at dependencies that are not lists', () => {
    const result = fromPulumi(
      JSON.stringify({
        steps: [
          null,
          {
            op: 'create',
            urn: ASSETS,
            newState: {
              urn: ASSETS,
              custom: true,
              type: 'aws:s3/bucket:Bucket',
              dependencies: 'not-a-list',
              propertyDependencies: { tags: 'not-a-list', acl: 3, bucket: null },
            },
          },
        ],
      }),
    );
    expect(nodes(result)).toEqual(['assets']);
    expect(result.document.edges).toEqual([]);

    const exported = fromPulumi(
      JSON.stringify({
        deployment: { resources: [null, { urn: ASSETS, type: 'aws:s3/bucket:Bucket' }] },
      }),
    );
    expect(nodes(exported)).toEqual(['assets']);
  });
});

describe('a preview, which is what is about to exist', () => {
  it('reads each step’s new state', () => {
    expect(nodes(fromPulumi(PREVIEW))).toEqual(['assets', 'cache', 'thumbs']);
  });

  it('leaves out what is being deleted, and counts a replacement once', () => {
    const result = fromPulumi(PREVIEW);
    expect(nodes(result)).not.toContain('old-queue');
    expect(nodes(result).filter((k) => k.startsWith('cache'))).toEqual(['cache']);
  });

  it('draws the dependencies the new state declares', () => {
    expect(fromPulumi(PREVIEW).document.edges).toEqual([edge('thumbs', 'assets')]);
  });

  it('reads the environment off the stack name', () => {
    expect(specOf(fromPulumi(PREVIEW), 'thumbs').environment).toBe('dev');
    expect(specOf(fromPulumi(EXPORT), 'orders-table').environment).toBe('prod');
  });
});

describe('what the program already knew', () => {
  it('names a node after the resource, in words', () => {
    const result = fromPulumi(EXPORT);
    expect(specOf(result, 'orders-handler').label).toBe('Orders Handler');
    expect(specOf(result, 'orders-table').label).toBe('Orders table');
  });

  it('keeps the type on the node, so it is greppable in the program', () => {
    expect(specOf(fromPulumi(EXPORT), 'orders-table').technology).toBe('aws:dynamodb/table:Table');
  });

  it('names the cloud when every service is in the same one', () => {
    expect(fromPulumi(EXPORT).document.cloud).toBe('aws');
  });

  it('names no cloud for a program spread across two', () => {
    const result = fromPulumi(
      JSON.stringify({
        deployment: {
          resources: [
            { urn: ASSETS, custom: true, type: 'aws:s3/bucket:Bucket' },
            {
              urn: 'urn:pulumi:dev::shop::gcp:storage/bucket:Bucket::mirror',
              custom: true,
              type: 'gcp:storage/bucket:Bucket',
            },
          ],
        },
      }),
    );
    expect(result.document.cloud).toBeUndefined();
  });

  it('takes the project as the title', () => {
    expect(fromPulumi(EXPORT).document.title).toBe('shop');
  });
});

describe('the mapping table', () => {
  it('names only services the catalogue has', () => {
    const keys = new Set(SERVICE_ICONS.map((s) => s.key));
    for (const [type, service] of Object.entries(PULUMI_SERVICES)) {
      expect(keys.has(service), `${type} → ${service}`).toBe(true);
    }
  });

  it('undresses a Pulumi type into its Terraform name', () => {
    expect(terraformTypeForPulumi('aws:lambda/function:Function')).toBe('aws_lambda_function');
    expect(terraformTypeForPulumi('aws:cognito/userPool:UserPool')).toBe('aws_cognito_user_pool');
    expect(terraformTypeForPulumi('gcp:sql/databaseInstance:DatabaseInstance')).toBe(
      'google_sql_database_instance',
    );
    expect(terraformTypeForPulumi('azure:storage/account:Account')).toBe('azurerm_storage_account');
    expect(terraformTypeForPulumi('azure-native:web:WebApp')).toBeUndefined();
  });

  it('answers for the clouds and the things that run anywhere', () => {
    expect(serviceForPulumiType('aws:lambda/function:Function')).toBe('aws-lambda');
    expect(serviceForPulumiType('azure-native:web:WebApp')).toBe('az-appservice');
    expect(serviceForPulumiType('azure-native:storage:StorageAccount')).toBe('az-blob');
    expect(serviceForPulumiType('gcp:cloudrun/service:Service')).toBe('gcp-cloudrun');
    expect(serviceForPulumiType('gcp:storage/bucket:Bucket')).toBe('gcp-cloudstorage');
    expect(serviceForPulumiType('docker:index/container:Container')).toBe('gen-docker');
    expect(serviceForPulumiType('kubernetes:helm.sh/v3:Release')).toBe('gen-kubernetes');
  });

  it('agrees with the Kubernetes reader about what a kind is', () => {
    expect(serviceForPulumiType('kubernetes:apps/v1:Deployment')).toBe('gen-container');
    expect(serviceForPulumiType('kubernetes:core/v1:Service')).toBe('gen-loadbalancer');
    expect(serviceForPulumiType('kubernetes:acme.io/v1:Widget')).toBe('gen-kubernetes');
  });
});

describe('refusing', () => {
  it('rejects an empty paste', () => {
    expect(() => fromPulumi('  ')).toThrow(ImportError);
  });

  it('rejects JSON that will not parse', () => {
    expect(() => fromPulumi('{"deployment": ')).toThrow(
      expect.objectContaining({ code: 'unreadable' }),
    );
  });

  it('rejects JSON that is neither an export nor a preview', () => {
    expect(() => fromPulumi('{"name": "package.json"}')).toThrow(
      expect.objectContaining({ code: 'unrecognised' }),
    );
  });

  it('draws nothing, and says so, for a stack with only bookkeeping in it', () => {
    const result = fromPulumi(
      JSON.stringify({
        version: 3,
        deployment: { resources: [{ urn: STACK, custom: false, type: 'pulumi:pulumi:Stack' }] },
      }),
    );
    expect(result.document.nodes).toEqual({});
    expect(result.warnings).toEqual([{ kind: 'noResources' }]);
  });
});

describe('what comes out compiles', () => {
  it('becomes a laid-out diagram with no errors', () => {
    const { model, diagnostics } = compile(fromPulumi(EXPORT).document);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(6);
    expect(model.shapes.filter((s) => s.type === 'boundary')).toHaveLength(1);
    expect(model.connectors).toHaveLength(4);
  });

  it('survives a trip through Mermaid with every service intact', () => {
    const { model } = compile(fromPulumi(EXPORT).document);
    const back = fromMermaid(toMermaid(model)).model;
    const keys = (m: typeof model) =>
      m.shapes
        .filter((s) => s.type === 'item')
        .map((s) => s.icon?.key)
        .sort();
    expect(keys(back)).toEqual(keys(model));
    expect(back.connectors).toHaveLength(4);
  });
});
