import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/dsl';
import { fromKubernetes } from './kubernetes';
import { ImportError } from './shared';

/** A deployment fronted by a service, the shape most manifests take. */
const BASIC = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: payments
  labels:
    app.kubernetes.io/part-of: payments
spec:
  replicas: 3
  template:
    metadata:
      labels:
        app: checkout
    spec:
      containers:
        - name: checkout
          image: registry.internal/checkout:2.4.1
---
apiVersion: v1
kind: Service
metadata:
  name: checkout-svc
  namespace: payments
spec:
  selector:
    app: checkout
  ports:
    - port: 8080
`;

const nodes = (r: ReturnType<typeof fromKubernetes>) => Object.keys(r.document.nodes);
const specOf = (r: ReturnType<typeof fromKubernetes>, key: string) => {
  const entry = r.document.nodes[key];
  return typeof entry === 'string' ? { service: entry } : entry;
};

describe('reading manifests', () => {
  it('takes a workload and the service in front of it', () => {
    const result = fromKubernetes(BASIC);
    expect(nodes(result).sort()).toEqual(['checkout', 'checkout-svc']);
  });

  it('reads the whole `---` separated stream, not just the first document', () => {
    // Which is what `kubectl get -o yaml` and every Helm render produce.
    expect(nodes(fromKubernetes(BASIC))).toHaveLength(2);
  });

  it('files a namespace as a boundary', () => {
    const result = fromKubernetes(BASIC);
    expect(result.document.boundaries?.payments?.label).toBe('Payments');
    expect(specOf(result, 'checkout').in).toBe('payments');
  });

  it('leaves the default namespace unboundaried, since it groups nothing', () => {
    const result = fromKubernetes(BASIC.replaceAll('namespace: payments', 'namespace: default'));
    expect(result.document.boundaries).toBeUndefined();
  });
});

describe('what a workload is', () => {
  it('believes the image over the kind', () => {
    // A StatefulSet running postgres is a database, and the image is the only
    // place that says so.
    const result = fromKubernetes(`
apiVersion: apps/v1
kind: StatefulSet
metadata: {name: orders-db}
spec:
  template:
    spec:
      containers: [{name: db, image: postgres:16}]
`);
    expect(specOf(result, 'orders-db').service).toBe('gen-postgresql');
  });

  it('falls back to the kind when the image says nothing', () => {
    const result = fromKubernetes(`
apiVersion: apps/v1
kind: Deployment
metadata: {name: api}
spec:
  template:
    spec:
      containers: [{name: api, image: registry/acme/api:1.0}]
`);
    expect(specOf(result, 'api').service).toBe('gen-container');
  });

  it('keeps a kind it has never heard of rather than dropping it', () => {
    const result = fromKubernetes(`
apiVersion: acme.io/v1
kind: PaymentGateway
metadata: {name: stripe-bridge}
`);
    // An operator's custom resource is part of the architecture whether or not
    // this importer recognises it.
    expect(specOf(result, 'stripe-bridge').service).toBe('gen-server');
    expect(result.warnings).toContainEqual({
      kind: 'unknownKind',
      values: { what: 'PaymentGateway' },
    });
  });

  it('skips the manifests that are policy rather than architecture', () => {
    const result = fromKubernetes(`${BASIC}
---
apiVersion: v1
kind: ServiceAccount
metadata: {name: checkout-sa, namespace: payments}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: deny-all, namespace: payments}
`);
    expect(nodes(result)).toHaveLength(2);
  });
});

describe('the arrows, which the list does not state', () => {
  it('routes a service to the workload its selector matches', () => {
    const result = fromKubernetes(BASIC);
    expect(result.document.edges).toEqual([
      { from: 'checkout-svc', to: 'checkout', label: ':8080', style: 'solid' },
    ]);
  });

  it('matches on every label of the selector, not any of them', () => {
    const result = fromKubernetes(`
apiVersion: apps/v1
kind: Deployment
metadata: {name: web}
spec:
  template:
    metadata: {labels: {app: web, tier: front}}
    spec: {containers: [{name: web, image: nginx}]}
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: worker}
spec:
  template:
    metadata: {labels: {app: web, tier: back}}
    spec: {containers: [{name: worker, image: acme/worker}]}
---
apiVersion: v1
kind: Service
metadata: {name: web-svc}
spec:
  selector: {app: web, tier: front}
  ports: [{port: 80}]
`);
    expect(result.document.edges).toHaveLength(1);
    expect(result.document.edges[0]).toMatchObject({ to: 'web' });
  });

  it('draws nothing for a selector that would select everything', () => {
    const result = fromKubernetes(`
apiVersion: apps/v1
kind: Deployment
metadata: {name: api}
spec:
  template:
    metadata: {labels: {app: api}}
    spec: {containers: [{name: api, image: acme/api}]}
---
apiVersion: v1
kind: Service
metadata: {name: everything}
spec: {ports: [{port: 80}]}
`);
    expect(result.document.edges).toEqual([]);
    expect(result.warnings).toContainEqual({
      kind: 'serviceSelectsNothing',
      values: { name: 'everything' },
    });
  });

  it('admits traffic through an ingress to the service it names', () => {
    const result = fromKubernetes(`${BASIC}
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: {name: public, namespace: payments}
spec:
  rules:
    - host: pagos.acme.com
      http:
        paths:
          - path: /checkout
            backend: {service: {name: checkout-svc, port: {number: 8080}}}
`);
    expect(result.document.edges).toContainEqual({
      from: 'public',
      to: 'checkout-svc',
      label: '/checkout',
      style: 'solid',
    });
  });

  it('says so when an ingress points outside the file', () => {
    const result = fromKubernetes(`
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: {name: public}
spec:
  rules:
    - http: {paths: [{path: /, backend: {service: {name: elsewhere}}}]}
`);
    expect(result.warnings).toContainEqual({
      kind: 'ingressMissingService',
      values: { name: 'elsewhere' },
    });
  });
});

describe('what the manifests already knew', () => {
  it('keeps the image as the technology, without the registry path', () => {
    expect(specOf(fromKubernetes(BASIC), 'checkout').technology).toBe('checkout:2.4.1');
  });

  it('keeps the owner a label already declared', () => {
    expect(specOf(fromKubernetes(BASIC), 'checkout').owner).toBe('payments');
  });

  it('reads the environment out of a namespace that states one', () => {
    const result = fromKubernetes(BASIC.replaceAll('namespace: payments', 'namespace: prod'));
    expect(specOf(result, 'checkout').environment).toBe('prod');
  });

  it('claims no environment when the namespace does not imply one', () => {
    expect(specOf(fromKubernetes(BASIC), 'checkout').environment).toBeUndefined();
  });
});

describe('refusing', () => {
  it('rejects an empty paste', () => {
    expect(() => fromKubernetes('   ')).toThrow(ImportError);
  });

  it('rejects YAML that is not manifests', () => {
    expect(() => fromKubernetes('name: hello\nvalue: 3')).toThrow(
      expect.objectContaining({ code: 'unrecognised' }),
    );
  });

  // The YAML parser is lenient enough that very little is outright unreadable —
  // a stray brace becomes a map with an odd key. So most rubbish arrives here as
  // "readable, but not manifests", which is the more useful thing to say anyway.
  it('rejects rubbish as unrecognised rather than pretending to draw it', () => {
    expect(() => fromKubernetes('hello there')).toThrow(
      expect.objectContaining({ code: 'unrecognised' }),
    );
  });
});

describe('what comes out is a document the rest of the app already understands', () => {
  it('compiles into a diagram, laid out and boundaried', () => {
    const { model, diagnostics } = compile(fromKubernetes(BASIC).document);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(2);
    expect(model.shapes.filter((s) => s.type === 'boundary')).toHaveLength(1);
    expect(model.connectors).toHaveLength(1);
  });

  it('carries the metadata through to the nodes', () => {
    const { model } = compile(fromKubernetes(BASIC).document);
    const item = model.shapes.find((s) => s.type === 'item' && s.title === 'checkout');
    expect(item?.meta?.owner).toBe('payments');
    expect(item?.meta?.technology).toBe('checkout:2.4.1');
  });
});
