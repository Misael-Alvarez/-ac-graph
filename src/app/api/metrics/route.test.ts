import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appMetrics } from '@/server/observability/metrics';
import { captureLogs, type LogCapture } from '@/server/testing/logs';
import { GET } from './route';

let logs: LogCapture;

beforeEach(() => {
  logs = captureLogs();
});

afterEach(() => {
  logs.restore();
  vi.unstubAllEnvs();
});

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/metrics', { headers });

describe('GET /api/metrics', () => {
  it('exposes the registry in the Prometheus text format', async () => {
    appMetrics().httpRequests.inc({ route: '/api/diagrams', method: 'GET', status: 200 });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).toContain('# TYPE acgraph_http_requests_total counter');
    expect(text).toContain(
      'acgraph_http_requests_total{route="/api/diagrams",method="GET",status="200"} 1',
    );
    expect(text).toContain('process_resident_memory_bytes');
    // The scrape itself is not a request worth counting.
    expect(text).not.toContain('route="/api/metrics"');
  });

  it('is open when no token is configured', async () => {
    vi.stubEnv('METRICS_TOKEN', '');
    expect((await GET(request())).status).toBe(200);
  });

  it('demands the bearer token when one is configured', async () => {
    vi.stubEnv('METRICS_TOKEN', 'scrape-me');
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request({ authorization: 'Bearer wrong' }))).status).toBe(401);
    expect((await GET(request({ authorization: 'Basic c2NyYXBlLW1l' }))).status).toBe(401);
    const ok = await GET(request({ authorization: 'bearer scrape-me' }));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('# TYPE');
  });

  it('logs the scrape at debug level only', async () => {
    await GET(request());
    const [line] = logs.named('http request');
    expect(line).toMatchObject({ level: 'debug', route: '/api/metrics', status: 200 });
  });
});
