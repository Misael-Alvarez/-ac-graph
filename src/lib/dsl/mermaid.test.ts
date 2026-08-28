import { describe, expect, it } from 'vitest';
import * as E from '@/lib/engine';
import { TEMPLATES } from '@/lib/editor/templates';
import { fromMermaid, toMermaid } from './mermaid';
import { parseDsl } from './parse';

const SAMPLE = parseDsl(`cloud: aws
nodes:
  api: apigateway
  fn: lambda
  db: dynamodb
edges:
  - api -> fn: invoke
  - fn -> db: R/W
`).model!;

describe('toMermaid', () => {
  it('emits a flowchart with a node per service', () => {
    const out = toMermaid(SAMPLE);
    expect(out.split('\n')[0]).toBe('flowchart TD');
    expect(out).toContain('["API Gateway"]');
    expect(out).toContain('["Lambda"]');
  });

  it('honours the direction option', () => {
    expect(toMermaid(SAMPLE, { direction: 'LR' }).startsWith('flowchart LR')).toBe(true);
  });

  it('writes labelled edges', () => {
    expect(toMermaid(SAMPLE)).toMatch(/-->\|invoke\|/);
  });

  it('uses the dotted arrow for dashed connectors', () => {
    const model = E.cloneModel(SAMPLE);
    model.connectors[0].style = 'dashed';
    expect(toMermaid(model)).toContain('-.->');
  });

  it('escapes quotes in labels', () => {
    const model = E.cloneModel(SAMPLE);
    model.shapes.find((s) => s.type === 'item')!.title = 'The "main" API';
    expect(toMermaid(model)).toContain('#quot;main#quot;');
  });

  it('gives colliding titles distinct ids', () => {
    const model = E.cloneModel(SAMPLE);
    for (const item of model.shapes.filter((s) => s.type === 'item')) item.title = 'Same';
    const ids = [...toMermaid(model).matchAll(/^ {2}(\w+)\[/gm)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('wraps boundary members in a subgraph', () => {
    const model = parseDsl(`cloud: aws
boundaries:
  vpc:
    label: Production
nodes:
  fn:
    service: lambda
    in: vpc
edges: []
`).model!;
    const out = toMermaid(model);
    expect(out).toContain('subgraph');
    expect(out).toContain('["Production"]');
    expect(out).toContain('end');
  });

  it('handles an empty diagram', () => {
    expect(toMermaid(E.createEmptyModel())).toBe('flowchart TD');
  });
});

describe('fromMermaid', () => {
  it('reads nodes and edges', () => {
    const { model } = fromMermaid(`flowchart TD
  api["API Gateway"]
  fn["Lambda"]
  api -->|invoke| fn
`);
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(2);
    expect(model.connectors).toHaveLength(1);
    expect(model.connectors[0].label).toBe('invoke');
  });

  it('matches labels against the service catalogue', () => {
    const { model, unmatched } = fromMermaid(
      'flowchart TD\n  a["Lambda"]\n  b["DynamoDB"]\n  a --> b',
    );
    expect(model.shapes.filter((s) => s.type === 'item').map((s) => s.icon?.key)).toEqual([
      'aws-lambda',
      'aws-dynamodb',
    ]);
    expect(unmatched).toEqual([]);
  });

  it('reports labels it could not match', () => {
    const { unmatched } = fromMermaid('flowchart TD\n  a["Bespoke Widget"]\n');
    expect(unmatched).toEqual(['Bespoke Widget']);
  });

  it('reads the round, rhombus and bare node forms', () => {
    const { model } = fromMermaid('flowchart LR\n  a(Lambda)\n  b{S3}\n  c\n  a --> b\n  b --> c');
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(3);
  });

  it('declares nodes that only appear in an edge', () => {
    const { model } = fromMermaid('flowchart TD\n  lambda --> s3');
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(2);
  });

  it('recognises the dotted arrow as a dashed connector', () => {
    const { model } = fromMermaid('flowchart TD\n  a["Lambda"]\n  b["S3"]\n  a -.-> b');
    expect(model.connectors[0].style).toBe('dashed');
  });

  it('ignores styling and comment directives', () => {
    const { model } = fromMermaid(`flowchart TD
  %% a comment
  classDef big fill:#f00
  a["Lambda"]
  style a fill:#0f0
`);
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(1);
  });

  it('reads nodes declared inside a subgraph', () => {
    const { model } = fromMermaid(`flowchart TD
  subgraph vpc["VPC"]
    a["Lambda"]
    b["S3"]
  end
  a --> b
`);
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(2);
    expect(model.connectors).toHaveLength(1);
  });

  it('returns an empty diagram for empty input', () => {
    expect(fromMermaid('flowchart TD').model.shapes).toHaveLength(0);
  });
});

describe('mermaid round trip', () => {
  it('preserves nodes and edges', () => {
    const back = fromMermaid(toMermaid(SAMPLE)).model;
    expect(back.shapes.filter((s) => s.type === 'group')).toHaveLength(3);
    expect(back.connectors).toHaveLength(2);
    expect(back.connectors.map((c) => c.label).sort()).toEqual(['R/W', 'invoke']);
  });

  it('preserves the services of every template', () => {
    for (const template of TEMPLATES) {
      const original = template.build('en');
      const back = fromMermaid(toMermaid(original)).model;
      const keys = (m: typeof original) =>
        m.shapes
          .filter((s) => s.type === 'item')
          .map((s) => s.icon?.key)
          .sort();
      expect(keys(back), template.id).toEqual(keys(original));
    }
  });
});

describe('service annotations', () => {
  it('records each node service in a comment block', () => {
    const out = toMermaid(SAMPLE);
    expect(out).toContain('%% aion:services');
    expect(out).toMatch(/%% {3}\w+: aws-lambda/);
  });

  it('makes our own round trip lossless even for role-named nodes', () => {
    // "Load Balancer" cannot be recovered from the label alone; the annotation
    // is what keeps aws-elb from becoming an Azure balancer.
    const model = parseDsl(`cloud: aws
nodes:
  lb:
    service: elb
    label: Load Balancer
  api:
    service: ecs
    label: API Service
edges:
  - lb -> api: HTTP
`).model!;

    const back = fromMermaid(toMermaid(model)).model;
    expect(back.shapes.filter((s) => s.type === 'item').map((s) => s.icon?.key)).toEqual([
      'aws-elb',
      'aws-ecs',
    ]);
  });

  it('still reads a Mermaid file that has no annotations', () => {
    const foreign = 'flowchart TD\n  a["Lambda"]\n  b["S3 Bucket"]\n  a --> b';
    const { model, unmatched } = fromMermaid(foreign);
    expect(model.shapes.filter((s) => s.type === 'item').map((s) => s.icon?.key)).toEqual([
      'aws-lambda',
      'aws-s3',
    ]);
    expect(unmatched).toEqual([]);
  });

  it('keeps the annotation block out of the flowchart body', () => {
    const body = toMermaid(SAMPLE).split('%% aion:services')[0];
    expect(body).not.toContain('aws-');
  });
});
