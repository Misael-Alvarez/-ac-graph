import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureLogs, type LogCapture } from '../testing/logs';
import { annotateRequest, currentRequest } from './context';
import { log } from './log';
import { appMetrics, metrics } from './metrics';
import { REQUEST_ID_HEADER, observe, requestIdFrom, routeParams, withRequestId } from './request';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let logs: LogCapture;

beforeEach(() => {
  logs = captureLogs();
});

afterEach(() => {
  logs.restore();
});

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://graph.example.com${path}`, { headers });

describe('requestIdFrom', () => {
  it('keeps an id an upstream proxy set when it looks like one', () => {
    expect(requestIdFrom(get('/x', { [REQUEST_ID_HEADER]: 'abc-123_XYZ.9' }))).toBe(
      'abc-123_XYZ.9',
    );
  });

  it('replaces a missing, short, long or odd id with a UUID', () => {
    expect(requestIdFrom(get('/x'))).toMatch(UUID);
    expect(requestIdFrom(get('/x', { [REQUEST_ID_HEADER]: 'short' }))).toMatch(UUID);
    expect(requestIdFrom(get('/x', { [REQUEST_ID_HEADER]: 'a'.repeat(129) }))).toMatch(UUID);
    expect(requestIdFrom(get('/x', { [REQUEST_ID_HEADER]: 'has spaces and "quotes"' }))).toMatch(
      UUID,
    );
    expect(requestIdFrom(get('/x', { [REQUEST_ID_HEADER]: '{"json":"not-an-id"}' }))).toMatch(UUID);
  });
});

describe('routeParams', () => {
  it('reads the dynamic segments of a matching path', () => {
    expect(routeParams('/api/diagrams/[id]', '/api/diagrams/dgm_1')).toEqual({ id: 'dgm_1' });
    expect(
      routeParams(
        '/api/diagrams/[id]/versions/[versionId]/restore',
        '/api/diagrams/dgm_1/versions/ver_2/restore',
      ),
    ).toEqual({ id: 'dgm_1', versionId: 'ver_2' });
  });

  it('is empty when the path does not match, and decodes and caps what it reads', () => {
    expect(routeParams('/api/diagrams/[id]', '/api/diagrams')).toEqual({});
    expect(routeParams('/api/diagrams/[id]', '/api/other/dgm_1')).toEqual({});
    expect(routeParams('/api/diagrams/[id]', '/api/diagrams/a%20b')).toEqual({ id: 'a b' });
    expect(routeParams('/api/diagrams/[id]', '/api/diagrams/%E0%A4%A')).toEqual({ id: '%E0%A4%A' });
    expect(routeParams('/api/diagrams/[id]', `/api/diagrams/${'x'.repeat(100)}`).id).toHaveLength(
      64,
    );
  });
});

describe('withRequestId', () => {
  it('sets the header in place when it can', () => {
    const response = new Response('ok');
    expect(withRequestId(response, 'req-1')).toBe(response);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('req-1');
  });

  it('rebuilds a response whose headers are immutable', async () => {
    const redirect = Response.redirect('https://graph.example.com/', 302);
    const stamped = withRequestId(redirect, 'req-2');
    expect(stamped).not.toBe(redirect);
    expect(stamped.status).toBe(302);
    expect(stamped.headers.get('location')).toBe('https://graph.example.com/');
    expect(stamped.headers.get(REQUEST_ID_HEADER)).toBe('req-2');
    expect(await stamped.text()).toBe('');
  });
});

describe('observe', () => {
  it('runs the handler in a request context, stamps the id and writes one access line', async () => {
    let seen: string | undefined;
    const response = await observe(
      get('/api/diagrams/dgm_42', { [REQUEST_ID_HEADER]: 'req-observe-1' }),
      { route: '/api/diagrams/[id]' },
      () => {
        seen = currentRequest()?.requestId;
        annotateRequest({ userId: 'usr_1' });
        log().info('inside handler');
        return new Response(null, { status: 204 });
      },
    );

    expect(seen).toBe('req-observe-1');
    expect(response.status).toBe(204);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('req-observe-1');
    expect(currentRequest()).toBeUndefined();

    const [inside] = logs.named('inside handler');
    expect(inside).toMatchObject({
      requestId: 'req-observe-1',
      method: 'GET',
      route: '/api/diagrams/[id]',
      diagramId: 'dgm_42',
      userId: 'usr_1',
    });

    const access = logs.named('http request');
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({
      level: 'info',
      requestId: 'req-observe-1',
      method: 'GET',
      route: '/api/diagrams/[id]',
      path: '/api/diagrams/dgm_42',
      status: 204,
      diagramId: 'dgm_42',
      userId: 'usr_1',
    });
    expect(typeof access[0].durationMs).toBe('number');
    expect(access[0].path).not.toContain('?');
  });

  it('never logs the query string', async () => {
    await observe(
      get('/api/auth/callback?code=SECRET&state=s'),
      { route: '/api/auth/callback' },
      () => new Response(null, { status: 302, headers: { Location: '/' } }),
    );
    expect(JSON.stringify(logs.records)).not.toContain('SECRET');
    expect(logs.named('http request')[0].path).toBe('/api/auth/callback');
  });

  it('records the request under its route template, never the concrete path', async () => {
    const app = appMetrics();
    await observe(
      get('/api/diagrams/dgm_a'),
      { route: '/api/diagrams/[id]' },
      () => new Response('a'),
    );
    await observe(
      get('/api/diagrams/dgm_b'),
      { route: '/api/diagrams/[id]' },
      () => new Response('b'),
    );
    await observe(
      get('/api/diagrams/dgm_c'),
      { route: '/api/diagrams/[id]' },
      () => new Response(null, { status: 412 }),
    );

    expect(app.httpRequests.get({ route: '/api/diagrams/[id]', method: 'GET', status: 200 })).toBe(
      2,
    );
    expect(app.httpRequests.get({ route: '/api/diagrams/[id]', method: 'GET', status: 412 })).toBe(
      1,
    );
    expect(app.httpConflicts.get({ route: '/api/diagrams/[id]' })).toBe(1);
    expect(app.httpInFlight.get()).toBe(0);

    const text = metrics().render();
    expect(text).not.toContain('dgm_a');
    expect(text).toContain(
      'acgraph_http_request_duration_seconds_count{route="/api/diagrams/[id]",method="GET"} 3',
    );
  });

  it('counts a request as in flight while the handler runs', async () => {
    const app = appMetrics();
    let during = -1;
    await observe(get('/api/x'), { route: '/api/x' }, () => {
      during = app.httpInFlight.get();
      return new Response('x');
    });
    expect(during).toBe(1);
    expect(app.httpInFlight.get()).toBe(0);
  });

  it('turns a thrown error into a 500, logs it at error level and still stamps the id', async () => {
    const response = await observe(get('/api/x'), { route: '/api/x' }, () => {
      throw new RangeError('out of bounds');
    });
    expect(response.status).toBe(500);
    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(UUID);
    const body = await response.json();
    expect(body.code).toBe('internal');
    expect(body.requestId).toBe(response.headers.get(REQUEST_ID_HEADER));

    const [failure] = logs.named('unhandled error');
    expect(failure).toMatchObject({
      level: 'error',
      route: '/api/x',
      err: { name: 'RangeError', message: 'out of bounds' },
    });
    const [access] = logs.named('http request');
    expect(access).toMatchObject({ level: 'error', status: 500, code: 'internal' });
    expect(appMetrics().httpRequests.get({ route: '/api/x', method: 'GET', status: 500 })).toBe(1);
  });

  it('writes the error code of a typed failure into the access line', async () => {
    const { error } = await import('../http');
    await observe(get('/api/x'), { route: '/api/x' }, () =>
      error(401, 'unauthenticated', 'Sign in'),
    );
    expect(logs.named('http request')[0]).toMatchObject({ status: 401, code: 'unauthenticated' });
  });

  it('keeps quiet routes out of the metrics and at debug level', async () => {
    const app = appMetrics();
    await observe(
      get('/api/health'),
      { route: '/api/health', quiet: true },
      () => new Response('ok'),
    );
    expect(app.httpRequests.entries()).toEqual([]);
    expect(app.httpInFlight.get()).toBe(0);
    const [line] = logs.named('http request');
    expect(line).toMatchObject({ level: 'debug', route: '/api/health', status: 200 });
  });

  it('carries the trace of one request without leaking into a concurrent one', async () => {
    const ids: string[] = [];
    await Promise.all(
      ['req-parallel-1', 'req-parallel-2'].map((id) =>
        observe(get('/api/x', { [REQUEST_ID_HEADER]: id }), { route: '/api/x' }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          ids.push(currentRequest()!.requestId);
          return new Response(id);
        }),
      ),
    );
    expect(ids.sort()).toEqual(['req-parallel-1', 'req-parallel-2']);
  });
});
