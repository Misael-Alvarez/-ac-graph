import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/dsl';
import { fromOpenApi } from './openapi';
import { ImportError } from './shared';

const SPEC = `
openapi: 3.0.3
info:
  title: Payments API
  version: 2.1.0
servers:
  - url: https://api.prod.acme.com/v2
tags:
  - name: orders
    description: Everything an order goes through.
  - name: refunds
paths:
  /orders:
    get: {tags: [orders], summary: List orders}
    post: {tags: [orders], summary: Create an order}
  /orders/{id}:
    get: {tags: [orders]}
    delete: {tags: [orders]}
  /refunds:
    post: {tags: [refunds]}
components:
  securitySchemes:
    bearerAuth: {type: http, scheme: bearer}
`;

const specOf = (r: ReturnType<typeof fromOpenApi>, key: string) => {
  const entry = r.document.nodes[key];
  return typeof entry === 'string' ? { service: entry } : entry;
};

describe('reading a description', () => {
  it('draws the API, its callers and its areas — not one box per path', () => {
    // Two hundred boxes, one per operation, is the hairball the whole tool
    // exists to avoid.
    const result = fromOpenApi(SPEC);
    expect(Object.keys(result.document.nodes).sort()).toEqual([
      'clients',
      'orders',
      'payments-api',
      'refunds',
    ]);
  });

  it('groups by tag, which is the grouping the authors already chose', () => {
    expect(specOf(fromOpenApi(SPEC), 'orders').subtitle).toBe('4 operations');
    expect(specOf(fromOpenApi(SPEC), 'refunds').subtitle).toBe('1 operation');
  });

  it('falls back to the first path segment when nothing is tagged', () => {
    const result = fromOpenApi(`
openapi: 3.0.0
info: {title: Bare, version: '1'}
paths:
  /invoices: {get: {}}
  /invoices/{id}: {get: {}}
  /customers: {get: {}}
`);
    expect(Object.keys(result.document.nodes).sort()).toEqual([
      'bare',
      'clients',
      'customers',
      'invoices',
    ]);
    expect(specOf(result, 'invoices').subtitle).toBe('2 operations');
  });

  it("keeps a tag's description as the node's note", () => {
    expect(specOf(fromOpenApi(SPEC), 'orders').note).toBe('Everything an order goes through.');
  });

  it('labels the arrow with the verbs the area actually offers', () => {
    const edges = fromOpenApi(SPEC).document.edges as { to: string; label: string }[];
    expect(edges.find((e) => e.to === 'orders')?.label).toBe('GET POST DELETE');
    expect(edges.find((e) => e.to === 'refunds')?.label).toBe('POST');
  });

  it('says how callers authenticate, in the words the spec used', () => {
    const edges = fromOpenApi(SPEC).document.edges as { from: string; label: string }[];
    expect(edges.find((e) => e.from === 'clients')?.label).toBe('Bearer');
  });

  it('reads the environment out of the server URL', () => {
    expect(specOf(fromOpenApi(SPEC), 'payments-api').environment).toBe('prod');
  });

  it('accepts JSON as readily as YAML, both being what people export', () => {
    const json = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'JSON API', version: '1' },
      paths: { '/things': { get: { tags: ['things'] } } },
    });
    expect(Object.keys(fromOpenApi(json).document.nodes)).toContain('things');
  });

  it('accepts Swagger 2, which plenty of specs still are', () => {
    const result = fromOpenApi(`
swagger: '2.0'
info: {title: Legacy, version: '1'}
paths:
  /things: {get: {tags: [things]}}
securityDefinitions:
  key: {type: apiKey}
`);
    const edges = result.document.edges as { from: string; label: string }[];
    expect(edges.find((e) => e.from === 'clients')?.label).toBe('API key');
  });
});

describe('a description with nothing in it', () => {
  it('still draws the API rather than failing', () => {
    const result = fromOpenApi("openapi: 3.0.0\ninfo: {title: Empty, version: '1'}\npaths: {}");
    expect(Object.keys(result.document.nodes).sort()).toEqual(['clients', 'empty']);
    expect(result.warnings).toContainEqual({ kind: 'noOperations' });
  });
});

describe('refusing', () => {
  it('rejects an empty paste', () => {
    expect(() => fromOpenApi('  ')).toThrow(ImportError);
  });

  it('rejects YAML that is not a description', () => {
    expect(() => fromOpenApi('kind: Deployment\napiVersion: apps/v1')).toThrow(
      expect.objectContaining({ code: 'unrecognised' }),
    );
  });
});

describe('what comes out compiles', () => {
  it('becomes a laid-out diagram with no errors', () => {
    const { model, diagnostics } = compile(fromOpenApi(SPEC).document);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(4);
    expect(model.connectors).toHaveLength(3);
  });
});

describe('the words this importer writes itself', () => {
  // "Clients" and "4 operations" are not in the description; they are this
  // importer's own copy, and they end up on the author's diagram.
  it('writes them in the author’s language', () => {
    const result = fromOpenApi(SPEC, 'es');
    // The key stays as it is: a document key is an identifier the DSL and the
    // views refer to, not something a reader reads.
    expect(specOf(result, 'clients').label).toBe('Clientes');
    expect(specOf(result, 'orders').subtitle).toBe('4 operaciones');
  });

  it('agrees with itself about one', () => {
    expect(specOf(fromOpenApi(SPEC, 'es'), 'refunds').subtitle).toBe('1 operación');
  });

  it('leaves what the description itself says untouched', () => {
    const result = fromOpenApi(SPEC, 'es');
    expect(specOf(result, 'payments-api').label).toBe('Payments API');
    expect(specOf(result, 'orders').note).toBe('Everything an order goes through.');
  });
});
