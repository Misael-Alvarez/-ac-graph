import { describe, expect, it } from 'vitest';
import type { DiagramModel } from '@/lib/domain';
import * as E from '@/lib/engine';
import { TEMPLATES } from '@/lib/editor/templates';
import { parseDsl } from './parse';
import { serializeDsl } from './serialize';
import { dominantCloud, matchServiceLabel, resolveService, shortenService } from './services';
import { normaliseEdges } from './schema';

const SAMPLE = `version: 1
cloud: aws
nodes:
  api:
    service: apigateway
    label: API pública
  fn: lambda
  db: dynamodb
edges:
  - api -> fn: invoke
  - fn -> db: R/W
`;

const nodesOf = (model: DiagramModel | null) =>
  (model?.shapes ?? []).filter((s) => s.type === 'group');
const itemsOf = (model: DiagramModel | null) =>
  (model?.shapes ?? []).filter((s) => s.type === 'item');

describe('resolveService', () => {
  it('accepts a fully qualified key', () => {
    expect(resolveService('aws-lambda')).toBe('aws-lambda');
  });

  it('resolves a bare name inside the document cloud', () => {
    expect(resolveService('lambda', 'aws')).toBe('aws-lambda');
    expect(resolveService('functions', 'azure')).toBe('az-functions');
    expect(resolveService('cloudrun', 'gcp')).toBe('gcp-cloudrun');
  });

  it('matches a human label', () => {
    expect(resolveService('API Gateway', 'aws')).toBe('aws-apigateway');
  });

  it('returns null for something it does not know', () => {
    expect(resolveService('definitely-not-a-service')).toBeNull();
    expect(resolveService('  ')).toBeNull();
  });

  it('shortens a key back to its bare form', () => {
    expect(shortenService('aws-lambda', 'aws')).toBe('lambda');
    expect(shortenService('gen-redis', 'aws')).toBe('gen-redis');
    expect(shortenService('aws-lambda')).toBe('aws-lambda');
  });

  it('reports a single cloud only when the services agree', () => {
    expect(dominantCloud(['aws-lambda', 'aws-s3'])).toBe('aws');
    expect(dominantCloud(['aws-lambda', 'gcp-bigquery'])).toBeUndefined();
    expect(dominantCloud(['gen-redis'])).toBeUndefined();
  });
});

describe('normaliseEdges', () => {
  it('reads the compact arrow form', () => {
    expect(normaliseEdges([{ 'a -> b': 'label' }])).toEqual([
      { from: 'a', to: 'b', label: 'label', style: 'solid' },
    ]);
  });

  it('accepts the other arrow spellings', () => {
    expect(normaliseEdges([{ 'a --> b': '' }, { 'c → d': '' }]).map((e) => e.from)).toEqual([
      'a',
      'c',
    ]);
  });

  it('reads the long form with a style', () => {
    expect(normaliseEdges([{ from: 'a', to: 'b', style: 'dashed' }])).toEqual([
      { from: 'a', to: 'b', label: '', style: 'dashed' },
    ]);
  });

  it('skips a key with no arrow in it', () => {
    expect(normaliseEdges([{ nonsense: 'x' }])).toEqual([]);
  });
});

describe('parseDsl', () => {
  it('builds one group per node and one connector per edge', () => {
    const { model, diagnostics } = parseDsl(SAMPLE);
    expect(diagnostics).toEqual([]);
    expect(nodesOf(model)).toHaveLength(3);
    expect(model!.connectors).toHaveLength(2);
  });

  it('resolves services against the document cloud', () => {
    const { model } = parseDsl(SAMPLE);
    expect(itemsOf(model).map((s) => s.icon?.key)).toEqual([
      'aws-apigateway',
      'aws-lambda',
      'aws-dynamodb',
    ]);
  });

  it('honours an explicit label and falls back to the service name', () => {
    const { model } = parseDsl(SAMPLE);
    const titles = itemsOf(model).map((s) => s.title);
    expect(titles[0]).toBe('API pública');
    expect(titles[1]).toBe('Lambda');
  });

  it('lays nodes out in the direction of the edges', () => {
    const { model } = parseDsl(SAMPLE);
    const [api, fn, db] = nodesOf(model);
    expect(api.y).toBeLessThan(fn.y);
    expect(fn.y).toBeLessThan(db.y);
  });

  it('pins positions given in the layout block', () => {
    const { model } = parseDsl(`${SAMPLE}layout:\n  api: [1000, 2000]\n`);
    const api = nodesOf(model).find((g) => g.title === 'API pública')!;
    expect({ x: api.x, y: api.y }).toEqual({ x: 1000, y: 2000 });
  });

  it('mixes pinned and automatic positions', () => {
    const { model } = parseDsl(`${SAMPLE}layout:\n  db: [50, 60]\n`);
    const groups = nodesOf(model);
    const db = groups.find((g) => g.title === 'DynamoDB')!;
    expect({ x: db.x, y: db.y }).toEqual({ x: 50, y: 60 });
    expect(groups.find((g) => g.title === 'Lambda')!.x).not.toBe(50);
  });

  it('carries the connector label and style', () => {
    const { model } = parseDsl(
      `${SAMPLE}  - from: api\n    to: db\n    label: direct\n    style: dashed\n`,
    );
    const dashed = model!.connectors.find((c) => c.style === 'dashed');
    expect(dashed?.label).toBe('direct');
  });

  it('routes every connector it creates', () => {
    const { model } = parseDsl(SAMPLE);
    for (const c of model!.connectors) expect(c.waypoints.length).toBeGreaterThanOrEqual(2);
  });

  it('groups nodes inside the boundary they declare', () => {
    const { model, diagnostics } = parseDsl(`version: 1
cloud: aws
boundaries:
  vpc:
    label: Production VPC
nodes:
  fn:
    service: lambda
    in: vpc
  db:
    service: dynamodb
    in: vpc
edges: []
`);
    expect(diagnostics).toEqual([]);
    const boundary = model!.shapes.find((s) => s.type === 'boundary')!;
    expect(boundary.title).toBe('Production VPC');
    for (const group of nodesOf(model)) {
      expect(E.geometricallyContains(E.bbox(boundary), E.bbox(group))).toBe(true);
    }
  });

  it('returns an empty model for empty source', () => {
    const { model, diagnostics } = parseDsl('   ');
    expect(model!.shapes).toHaveLength(0);
    expect(diagnostics).toEqual([]);
  });
});

describe('parseDsl diagnostics', () => {
  it('reports a YAML syntax error with a position', () => {
    const { model, diagnostics } = parseDsl('nodes:\n  a: [unclosed\n');
    expect(model).toBeNull();
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].to).toBeGreaterThan(0);
  });

  it('reports a missing required field', () => {
    const { model, diagnostics } = parseDsl('version: 1\n');
    expect(model).toBeNull();
    expect(diagnostics.some((d) => d.message.includes('nodes'))).toBe(true);
  });

  it('reports an unknown service and anchors it to the node', () => {
    const { diagnostics } = parseDsl('nodes:\n  broken: not-a-real-service\nedges: []\n');
    const issue = diagnostics.find((d) => d.message.includes('Unknown service'));
    expect(issue?.severity).toBe('error');
    expect(issue!.to).toBeGreaterThan(issue!.from);
  });

  it('still produces a diagram when one service is unknown', () => {
    const { model } = parseDsl('nodes:\n  ok: lambda\n  broken: nope\nedges: []\n');
    expect(nodesOf(model)).toHaveLength(2);
  });

  it('warns about an edge naming a node that does not exist', () => {
    const { model, diagnostics } = parseDsl(
      'cloud: aws\nnodes:\n  a: lambda\nedges:\n  - a -> ghost: x\n',
    );
    expect(model!.connectors).toHaveLength(0);
    expect(diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('warns about an empty boundary', () => {
    const { diagnostics } = parseDsl(
      'cloud: aws\nboundaries:\n  vpc: {}\nnodes:\n  a: lambda\nedges: []\n',
    );
    expect(diagnostics.some((d) => d.message.includes('no nodes'))).toBe(true);
  });
});

describe('serializeDsl', () => {
  it('emits source that parses back to the same diagram', () => {
    const original = parseDsl(SAMPLE).model!;
    const round = parseDsl(serializeDsl(original)).model!;

    expect(nodesOf(round)).toHaveLength(nodesOf(original).length);
    expect(round.connectors).toHaveLength(original.connectors.length);
    expect(itemsOf(round).map((s) => s.icon?.key)).toEqual(
      itemsOf(original).map((s) => s.icon?.key),
    );
    expect(itemsOf(round).map((s) => s.title)).toEqual(itemsOf(original).map((s) => s.title));
  });

  it('preserves positions through a round trip', () => {
    const original = parseDsl(SAMPLE).model!;
    const moved = E.cloneModel(original);
    const group = moved.shapes.find((s) => s.type === 'group')!;
    group.x = 1234;
    group.y = 567;

    const round = parseDsl(serializeDsl(moved)).model!;
    const same = round.shapes.find((s) => s.type === 'group' && s.title === group.title)!;
    expect({ x: same.x, y: same.y }).toEqual({ x: 1234, y: 567 });
  });

  it('preserves connector labels and styles', () => {
    const model = parseDsl(SAMPLE).model!;
    model.connectors[0].style = 'dashed';
    const round = parseDsl(serializeDsl(model)).model!;
    expect(round.connectors.map((c) => c.label).sort()).toEqual(['R/W', 'invoke']);
    expect(round.connectors.some((c) => c.style === 'dashed')).toBe(true);
  });

  it('is stable: serializing twice gives identical source', () => {
    const model = parseDsl(SAMPLE).model!;
    const once = serializeDsl(model);
    expect(serializeDsl(parseDsl(once).model!)).toBe(once);
  });

  it('uses the compact arrow form for plain edges', () => {
    const source = serializeDsl(parseDsl(SAMPLE).model!);
    expect(source).toMatch(/- api-p\S* -> lambda: invoke/);
  });

  it('collapses a node whose label and subtitle just repeat the catalogue', () => {
    const model = parseDsl('cloud: aws\nnodes:\n  fn: lambda\nedges: []\n').model!;
    expect(serializeDsl(model)).toMatch(/^ {2}lambda: lambda$/m);
  });

  it('writes coordinates inline rather than as a block sequence', () => {
    expect(serializeDsl(parseDsl(SAMPLE).model!)).toMatch(/\[\d+, ?\d+\]/);
  });

  it('emits the shared cloud and strips the prefix from every service', () => {
    const source = serializeDsl(parseDsl(SAMPLE).model!);
    expect(source).toContain('cloud: aws');
    expect(source).not.toContain('aws-lambda');
  });

  it('keeps full keys when the diagram spans several clouds', () => {
    const model = parseDsl('nodes:\n  a: aws-lambda\n  b: gcp-bigquery\nedges: []\n').model!;
    const source = serializeDsl(model);
    expect(source).not.toContain('cloud:');
    expect(source).toContain('aws-lambda');
    expect(source).toContain('gcp-bigquery');
  });

  it('can leave the layout block out', () => {
    const source = serializeDsl(parseDsl(SAMPLE).model!, { includeLayout: false });
    expect(source).not.toContain('layout:');
  });

  it('round-trips boundaries and membership', () => {
    const original = parseDsl(`cloud: aws
boundaries:
  vpc:
    label: Production VPC
nodes:
  fn:
    service: lambda
    in: vpc
edges: []
`).model!;
    const source = serializeDsl(original);
    expect(source).toContain('Production VPC');
    expect(source).toMatch(/in: \S+/);

    const round = parseDsl(source).model!;
    expect(round.shapes.filter((s) => s.type === 'boundary')).toHaveLength(1);
  });

  it('handles an empty diagram', () => {
    const source = serializeDsl(E.createEmptyModel());
    expect(parseDsl(source).model!.shapes).toHaveLength(0);
  });
});

describe('a node is more than a box', () => {
  const SOURCE = `version: 1
cloud: aws
nodes:
  api:
    service: apigateway
    owner: payments-platform
    technology: FastAPI
    repository: github/payments-api
    environment: prod
    criticality: critical
    lifecycle: active
    tags:
      - pci
  db:
    service: dynamodb
    owner: payments-platform
edges:
  - from: api
    to: db
    label: R/W
    protocol: https
    kind: sync
    auth: IAM
    dataClass: pii
`;

  it('carries what a node is into the model', () => {
    const { model } = parseDsl(SOURCE);
    const api = itemsOf(model).find((s) => s.icon?.key === 'aws-apigateway')!;
    expect(api.meta).toEqual({
      technology: 'FastAPI',
      owner: 'payments-platform',
      repository: 'github/payments-api',
      environment: 'prod',
      criticality: 'critical',
      lifecycle: 'active',
      tags: ['pci'],
    });
  });

  it('carries what an edge means into the model', () => {
    const { model } = parseDsl(SOURCE);
    expect(model!.connectors[0].meta).toEqual({
      protocol: 'https',
      kind: 'sync',
      auth: 'IAM',
      dataClass: 'pii',
    });
  });

  it('writes it all back out, unchanged', () => {
    const first = parseDsl(SOURCE);
    const written = serializeDsl(first.model!, { includeLayout: false });
    const again = parseDsl(written);

    const metaOf = (model: typeof first.model) =>
      itemsOf(model)
        .map((s) => [s.icon?.key, s.meta] as const)
        .sort(([a], [b]) => String(a).localeCompare(String(b)));
    expect(metaOf(again.model)).toEqual(metaOf(first.model));
    expect(again.model!.connectors[0].meta).toEqual(first.model!.connectors[0].meta);
  });

  it('leaves an undescribed edge in the short form', () => {
    // The long form is the price of saying more; an arrow that says nothing
    // extra should not pay it.
    const { model } = parseDsl(`version: 1
nodes:
  a: lambda
  b: dynamodb
edges:
  - a -> b: writes
`);
    // Node keys are regenerated from titles, so assert the notation, not the ids.
    const written = serializeDsl(model!, { includeLayout: false });
    expect(written).toContain(' -> ');
    expect(written).not.toContain('from:');
  });
});

describe('clouds beyond the first three', () => {
  it('accepts a cloud the catalogue grew into', () => {
    // `cloud: oci` used to fail the schema, so an Oracle diagram could be drawn
    // on the canvas but not written down in code.
    const { model, diagnostics } = parseDsl(`version: 1
cloud: oci
nodes:
  api: functions
  files: objectstorage
edges:
  - api -> files: read
`);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const keys = (model?.shapes ?? []).flatMap((s) => (s.icon ? [s.icon.key] : []));
    expect(keys).toContain('oci-functions');
    expect(keys).toContain('oci-objectstorage');
  });

  it('resolves an unprefixed name inside an IBM document', () => {
    expect(resolveService('codeengine', 'ibm')).toBe('ibm-codeengine');
    expect(resolveService('vpc', 'ibm')).toBe('ibm-vpc');
  });

  it('writes the cloud back out, so the round trip is lossless', () => {
    const source = `version: 1
cloud: ibm
nodes:
  run: codeengine
  net: vpc
`;
    const first = parseDsl(source);
    const written = serializeDsl(first.model!);
    expect(written).toContain('cloud: ibm');
    const again = parseDsl(written);
    const keys = (model: DiagramModel | null) =>
      (model?.shapes ?? []).flatMap((s) => (s.icon ? [s.icon.key] : [])).sort();
    expect(keys(again.model)).toEqual(keys(first.model));
  });

  it('shortens and detects the new clouds like any other', () => {
    expect(shortenService('oci-functions', 'oci')).toBe('functions');
    expect(dominantCloud(['ibm-vpc', 'ibm-codeengine'])).toBe('ibm');
    expect(dominantCloud(['ibm-vpc', 'oci-functions'])).toBeUndefined();
  });
});

describe('templates round-trip through the DSL', () => {
  for (const template of TEMPLATES) {
    it(`preserves "${template.id}"`, () => {
      const original = template.build('en');
      const round = parseDsl(serializeDsl(original)).model!;

      expect(nodesOf(round)).toHaveLength(nodesOf(original).length);
      expect(round.connectors).toHaveLength(original.connectors.length);
      expect(
        itemsOf(round)
          .map((s) => s.icon?.key)
          .sort(),
      ).toEqual(
        itemsOf(original)
          .map((s) => s.icon?.key)
          .sort(),
      );
      // Positions survive, so loading a template and editing its code is lossless.
      const positions = (m: DiagramModel) =>
        nodesOf(m)
          .map((g) => `${g.title}@${Math.round(g.x)},${Math.round(g.y)}`)
          .sort();
      expect(positions(round)).toEqual(positions(original));
    });
  }
});

describe('matchServiceLabel', () => {
  it('matches an exact name first', () => {
    expect(matchServiceLabel('Lambda')).toBe('aws-lambda');
  });

  it('looks past descriptive words a human would add', () => {
    expect(matchServiceLabel('S3 Bucket')).toBe('aws-s3');
    expect(matchServiceLabel('RDS Primary')).toBe('aws-rds');
    expect(matchServiceLabel('EC2 Web Tier')).toBe('aws-ec2');
  });

  it('prefers the most specific service when several could match', () => {
    // "API Gateway" must not lose to a shorter label that also fits.
    expect(matchServiceLabel('API Gateway')).toBe('aws-apigateway');
  });

  it('returns null rather than guessing', () => {
    expect(matchServiceLabel('Bespoke Widget')).toBeNull();
    expect(matchServiceLabel('')).toBeNull();
  });

  it('leaves the strict resolver strict', () => {
    // The DSL must still reject an unknown service instead of matching loosely.
    expect(resolveService('S3 Bucket')).toBeNull();
  });
});

describe('generated diagrams are clean', () => {
  const collisionTitles = (model: DiagramModel) =>
    [...E.checkCollisions(model)]
      .map((id) => E.getShape(model, id)?.title ?? id)
      .filter((t) => !t.startsWith('ctr_'))
      .sort();

  it('keeps a node that is not in a boundary clear of it', () => {
    const { model } = parseDsl(`cloud: aws
boundaries:
  vpc:
    label: Production VPC
nodes:
  cdn: cloudfront
  api: { service: apigateway, in: vpc }
  fn: { service: lambda, in: vpc }
  db: { service: dynamodb, in: vpc }
  bucket: { service: s3 }
edges:
  - cdn -> api: HTTPS
  - api -> fn: invoke
  - fn -> db: R/W
  - fn -> bucket: files
`);
    expect(collisionTitles(model!)).toEqual([]);
  });

  it('still contains every declared member', () => {
    const { model } = parseDsl(`cloud: aws
boundaries:
  vpc: { label: VPC }
nodes:
  a: { service: lambda, in: vpc }
  b: { service: dynamodb, in: vpc }
  c: { service: s3 }
edges:
  - a -> b: x
  - a -> c: y
`);
    const boundary = model!.shapes.find((s) => s.type === 'boundary')!;
    const groups = model!.shapes.filter((s) => s.type === 'group');
    const inside = groups.filter((g) => E.geometricallyContains(E.bbox(boundary), E.bbox(g)));
    expect(inside).toHaveLength(2);
  });

  it('produces no overlaps for a plain layered diagram', () => {
    const { model } = parseDsl(`cloud: aws
nodes:
  a: cloudfront
  b: apigateway
  c: lambda
  d: dynamodb
  e: s3
edges:
  - a -> b: ''
  - b -> c: ''
  - c -> d: ''
  - c -> e: ''
`);
    expect(collisionTitles(model!)).toEqual([]);
  });

  it('handles two boundaries side by side', () => {
    const { model } = parseDsl(`cloud: aws
boundaries:
  prod: { label: Production }
  data: { label: Data }
nodes:
  api: { service: apigateway, in: prod }
  fn: { service: lambda, in: prod }
  db: { service: dynamodb, in: data }
  wh: { service: redshift, in: data }
edges:
  - api -> fn: ''
  - fn -> db: ''
  - db -> wh: ''
`);
    expect(model!.shapes.filter((s) => s.type === 'boundary')).toHaveLength(2);
    expect(collisionTitles(model!)).toEqual([]);
  });
});

describe('a diagram authored in Spanish', () => {
  it('round-trips without writing a subtitle override for every node', () => {
    const spanish = TEMPLATES[0].build('es');
    const text = serializeDsl(spanish);

    // The subtitles came from the catalogue, so they are not the author's
    // words and have no business in the document. Before the catalogue spoke
    // Spanish this comparison was against English only, and every node in a
    // Spanish diagram picked up a redundant `subtitle:`.
    expect(text).not.toContain('subtitle:');
    expect(parseDsl(text, 'es').model).not.toBeNull();
  });

  it('keeps a subtitle the author actually wrote', () => {
    const model = TEMPLATES[0].build('es');
    const item = model.shapes.find((s) => s.type === 'item')!;
    item.subtitle = 'El de producción';
    expect(serializeDsl(model)).toContain('El de producción');
  });

  it('fills subtitles from the catalogue in the language it is compiled for', () => {
    const source = 'version: 1\nnodes:\n  api:\n    service: lambda\n';
    const es = parseDsl(source, 'es').model!;
    const en = parseDsl(source, 'en').model!;
    const subtitle = (m: typeof es) => m.shapes.find((s) => s.type === 'item')?.subtitle;

    expect(subtitle(es)).toBe('Cómputo serverless');
    expect(subtitle(en)).toBe('Serverless compute');
  });
});

describe('views round-trip', () => {
  /** The serverless template with a second view that moved one node. */
  function withView() {
    const model = TEMPLATES[0].build('en');
    const groups = model.shapes.filter((s) => s.type === 'group');
    const moved = groups[0];
    const place: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const id of E.collectDescendantIds(model, moved.id)) {
      const shape = E.getShape(model, id)!;
      place[id] = { x: shape.x + 500, y: shape.y + 400, w: shape.w, h: shape.h };
    }
    model.views = [
      { id: E.MAIN_VIEW_ID, name: '', kind: 'free' },
      {
        id: 'view_security',
        name: 'Security',
        kind: 'security',
        include: [groups[0].id, groups[1].id],
        place,
      },
    ];
    return { model, movedId: moved.id, keptIds: [groups[0].id, groups[1].id] };
  }

  it('survives a serialize and parse', () => {
    const { model } = withView();
    const back = parseDsl(serializeDsl(model)).model!;

    expect(back.views).toHaveLength(2);
    expect(back.views[0].id).toBe(E.MAIN_VIEW_ID);
    expect(back.views[1].name).toBe('Security');
    expect(back.views[1].kind).toBe('security');
  });

  // The trap this whole design exists to avoid: compile mints fresh ids, so a
  // view written in ids would select nothing the moment the code panel is used.
  it('re-anchors to the rebuilt shapes rather than to dead ids', () => {
    const { model } = withView();
    const back = parseDsl(serializeDsl(model)).model!;
    const security = back.views[1];

    expect(security.include).not.toEqual([]);
    for (const id of security.include!) {
      expect(E.getShape(back, id), id).toBeDefined();
    }
  });

  it('keeps the view narrowed to the same two services', () => {
    const { model } = withView();
    const before = E.resolveView(model, 'view_security');
    const after = parseDsl(serializeDsl(model)).model!;
    const resolved = E.resolveView(after, after.views[1].id);

    const names = (m: typeof before) =>
      m.shapes
        .filter((s) => s.type === 'group')
        .map((s) => s.title)
        .sort();
    expect(names(resolved)).toEqual(names(before));
  });

  it('keeps the node this view moved away from where the model has it', () => {
    const { model } = withView();
    const after = parseDsl(serializeDsl(model)).model!;
    const security = after.views[1];

    const groupId = security.include![0];
    const base = E.getShape(after, groupId)!;
    const placed = security.place![groupId];
    expect(placed).toBeDefined();
    expect(placed.x).not.toBe(base.x);
  });

  it('writes nothing at all for a diagram nobody split', () => {
    const text = serializeDsl(TEMPLATES[0].build('en'));
    expect(text).not.toContain('views:');
    expect(parseDsl(text).model!.views).toEqual([]);
  });

  it('reports a view naming a node the document does not define', () => {
    const source = [
      'version: 1',
      'nodes:',
      '  api: lambda',
      'views:',
      '  security:',
      '    name: Security',
      '    include: [api, ghost]',
    ].join('\n');

    const { model, diagnostics } = parseDsl(source);
    expect(diagnostics.some((d) => d.severity === 'warning')).toBe(true);
    // The view is still built from what it could resolve: dropping it entirely
    // would lose the reading over a typo.
    expect(model!.views[0].include).toHaveLength(1);
  });
});
