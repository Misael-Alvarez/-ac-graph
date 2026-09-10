import { afterEach, describe, expect, it } from 'vitest';
import { resetSingleton } from '../globals';
import {
  DURATION_BUCKETS,
  MAX_SERIES,
  Registry,
  appMetrics,
  metrics,
  registerRuntimeCollectors,
} from './metrics';

afterEach(() => {
  resetSingleton('metrics');
  resetSingleton('appMetrics');
});

/** The rendered lines for one metric family, header included. */
function family(text: string, name: string): string[] {
  return text.split('\n').filter((line) => line.includes(name));
}

describe('Registry', () => {
  it('renders counters, gauges and histograms in the text exposition format', () => {
    const registry = new Registry();
    const requests = registry.counter('http_requests_total', 'Requests.', ['route', 'status']);
    const inFlight = registry.gauge('in_flight', 'Now.');
    const duration = registry.histogram('duration_seconds', 'Latency.', ['route'], [0.1, 1]);

    requests.inc({ route: '/api/x', status: 200 });
    requests.inc({ route: '/api/x', status: 200 });
    requests.inc({ route: '/api/x', status: 500 });
    inFlight.set(3);
    duration.observe({ route: '/api/x' }, 0.05);
    duration.observe({ route: '/api/x' }, 0.5);
    duration.observe({ route: '/api/x' }, 5);

    const text = registry.render();
    expect(text.endsWith('\n')).toBe(true);
    expect(family(text, 'http_requests_total')).toEqual([
      '# HELP http_requests_total Requests.',
      '# TYPE http_requests_total counter',
      'http_requests_total{route="/api/x",status="200"} 2',
      'http_requests_total{route="/api/x",status="500"} 1',
    ]);
    expect(family(text, 'in_flight')).toEqual([
      '# HELP in_flight Now.',
      '# TYPE in_flight gauge',
      'in_flight 3',
    ]);
    expect(family(text, 'duration_seconds')).toEqual([
      '# HELP duration_seconds Latency.',
      '# TYPE duration_seconds histogram',
      'duration_seconds_bucket{route="/api/x",le="0.1"} 1',
      'duration_seconds_bucket{route="/api/x",le="1"} 2',
      'duration_seconds_bucket{route="/api/x",le="+Inf"} 3',
      'duration_seconds_sum{route="/api/x"} 5.55',
      'duration_seconds_count{route="/api/x"} 3',
    ]);
  });

  it('escapes label values and help text', () => {
    const registry = new Registry();
    registry.counter('c', 'Help with \\ and\nnewline', ['l']).inc({ l: 'quote " back \\ nl \n' });
    const text = registry.render();
    expect(text).toContain('# HELP c Help with \\\\ and\\nnewline');
    expect(text).toContain('c{l="quote \\" back \\\\ nl \\n"} 1');
  });

  it('returns the same metric when registered twice and refuses a different type', () => {
    const registry = new Registry();
    const a = registry.counter('same', 'A.');
    expect(registry.counter('same', 'B.')).toBe(a);
    expect(() => registry.gauge('same', 'C.')).toThrow(/already registered as a counter/);
    expect(() => registry.counter('bad-name', 'D.')).toThrow(/Invalid metric name/);
    expect(() => registry.histogram('h', 'E.', ['le'])).toThrow(/reserved/);
  });

  it('ignores negative counter increments and non-finite observations', () => {
    const registry = new Registry();
    const counter = registry.counter('c', 'C.');
    counter.inc({}, -1);
    counter.inc({}, Number.NaN);
    counter.inc();
    expect(counter.get()).toBe(1);
    const histogram = registry.histogram('h', 'H.');
    histogram.observe(Number.POSITIVE_INFINITY);
    histogram.observe(Number.NaN);
    expect(histogram.entries()).toEqual([]);
  });

  it('gauges move both ways and unlabelled overloads work', () => {
    const registry = new Registry();
    const gauge = registry.gauge('g', 'G.', ['state']);
    gauge.inc({ state: 'a' });
    gauge.inc({ state: 'a' });
    gauge.dec({ state: 'a' });
    gauge.set({ state: 'b' }, 7);
    expect(gauge.get({ state: 'a' })).toBe(1);
    expect(gauge.get({ state: 'b' })).toBe(7);
    const plain = registry.gauge('p', 'P.');
    plain.set(2.5);
    expect(plain.get()).toBe(2.5);
  });

  it('stops accepting new label sets past the series limit and counts the refusals', () => {
    const registry = new Registry();
    const counter = registry.counter('busy', 'B.', ['id']);
    for (let i = 0; i < MAX_SERIES + 5; i++) counter.inc({ id: i });
    expect(counter.entries()).toHaveLength(MAX_SERIES);
    expect(registry.dropped.get({ metric: 'busy' })).toBe(5);
    // An existing series keeps counting.
    counter.inc({ id: 0 });
    expect(counter.get({ id: 0 })).toBe(2);
  });

  it('runs collectors before rendering and survives one that throws', () => {
    const registry = new Registry();
    const gauge = registry.gauge('read', 'R.');
    registry.collect(() => {
      throw new Error('nope');
    });
    registry.collect(() => gauge.set(42));
    expect(registry.render()).toContain('read 42');
  });

  it('reset() zeroes values but keeps registrations', () => {
    const registry = new Registry();
    const counter = registry.counter('c', 'C.');
    counter.inc();
    registry.reset();
    expect(counter.get()).toBe(0);
    expect(registry.counter('c', 'C.')).toBe(counter);
  });

  it('uses latency buckets from 1 ms to 10 s by default', () => {
    expect(DURATION_BUCKETS[0]).toBe(0.001);
    expect(DURATION_BUCKETS.at(-1)).toBe(10);
    expect([...DURATION_BUCKETS]).toEqual([...DURATION_BUCKETS].sort((a, b) => a - b));
  });
});

describe('runtime collectors', () => {
  it('report process, heap, event loop, version, build and pool gauges', () => {
    const registry = new Registry();
    const pool = { totalCount: 4, idleCount: 3, waitingCount: 1 };
    registerRuntimeCollectors(registry, {
      buildStamp: '2026-09-10T00:00:00.000Z',
      pool: () => pool as never,
    });
    const text = registry.render();
    expect(text).toMatch(/^process_start_time_seconds \d+/m);
    expect(text).toMatch(/^process_cpu_user_seconds_total \d/m);
    expect(text).toMatch(/^process_resident_memory_bytes \d+/m);
    expect(text).toMatch(/^nodejs_heap_size_used_bytes \d+/m);
    expect(text).toMatch(/^nodejs_eventloop_utilization [\d.]+/m);
    expect(text).toContain(`nodejs_version_info{version="${process.version}"`);
    expect(text).toContain(
      `acgraph_build_info{stamp="2026-09-10T00:00:00.000Z",node="${process.version}"} 1`,
    );
    expect(text).toContain('acgraph_db_pool_clients{state="total"} 4');
    expect(text).toContain('acgraph_db_pool_clients{state="idle"} 3');
    expect(text).toContain('acgraph_db_pool_clients{state="waiting"} 1');
  });

  it('omit the pool when there is none', () => {
    const registry = new Registry();
    registerRuntimeCollectors(registry, { pool: () => undefined });
    expect(registry.render()).not.toMatch(/^acgraph_db_pool_clients\{/m);
  });
});

describe('appMetrics', () => {
  it('is one set per process, primed so unlabelled series render as zero', () => {
    const app = appMetrics();
    expect(appMetrics()).toBe(app);
    expect(appMetrics().httpRequests).toBe(app.httpRequests);
    const text = metrics().render();
    expect(text).toContain('acgraph_http_requests_in_flight 0');
    expect(text).toContain('acgraph_sessions_created_total 0');
    expect(text).toContain('acgraph_sse_connections 0');
  });

  it('never uses an id as a label', () => {
    const app = appMetrics(new Registry());
    const labelNames = Object.values(app).flatMap((metric) => [...metric.labelNames]);
    for (const name of labelNames) expect(name).not.toMatch(/id$/i);
  });
});
