import type { DiagramModel } from '@/lib/domain';
import * as E from '@/lib/engine';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import type { Locale, MessageKey } from '@/lib/i18n/messages';
import { PROVIDER_COLORS, providerOf } from './providers';

interface NodeSpec {
  /** Display name and the key used by `edges` to refer to this node. */
  label: string;
  service: string;
  x: number;
  y: number;
}

interface TemplateSpec {
  /** Also the stem of its `template.<id>.name` / `.description` message keys. */
  id: string;
  /** Name resolved by `<Glyph>` — see components/icons/Glyph.tsx. */
  icon: string;
  nodes: NodeSpec[];
  edges: [from: string, to: string, label: string][];
}

/**
 * Builds a diagram from a template spec.
 *
 * The original editor repeated this same twelve-line construction loop inside
 * every template function; describing templates as data removes that repetition
 * and makes a new template a five-line addition.
 */
export function buildTemplate(spec: TemplateSpec, locale: Locale = 'en'): DiagramModel {
  const model = E.createEmptyModel();
  const itemIdByLabel = new Map<string, string>();

  for (const node of spec.nodes) {
    const group = E.addGroup(model, node.x, node.y);
    group.title = node.label;

    const service = SERVICE_ICONS.find((s) => s.key === node.service);
    const palette = PROVIDER_COLORS[providerOf(node.service)];
    group.fill = palette.fill;

    const container = E.children(model, group.id).find((s) => s.type === 'container');
    if (!container) continue;
    container.fill = palette.border;

    const item = E.children(model, container.id).find((s) => s.type === 'item');
    if (!item) continue;
    item.title = node.label;
    item.subtitle = serviceDescription(service, locale);
    item.icon = { kind: 'symbol', key: node.service };
    itemIdByLabel.set(node.label, item.id);
  }

  for (const [from, to, label] of spec.edges) {
    const sourceId = itemIdByLabel.get(from);
    const targetId = itemIdByLabel.get(to);
    if (!sourceId || !targetId) continue;
    const connector = E.addConnector(model, sourceId, targetId);
    connector.label = label;
  }

  E.routeAllConnectors(model);
  return model;
}

export const TEMPLATE_SPECS: TemplateSpec[] = [
  {
    id: 'serverless',
    icon: 'bolt',
    nodes: [
      { label: 'CloudFront', service: 'aws-cloudfront', x: 80, y: 100 },
      { label: 'API Gateway', service: 'aws-apigateway', x: 620, y: 100 },
      { label: 'Lambda', service: 'aws-lambda', x: 1160, y: 100 },
      { label: 'DynamoDB', service: 'aws-dynamodb', x: 1700, y: 40 },
      { label: 'S3 Bucket', service: 'aws-s3', x: 1700, y: 320 },
    ],
    edges: [
      ['CloudFront', 'API Gateway', 'HTTPS'],
      ['API Gateway', 'Lambda', 'Invoke'],
      ['Lambda', 'DynamoDB', 'R/W'],
      ['Lambda', 'S3 Bucket', 'Files'],
    ],
  },
  {
    id: 'microservices',
    icon: 'mesh',
    nodes: [
      { label: 'Load Balancer', service: 'aws-elb', x: 80, y: 260 },
      { label: 'Auth Service', service: 'aws-cognito', x: 620, y: 40 },
      { label: 'API Service', service: 'aws-ecs', x: 620, y: 300 },
      { label: 'Worker Service', service: 'aws-fargate', x: 620, y: 560 },
      { label: 'Database', service: 'aws-rds', x: 1160, y: 160 },
      { label: 'Cache', service: 'gen-redis', x: 1160, y: 420 },
      { label: 'Queue', service: 'aws-sqs', x: 1160, y: 680 },
    ],
    edges: [
      ['Load Balancer', 'Auth Service', 'Auth'],
      ['Load Balancer', 'API Service', 'HTTP'],
      ['API Service', 'Database', 'SQL'],
      ['API Service', 'Cache', 'R/W'],
      ['API Service', 'Queue', 'Push'],
      ['Worker Service', 'Queue', 'Poll'],
    ],
  },
  {
    id: 'data-pipeline',
    icon: 'chart',
    nodes: [
      { label: 'Source (S3)', service: 'aws-s3', x: 80, y: 200 },
      { label: 'Glue ETL', service: 'aws-glue', x: 620, y: 200 },
      { label: 'Redshift', service: 'aws-redshift', x: 1160, y: 60 },
      { label: 'Athena', service: 'aws-athena', x: 1160, y: 340 },
      { label: 'QuickSight', service: 'aws-quicksight', x: 1700, y: 200 },
    ],
    edges: [
      ['Source (S3)', 'Glue ETL', 'Raw data'],
      ['Glue ETL', 'Redshift', 'Load'],
      ['Glue ETL', 'Athena', 'Catalog'],
      ['Redshift', 'QuickSight', 'BI'],
      ['Athena', 'QuickSight', 'Query'],
    ],
  },
  {
    id: 'ml-pipeline',
    icon: 'brain',
    nodes: [
      { label: 'Data Lake', service: 'aws-s3', x: 80, y: 200 },
      { label: 'SageMaker', service: 'aws-sagemaker', x: 620, y: 60 },
      { label: 'Bedrock', service: 'aws-bedrock', x: 620, y: 340 },
      { label: 'Lambda', service: 'aws-lambda', x: 1160, y: 200 },
      { label: 'API Gateway', service: 'aws-apigateway', x: 1700, y: 200 },
    ],
    edges: [
      ['Data Lake', 'SageMaker', 'Train'],
      ['Data Lake', 'Bedrock', 'RAG'],
      ['SageMaker', 'Lambda', 'Model'],
      ['Bedrock', 'Lambda', 'Inference'],
      ['Lambda', 'API Gateway', 'REST'],
    ],
  },
  {
    id: 'three-tier',
    icon: 'layers',
    nodes: [
      { label: 'CloudFront CDN', service: 'aws-cloudfront', x: 80, y: 260 },
      { label: 'Web Tier', service: 'aws-ec2', x: 620, y: 60 },
      { label: 'App Tier', service: 'aws-ec2', x: 620, y: 400 },
      { label: 'RDS Primary', service: 'aws-rds', x: 1160, y: 60 },
      { label: 'ElastiCache', service: 'aws-elasticache', x: 1160, y: 340 },
      { label: 'S3 Static', service: 'aws-s3', x: 1160, y: 620 },
    ],
    edges: [
      ['CloudFront CDN', 'Web Tier', 'HTTP'],
      ['CloudFront CDN', 'App Tier', 'API'],
      ['Web Tier', 'RDS Primary', 'SQL'],
      ['App Tier', 'ElastiCache', 'Cache'],
      ['App Tier', 'S3 Static', 'Assets'],
    ],
  },
];

export interface Template {
  id: string;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  icon: string;
  /**
   * Built fresh on each call so two loads never share shape identities, and in
   * the caller's language because the subtitles it writes are content, not
   * chrome: they stay in the diagram after the reader switches language.
   */
  build: (locale: Locale) => DiagramModel;
}

export const TEMPLATES: Template[] = TEMPLATE_SPECS.map((spec) => ({
  id: spec.id,
  nameKey: `template.${spec.id}.name` as MessageKey,
  descriptionKey: `template.${spec.id}.description` as MessageKey,
  icon: spec.icon,
  build: (locale: Locale) => buildTemplate(spec, locale),
}));
