import { describe, expect, it } from 'vitest';
import { compile, fromMermaid, toMermaid } from '@/lib/dsl';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { CLOUDFORMATION_SERVICES } from '@/data/resourceServices';
import { fromCloudFormation } from './cloudformation';
import { ImportError, wordsFrom } from './shared';

/** A SAM template as people write them: short tags, Globals, an IAM role, a custom resource. */
const SAM = `
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Order processing for the shop. Functions, a queue and the table behind them.

Parameters:
  Environment:
    Type: String
    Default: prod

Globals:
  Function:
    Runtime: nodejs20.x

Resources:
  OrdersApi:
    Type: AWS::Serverless::Api
    Properties:
      StageName: !Ref Environment

  CheckoutFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: checkout.handler
      Role: !GetAtt FunctionRole.Arn
      Environment:
        Variables:
          TABLE: !Ref OrdersTable
          QUEUE_URL: !Ref OrdersQueue
      Events:
        Post:
          Type: Api
          Properties:
            Path: /orders
            Method: post
            RestApiId: !Ref OrdersApi

  FulfilFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: fulfil.handler
      Role: !GetAtt FunctionRole.Arn
      DeadLetterQueue:
        Type: SQS
        TargetArn: !GetAtt FailedQueue.Arn
      Events:
        Orders:
          Type: SQS
          Properties:
            Queue: !GetAtt OrdersQueue.Arn
            BatchSize: 10

  OrdersQueue:
    Type: AWS::SQS::Queue
    Properties:
      RedrivePolicy:
        deadLetterTargetArn: !GetAtt FailedQueue.Arn
        maxReceiveCount: 3

  FailedQueue:
    Type: AWS::SQS::Queue

  OrdersTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub "\${AWS::StackName}-orders"
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions: [{AttributeName: id, AttributeType: S}]
      KeySchema: [{AttributeName: id, KeyType: HASH}]

  OrderEvents:
    Type: AWS::SNS::Topic

  OrderEventsToQueue:
    Type: AWS::SNS::Subscription
    Properties:
      TopicArn: !Ref OrderEvents
      Protocol: sqs
      Endpoint: !GetAtt OrdersQueue.Arn

  FunctionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Statement:
          - Effect: Allow
            Principal: {Service: lambda.amazonaws.com}
            Action: sts:AssumeRole

  CheckoutLogs:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub /aws/lambda/\${CheckoutFunction}

  Metrics:
    Type: Custom::MetricsSetup
    Properties:
      ServiceToken: !GetAtt CheckoutFunction.Arn
`;

/** A plain template in JSON, with the long-form intrinsics and the wiring types. */
const JSON_TEMPLATE = JSON.stringify({
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Image thumbnails.',
  Resources: {
    Uploads: { Type: 'AWS::S3::Bucket' },
    Thumbnails: { Type: 'AWS::S3::Bucket', DependsOn: 'Uploads' },
    ResizeFunction: {
      Type: 'AWS::Lambda::Function',
      Properties: {
        Role: { 'Fn::GetAtt': ['ResizeRole', 'Arn'] },
        Environment: { Variables: { TARGET: { Ref: 'Thumbnails' } } },
        Code: { S3Bucket: { 'Fn::Join': ['-', [{ Ref: 'AWS::StackName' }, 'code']] } },
      },
    },
    ResizeAlias: {
      Type: 'AWS::Lambda::Alias',
      Properties: {
        FunctionName: { Ref: 'ResizeFunction' },
        FunctionVersion: '$LATEST',
        Name: 'live',
      },
    },
    ResizeRole: { Type: 'AWS::IAM::Role', Properties: { AssumeRolePolicyDocument: {} } },
    UploadPermission: {
      Type: 'AWS::Lambda::Permission',
      Properties: {
        FunctionName: { Ref: 'ResizeAlias' },
        Principal: 's3.amazonaws.com',
        SourceArn: { 'Fn::GetAtt': ['Uploads', 'Arn'] },
      },
    },
    Jobs: { Type: 'AWS::SQS::Queue' },
    JobsToResize: {
      Type: 'AWS::Lambda::EventSourceMapping',
      Properties: {
        EventSourceArn: { 'Fn::GetAtt': ['Jobs', 'Arn'] },
        FunctionName: { Ref: 'ResizeAlias' },
      },
    },
    HttpApi: { Type: 'AWS::ApiGatewayV2::Api', Properties: { ProtocolType: 'HTTP' } },
    ResizeIntegration: {
      Type: 'AWS::ApiGatewayV2::Integration',
      Properties: {
        ApiId: { Ref: 'HttpApi' },
        IntegrationType: 'AWS_PROXY',
        IntegrationUri: {
          'Fn::Sub': 'arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:${ResizeFunction}',
        },
      },
    },
    Alarm: {
      Type: 'AWS::CloudWatch::Alarm',
      Properties: { Dimensions: [{ Name: 'FunctionName', Value: { Ref: 'ResizeFunction' } }] },
    },
  },
});

const nodes = (r: ReturnType<typeof fromCloudFormation>) => Object.keys(r.document.nodes).sort();
const specOf = (r: ReturnType<typeof fromCloudFormation>, key: string) => {
  const entry = r.document.nodes[key];
  return typeof entry === 'string' ? { service: entry } : entry;
};
const edge = (from: string, to: string) => ({ from, to, label: '', style: 'solid' });

describe('reading a SAM template', () => {
  it('takes the resources a reader wants a box for and no others', () => {
    // The role, the log group and the subscription are half the template and
    // none of the architecture.
    expect(nodes(fromCloudFormation(SAM))).toEqual([
      'checkout-function',
      'failed-queue',
      'fulfil-function',
      'metrics',
      'order-events',
      'orders-api',
      'orders-queue',
      'orders-table',
    ]);
  });

  it('reads the short tags as the references they are', () => {
    // `!Ref` and `!GetAtt` arrive as bare strings; a string that names a
    // logical id is still a reference.
    const edges = fromCloudFormation(SAM).document.edges;
    expect(edges).toContainEqual(edge('checkout-function', 'orders-table'));
    expect(edges).toContainEqual(edge('checkout-function', 'orders-queue'));
    expect(edges).toContainEqual(edge('orders-queue', 'failed-queue'));
  });

  it('draws an event source into the function, not out of it', () => {
    const edges = fromCloudFormation(SAM).document.edges;
    expect(edges).toContainEqual(edge('orders-queue', 'fulfil-function'));
    expect(edges).toContainEqual(edge('orders-api', 'checkout-function'));
    expect(edges).not.toContainEqual(edge('fulfil-function', 'orders-queue'));
  });

  it('reads the rest of an event, a failure destination say, the ordinary way round', () => {
    expect(fromCloudFormation(SAM).document.edges).toContainEqual(
      edge('fulfil-function', 'failed-queue'),
    );
  });

  it('turns a subscription into the arrow it stands for', () => {
    expect(fromCloudFormation(SAM).document.edges).toContainEqual(
      edge('order-events', 'orders-queue'),
    );
  });

  it('draws no arrow to plumbing', () => {
    const edges = fromCloudFormation(SAM).document.edges as { to: string }[];
    expect(edges.map((e) => e.to)).not.toContain('function-role');
  });

  it('keeps a custom resource as a plain server, and says so once', () => {
    const result = fromCloudFormation(SAM);
    expect(specOf(result, 'metrics').service).toBe('gen-server');
    expect(result.document.edges).toContainEqual(edge('metrics', 'checkout-function'));
    expect(result.warnings).toEqual([
      { kind: 'unknownResourceTypes', values: { types: 'Custom::MetricsSetup' } },
    ]);
  });
});

describe('reading a JSON template', () => {
  it('reads the long-form intrinsics', () => {
    const result = fromCloudFormation(JSON_TEMPLATE);
    expect(nodes(result)).toEqual([
      'alarm',
      'http-api',
      'jobs',
      'resize-function',
      'thumbnails',
      'uploads',
    ]);
    expect(result.document.edges).toContainEqual(edge('resize-function', 'thumbnails'));
    expect(result.document.edges).toContainEqual(edge('alarm', 'resize-function'));
  });

  it('honours DependsOn, the one dependency written by hand', () => {
    expect(fromCloudFormation(JSON_TEMPLATE).document.edges).toContainEqual(
      edge('thumbnails', 'uploads'),
    );
  });

  it('follows an alias to its function', () => {
    // The mapping and the integration both name the alias; on a diagram they
    // point at the function.
    const edges = fromCloudFormation(JSON_TEMPLATE).document.edges;
    expect(edges).toContainEqual(edge('jobs', 'resize-function'));
    expect(edges).toContainEqual(edge('http-api', 'resize-function'));
  });

  it('reads a reference out of a Fn::Sub string', () => {
    const edges = fromCloudFormation(JSON_TEMPLATE).document.edges as { from: string }[];
    expect(edges.filter((e) => e.from === 'http-api')).toHaveLength(1);
  });

  it('draws nothing for a permission, which allows a call rather than making one', () => {
    expect(fromCloudFormation(JSON_TEMPLATE).document.edges).not.toContainEqual(
      edge('uploads', 'resize-function'),
    );
  });

  it('never draws a resource depending on itself, nor the same arrow twice', () => {
    const edges = fromCloudFormation(JSON_TEMPLATE).document.edges as {
      from: string;
      to: string;
    }[];
    expect(edges.every((e) => e.from !== e.to)).toBe(true);
    expect(new Set(edges.map((e) => `${e.from}>${e.to}`)).size).toBe(edges.length);
  });
});

describe('SAM events with nothing to point at', () => {
  it('draws the API SAM would make, under the name SAM gives it', () => {
    const result = fromCloudFormation(`
Resources:
  Hello:
    Type: AWS::Serverless::Function
    Properties:
      Events:
        Get: {Type: Api, Properties: {Path: /, Method: get}}
`);
    expect(nodes(result)).toEqual(['hello', 'serverless-rest-api']);
    expect(specOf(result, 'serverless-rest-api').service).toBe('aws-apigateway');
    expect(result.document.edges).toEqual([edge('serverless-rest-api', 'hello')]);
  });

  it('lands on the API the template declares, if it declares one', () => {
    const result = fromCloudFormation(`
Resources:
  Public: {Type: AWS::Serverless::Api, Properties: {StageName: v1}}
  Hello:
    Type: AWS::Serverless::Function
    Properties:
      Events:
        Get: {Type: Api, Properties: {Path: /, Method: get}}
`);
    expect(nodes(result)).toEqual(['hello', 'public']);
    expect(result.document.edges).toEqual([edge('public', 'hello')]);
  });

  it('draws a schedule as the rule SAM makes for it', () => {
    const result = fromCloudFormation(`
Resources:
  Cleanup:
    Type: AWS::Serverless::Function
    Properties:
      Events:
        Nightly: {Type: Schedule, Properties: {Schedule: 'rate(1 day)'}}
`);
    expect(specOf(result, 'cleanup-nightly')).toMatchObject({
      service: 'aws-eventbridge',
      technology: 'AWS::Events::Rule',
    });
    expect(result.document.edges).toEqual([edge('cleanup-nightly', 'cleanup')]);
  });
});

describe('what the template already knew', () => {
  it('names a node in words, keeping acronyms whole', () => {
    expect(specOf(fromCloudFormation(SAM), 'checkout-function').label).toBe('Checkout Function');
    expect(wordsFrom('APIGateway')).toBe('API Gateway');
    expect(wordsFrom('MyEC2Instance')).toBe('My EC2 Instance');
    expect(wordsFrom('OrdersDLQ')).toBe('Orders DLQ');
  });

  it('keeps the type on the node, so it is greppable in the template', () => {
    expect(specOf(fromCloudFormation(SAM), 'orders-table').technology).toBe('AWS::DynamoDB::Table');
  });

  it('reads the environment off a parameter default when the names say nothing', () => {
    expect(specOf(fromCloudFormation(SAM), 'orders-table').environment).toBe('prod');
  });

  it('reads the environment off a logical id that states one', () => {
    const result = fromCloudFormation('Resources:\n  StagingOrders: {Type: AWS::SQS::Queue}');
    expect(specOf(result, 'staging-orders').environment).toBe('staging');
  });

  it('takes the first sentence of the description as the title', () => {
    expect(fromCloudFormation(SAM).document.title).toBe('Order processing for the shop');
  });

  it('is an AWS document, which is the one thing a template is always sure of', () => {
    expect(fromCloudFormation(SAM).document.cloud).toBe('aws');
  });
});

describe('the mapping table', () => {
  it('names only services the catalogue has', () => {
    const keys = new Set(SERVICE_ICONS.map((s) => s.key));
    for (const [type, service] of Object.entries(CLOUDFORMATION_SERVICES)) {
      expect(keys.has(service), `${type} → ${service}`).toBe(true);
    }
  });

  it('names the services of a family and leaves its configuration out', () => {
    // A subnet group sits in the ElastiCache namespace beside the cluster it
    // configures; only one of the two is a box.
    const result = fromCloudFormation(`
Resources:
  Sessions: {Type: AWS::ElastiCache::ReplicationGroup}
  SessionsSubnets: {Type: AWS::ElastiCache::SubnetGroup}
  SessionsParams: {Type: AWS::ElastiCache::ParameterGroup}
  Jobs: {Type: AWS::Batch::JobQueue}
  Compute: {Type: AWS::Batch::ComputeEnvironment}
  Sender: {Type: AWS::SES::EmailIdentity}
  SenderConfig: {Type: AWS::SES::ConfigurationSet}
  Etl: {Type: AWS::Glue::Job}
  EtlSecurity: {Type: AWS::Glue::SecurityConfiguration}
  Db: {Type: AWS::RDS::DBInstance}
  DbSubnets: {Type: AWS::RDS::DBSubnetGroup}
  Cdn: {Type: AWS::CloudFront::Distribution}
  CdnIdentity: {Type: AWS::CloudFront::CloudFrontOriginAccessIdentity}
`);
    expect(nodes(result)).toEqual(['cdn', 'db', 'etl', 'jobs', 'sender', 'sessions']);
    expect(specOf(result, 'sessions').service).toBe('aws-elasticache');
    expect(specOf(result, 'jobs').service).toBe('aws-batch');
    expect(result.warnings).toEqual([]);
  });
});

describe('templates that fight back', () => {
  it('walks a YAML alias that points back at its own anchor without going round for ever', () => {
    const result = fromCloudFormation(`
Resources:
  Loop: &loop
    Type: AWS::SQS::Queue
    Properties:
      Self: *loop
  Other:
    Type: AWS::SQS::Queue
    Properties:
      Target: !Ref Loop
`);
    expect(nodes(result)).toEqual(['loop', 'other']);
    expect(result.document.edges).toEqual([edge('other', 'loop')]);
  });

  it('drops the hash the CDK glues onto every logical id', () => {
    const result = fromCloudFormation(`
Resources:
  CheckoutFunction5E3F1A2B: {Type: AWS::Lambda::Function}
  Route53Zone: {Type: AWS::Route53::HostedZone}
  DEADBEEF: {Type: AWS::SQS::Queue}
`);
    expect(specOf(result, 'checkout-function').label).toBe('Checkout Function');
    // Digits that are part of the name stay; an id that is nothing but hash keeps itself.
    expect(specOf(result, 'route53-zone').label).toBe('Route53 Zone');
    expect(nodes(result)).toContain('deadbeef');
  });
});

describe('refusing', () => {
  it('rejects an empty paste', () => {
    expect(() => fromCloudFormation('  ')).toThrow(ImportError);
  });

  it('rejects JSON that will not parse', () => {
    expect(() => fromCloudFormation('{"Resources": ')).toThrow(
      expect.objectContaining({ code: 'unreadable' }),
    );
  });

  it('rejects YAML with no Resources in it', () => {
    expect(() => fromCloudFormation('kind: Deployment\napiVersion: apps/v1')).toThrow(
      expect.objectContaining({ code: 'unrecognised' }),
    );
  });

  it('draws nothing, and says so, for a template that is all plumbing', () => {
    const result = fromCloudFormation(`
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  Role: {Type: AWS::IAM::Role, Properties: {AssumeRolePolicyDocument: {}}}
`);
    expect(result.document.nodes).toEqual({});
    expect(result.warnings).toEqual([{ kind: 'noResources' }]);
  });
});

describe('what comes out compiles', () => {
  it('becomes a laid-out diagram with no errors', () => {
    const { model, diagnostics } = compile(fromCloudFormation(SAM).document);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(8);
    expect(model.connectors.length).toBeGreaterThan(5);
  });

  it('resolves the services the catalogue knows', () => {
    const { model } = compile(fromCloudFormation(SAM).document);
    const keys = model.shapes.filter((s) => s.type === 'item').map((s) => s.icon?.key);
    expect(keys).toContain('aws-lambda');
    expect(keys).toContain('aws-dynamodb');
    expect(keys).toContain('aws-sqs');
    expect(keys).toContain('aws-apigateway');
  });

  it('survives a trip through Mermaid with every service intact', () => {
    const { model } = compile(fromCloudFormation(SAM).document);
    const back = fromMermaid(toMermaid(model)).model;
    const keys = (m: typeof model) =>
      m.shapes
        .filter((s) => s.type === 'item')
        .map((s) => s.icon?.key)
        .sort();
    expect(keys(back)).toEqual(keys(model));
    expect(back.connectors).toHaveLength(model.connectors.length);
  });
});
