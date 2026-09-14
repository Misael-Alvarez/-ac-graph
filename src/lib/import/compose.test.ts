import { describe, expect, it, vi } from 'vitest';
import { compile, fromMermaid, toMermaid } from '@/lib/dsl';
import { fromCompose } from './compose';
import { ImportError } from './shared';

/** The stack most Compose files describe: a proxy, an app, its database and cache, a worker. */
const STACK = `
name: shop
services:
  proxy:
    image: nginx:1.25
    ports: ["80:80"]
    depends_on: [app]
    links: ["app:backend"]
    networks: [front]
  app:
    build: .
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    environment:
      DATABASE_URL: postgres://db/shop
    networks: [front, back]
  db:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]
    networks: [back]
  cache:
    image: redis:7
    networks: [back]
  worker:
    image: ghcr.io/acme/worker:2.1.0
    depends_on: [db]
    profiles: [dev]
    networks: [back]
  mailhog:
    image: mailhog/mailhog
    profiles: [dev]
networks:
  front: {}
  back: {}
volumes:
  pgdata: {}
`;

const nodes = (r: ReturnType<typeof fromCompose>) => Object.keys(r.document.nodes).sort();
const specOf = (r: ReturnType<typeof fromCompose>, key: string) => {
  const entry = r.document.nodes[key];
  return typeof entry === 'string' ? { service: entry } : entry;
};
const edge = (from: string, to: string) => ({ from, to, label: '', style: 'solid' });

describe('reading a Compose file', () => {
  it('takes a node per service', () => {
    expect(nodes(fromCompose(STACK))).toEqual(['app', 'cache', 'db', 'mailhog', 'proxy', 'worker']);
  });

  it('believes the image about what a service is', () => {
    const result = fromCompose(STACK);
    expect(specOf(result, 'db').service).toBe('gen-postgresql');
    expect(specOf(result, 'cache').service).toBe('gen-redis');
    expect(specOf(result, 'proxy').service).toBe('gen-nginx');
  });

  it('keeps a home-built service a plain container, without complaint', () => {
    // `build: .` names a directory, not a role.
    const result = fromCompose(STACK);
    expect(specOf(result, 'app')).toMatchObject({ service: 'gen-container', technology: 'build' });
    expect(result.warnings.find((w) => w.kind === 'unknownImages')?.values?.images).not.toContain(
      'app',
    );
  });

  it('trusts a name that states a generic role', () => {
    const result = fromCompose(`
services:
  web: {image: ghcr.io/acme/storefront:3.0}
  api: {build: ./api}
  payments-api: {image: acme/payments}
  database: {build: ./db}
`);
    expect(specOf(result, 'web').service).toBe('gen-web');
    expect(specOf(result, 'api').service).toBe('gen-api');
    expect(specOf(result, 'payments-api').service).toBe('gen-api');
    expect(specOf(result, 'database').service).toBe('gen-database');
    expect(result.warnings).toEqual([]);
  });

  it('never makes a cloud product out of a service name', () => {
    // A service called `s3` in a Compose file is an emulator.
    const result = fromCompose('services:\n  s3: {image: minio/minio}\n  search: {image: acme/x}');
    expect(specOf(result, 's3').service).toBe('gen-container');
    expect(specOf(result, 'search').service).toBe('gen-container');
  });

  it('never makes an actor out of a service name', () => {
    // `user-api` is an API about users, not a user; nothing a Compose file
    // runs is a person or a phone.
    const result = fromCompose(`
services:
  user-service: {build: ./users}
  user-api: {build: ./users}
  mobile-api: {image: acme/mobile-bff}
  users: {image: acme/users}
`);
    expect(specOf(result, 'user-service').service).toBe('gen-container');
    expect(specOf(result, 'user-api').service).toBe('gen-api');
    expect(specOf(result, 'mobile-api').service).toBe('gen-api');
    expect(specOf(result, 'users').service).toBe('gen-container');
  });

  it("reads Compose's own !reset and !override tags without a word on stderr", () => {
    const warned = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      const result = fromCompose(`
x-base: &base
  image: nginx:1.25
  ports: ["80:80"]
services:
  web:
    <<: *base
    ports: !reset []
    environment: !override
      MODE: quiet
`);
      expect(specOf(result, 'web')).toMatchObject({
        service: 'gen-nginx',
        technology: 'nginx:1.25',
      });
      expect(warned).not.toHaveBeenCalled();
    } finally {
      warned.mockRestore();
    }
  });

  it('admits which images it had to guess at, once', () => {
    expect(fromCompose(STACK).warnings).toEqual([
      { kind: 'unknownImages', values: { images: 'ghcr.io/acme/worker:2.1.0, mailhog/mailhog' } },
    ]);
  });

  it('merges the <<: *defaults idiom rather than reading it as a key', () => {
    const result = fromCompose(`
x-defaults: &defaults
  image: redis:7
  restart: always
services:
  cache:
    <<: *defaults
    ports: ["6379:6379"]
`);
    expect(specOf(result, 'cache')).toMatchObject({ service: 'gen-redis', technology: 'redis:7' });
  });

  it('takes the project name as the title', () => {
    expect(fromCompose(STACK).document.title).toBe('shop');
  });
});

describe('the arrows', () => {
  it('reads depends_on in both its forms', () => {
    const edges = fromCompose(STACK).document.edges;
    expect(edges).toContainEqual(edge('proxy', 'app'));
    expect(edges).toContainEqual(edge('app', 'db'));
    expect(edges).toContainEqual(edge('app', 'cache'));
    expect(edges).toContainEqual(edge('worker', 'db'));
  });

  it('reads a link to the service, not to its alias', () => {
    const result = fromCompose('services:\n  a: {image: nginx, links: ["b:backend"]}\n  b: {}');
    expect(result.document.edges).toEqual([edge('a', 'b')]);
  });

  it('draws one arrow where depends_on and links say the same thing', () => {
    const edges = fromCompose(STACK).document.edges as { from: string; to: string }[];
    expect(edges.filter((e) => e.from === 'proxy')).toHaveLength(1);
    expect(edges).toHaveLength(4);
  });

  it('ignores a dependency on a service the file does not have', () => {
    const result = fromCompose('services:\n  a: {image: nginx, depends_on: [elsewhere]}');
    expect(result.document.edges).toEqual([]);
  });
});

describe('networks as boundaries', () => {
  it('puts a service on one network inside that network, when the file segments', () => {
    const result = fromCompose(STACK);
    expect(result.document.boundaries).toEqual({
      front: { label: 'Front', variant: 'sub' },
      back: { label: 'Back', variant: 'sub' },
    });
    expect(specOf(result, 'proxy').in).toBe('front');
    expect(specOf(result, 'db').in).toBe('back');
    expect(specOf(result, 'cache').in).toBe('back');
  });

  it('leaves a service on several networks outside all of them', () => {
    // The app straddles front and back; a boundary can only hold what is
    // wholly inside it, so it sits between the two.
    expect(specOf(fromCompose(STACK), 'app').in).toBeUndefined();
  });

  it('leaves a service on no network outside as well', () => {
    expect(specOf(fromCompose(STACK), 'mailhog').in).toBeUndefined();
  });

  it('draws no boundary for a single network, which everything would share', () => {
    const result = fromCompose(`
services:
  a: {image: nginx, networks: [only]}
  b: {image: redis, networks: [only]}
networks:
  only: {}
`);
    expect(result.document.boundaries).toBeUndefined();
    expect(specOf(result, 'a').in).toBeUndefined();
  });
});

describe('what the file already knew', () => {
  it('keeps the image and tag as the technology, without the registry path', () => {
    const result = fromCompose(STACK);
    expect(specOf(result, 'db').technology).toBe('postgres:16-alpine');
    expect(specOf(result, 'worker').technology).toBe('worker:2.1.0');
  });

  it('keeps profiles as tags and reads the environment out of them', () => {
    const worker = specOf(fromCompose(STACK), 'worker');
    expect(worker.tags).toEqual(['dev']);
    expect(worker.environment).toBe('dev');
  });

  it('reads the environment out of a name that states one', () => {
    const result = fromCompose('services:\n  staging-db: {image: postgres}');
    expect(specOf(result, 'staging-db').environment).toBe('staging');
  });

  it('claims no environment when nothing implies one', () => {
    expect(specOf(fromCompose(STACK), 'db').environment).toBeUndefined();
  });
});

describe('refusing', () => {
  it('rejects an empty paste', () => {
    expect(() => fromCompose('   ')).toThrow(ImportError);
  });

  it('rejects YAML with no services map', () => {
    expect(() => fromCompose('version: "3.9"\nvolumes: {data: {}}')).toThrow(
      expect.objectContaining({ code: 'unrecognised' }),
    );
    expect(() => fromCompose('services: [a, b]')).toThrow(
      expect.objectContaining({ code: 'unrecognised' }),
    );
  });

  it('rejects YAML that will not parse', () => {
    expect(() => fromCompose('services:\n  a: [')).toThrow(
      expect.objectContaining({ code: 'unreadable' }),
    );
  });

  it('draws nothing, and says so, for a file with no services in it', () => {
    const result = fromCompose('services: {}\nvolumes: {data: {}}');
    expect(result.document.nodes).toEqual({});
    expect(result.warnings).toEqual([{ kind: 'noResources' }]);
  });
});

describe('what comes out compiles', () => {
  it('becomes a laid-out diagram with no errors', () => {
    const { model, diagnostics } = compile(fromCompose(STACK).document);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(model.shapes.filter((s) => s.type === 'group')).toHaveLength(6);
    expect(model.shapes.filter((s) => s.type === 'boundary')).toHaveLength(2);
    expect(model.connectors).toHaveLength(4);
  });

  it('carries the metadata through to the nodes', () => {
    const { model } = compile(fromCompose(STACK).document);
    const item = model.shapes.find((s) => s.type === 'item' && s.title === 'Worker');
    expect(item?.meta?.technology).toBe('worker:2.1.0');
    expect(item?.meta?.environment).toBe('dev');
  });

  it('survives a trip through Mermaid with every service intact', () => {
    const { model } = compile(fromCompose(STACK).document);
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
