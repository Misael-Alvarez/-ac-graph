import { performance } from 'node:perf_hooks';
import type { Pool } from 'pg';
import { peekSingleton, singleton } from '../globals';

/**
 * A small Prometheus registry: counters, gauges and histograms, rendered in
 * the text exposition format that Prometheus, Grafana Agent and the
 * OpenTelemetry collector all scrape.
 *
 * Label values are the only thing that can make a metric expensive, so every
 * label here is chosen from a closed set — the route template, the method, the
 * status code, an outcome — and never a user, diagram or session id. A metric
 * that still grows past `MAX_SERIES` label sets stops accepting new ones and
 * says so in `acgraph_metrics_series_dropped_total`.
 */
export type Labels = Record<string, string | number>;

export const MAX_SERIES = 500;

/** Latency buckets in seconds: 1 ms to 10 s, roughly a factor of two apart. */
export const DURATION_BUCKETS = [
  0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

interface Series<T> {
  labels: Labels;
  value: T;
}

abstract class Metric<T> {
  protected readonly series = new Map<string, Series<T>>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
    private readonly onDrop: (metric: string) => void,
  ) {}

  abstract readonly type: 'counter' | 'gauge' | 'histogram';

  protected slot(labels: Labels, create: () => T): Series<T> | null {
    const normalised = this.normalise(labels);
    const key = seriesKey(normalised, this.labelNames);
    let entry = this.series.get(key);
    if (!entry) {
      if (this.series.size >= MAX_SERIES) {
        this.onDrop(this.name);
        return null;
      }
      entry = { labels: normalised, value: create() };
      this.series.set(key, entry);
    }
    return entry;
  }

  private normalise(labels: Labels): Labels {
    const out: Labels = {};
    for (const name of this.labelNames) {
      const raw = labels[name];
      out[name] = raw === undefined ? '' : String(raw);
    }
    return out;
  }

  /** The current label sets and values; for tests and collectors. */
  entries(): Series<T>[] {
    return [...this.series.values()];
  }

  reset(): void {
    this.series.clear();
  }

  abstract render(): string[];

  protected header(): string[] {
    return [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} ${this.type}`];
  }
}

export class Counter extends Metric<number> {
  readonly type = 'counter' as const;

  inc(labels: Labels = {}, value = 1): void {
    if (!(value >= 0)) return;
    const entry = this.slot(labels, () => 0);
    if (entry) entry.value += value;
  }

  get(labels: Labels = {}): number {
    return this.slot(labels, () => 0)?.value ?? 0;
  }

  render(): string[] {
    return [
      ...this.header(),
      ...this.entries().map((entry) => sample(this.name, entry.labels, entry.value)),
    ];
  }
}

export class Gauge extends Metric<number> {
  readonly type = 'gauge' as const;

  set(labels: Labels, value: number): void;
  set(value: number): void;
  set(labelsOrValue: Labels | number, maybeValue?: number): void {
    const labels = typeof labelsOrValue === 'number' ? {} : labelsOrValue;
    const value = typeof labelsOrValue === 'number' ? labelsOrValue : (maybeValue ?? 0);
    const entry = this.slot(labels, () => 0);
    if (entry) entry.value = value;
  }

  inc(labels: Labels = {}, value = 1): void {
    const entry = this.slot(labels, () => 0);
    if (entry) entry.value += value;
  }

  dec(labels: Labels = {}, value = 1): void {
    this.inc(labels, -value);
  }

  get(labels: Labels = {}): number {
    return this.slot(labels, () => 0)?.value ?? 0;
  }

  render(): string[] {
    return [
      ...this.header(),
      ...this.entries().map((entry) => sample(this.name, entry.labels, entry.value)),
    ];
  }
}

interface HistogramValue {
  counts: number[];
  sum: number;
  count: number;
}

export class Histogram extends Metric<HistogramValue> {
  readonly type = 'histogram' as const;

  constructor(
    name: string,
    help: string,
    labelNames: readonly string[],
    onDrop: (metric: string) => void,
    readonly buckets: readonly number[] = DURATION_BUCKETS,
  ) {
    super(name, help, labelNames, onDrop);
    if (labelNames.includes('le')) throw new Error(`${name}: "le" is reserved for histograms`);
  }

  observe(labels: Labels, value: number): void;
  observe(value: number): void;
  observe(labelsOrValue: Labels | number, maybeValue?: number): void {
    const labels = typeof labelsOrValue === 'number' ? {} : labelsOrValue;
    const value = typeof labelsOrValue === 'number' ? labelsOrValue : (maybeValue ?? 0);
    if (!Number.isFinite(value)) return;
    const entry = this.slot(labels, () => ({
      counts: this.buckets.map(() => 0),
      sum: 0,
      count: 0,
    }));
    if (!entry) return;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) entry.value.counts[i]++;
    }
    entry.value.sum += value;
    entry.value.count++;
  }

  render(): string[] {
    const lines = this.header();
    for (const { labels, value } of this.entries()) {
      this.buckets.forEach((bound, i) => {
        lines.push(
          sample(`${this.name}_bucket`, { ...labels, le: String(bound) }, value.counts[i]),
        );
      });
      lines.push(sample(`${this.name}_bucket`, { ...labels, le: '+Inf' }, value.count));
      lines.push(sample(`${this.name}_sum`, labels, value.sum));
      lines.push(sample(`${this.name}_count`, labels, value.count));
    }
    return lines;
  }
}

export type Collector = (registry: Registry) => void;

export class Registry {
  private readonly metrics = new Map<string, Counter | Gauge | Histogram>();
  private readonly collectors: Collector[] = [];
  readonly dropped: Counter;

  constructor() {
    this.dropped = new Counter(
      'acgraph_metrics_series_dropped_total',
      'Label sets refused because a metric reached its series limit.',
      ['metric'],
      () => {},
    );
    this.metrics.set(this.dropped.name, this.dropped);
  }

  private drop = (metric: string) => this.dropped.inc({ metric });

  counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    return this.register(name, () => new Counter(name, help, labelNames, this.drop), Counter);
  }

  gauge(name: string, help: string, labelNames: readonly string[] = []): Gauge {
    return this.register(name, () => new Gauge(name, help, labelNames, this.drop), Gauge);
  }

  histogram(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DURATION_BUCKETS,
  ): Histogram {
    return this.register(
      name,
      () => new Histogram(name, help, labelNames, this.drop, buckets),
      Histogram,
    );
  }

  /** Runs before every render, for values that are read rather than counted. */
  collect(collector: Collector): void {
    this.collectors.push(collector);
  }

  render(): string {
    for (const collector of this.collectors) {
      try {
        collector(this);
      } catch {
        // A failing collector must not take the whole scrape down.
      }
    }
    const lines: string[] = [];
    for (const metric of this.metrics.values()) lines.push(...metric.render());
    return lines.join('\n') + '\n';
  }

  /** Every value back to zero; registrations and collectors stay. Tests only. */
  reset(): void {
    for (const metric of this.metrics.values()) metric.reset();
  }

  private register<T extends Counter | Gauge | Histogram>(
    name: string,
    create: () => T,
    kind: new (...args: never[]) => T,
  ): T {
    if (!METRIC_NAME.test(name)) throw new Error(`Invalid metric name: ${name}`);
    const existing = this.metrics.get(name);
    if (existing) {
      if (!(existing instanceof kind)) {
        throw new Error(`${name} is already registered as a ${existing.type}`);
      }
      return existing;
    }
    const metric = create();
    this.metrics.set(name, metric);
    return metric;
  }
}

const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

function seriesKey(labels: Labels, names: readonly string[]): string {
  return names.map((name) => `${name}=${labels[name]}`).join('\u0000');
}

function sample(name: string, labels: Labels, value: number): string {
  const pairs = Object.entries(labels).map(([key, raw]) => `${key}="${escapeLabel(String(raw))}"`);
  return pairs.length
    ? `${name}{${pairs.join(',')}} ${formatNumber(value)}`
    : `${name} ${formatNumber(value)}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function escapeHelp(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function formatNumber(value: number): string {
  if (value === Infinity) return '+Inf';
  if (value === -Infinity) return '-Inf';
  if (Number.isNaN(value)) return 'NaN';
  return String(value);
}

const REGISTRY_KEY = 'metrics';

/** The process registry with the application's metrics registered. */
export function metrics(): Registry {
  return singleton(REGISTRY_KEY, () => {
    const registry = new Registry();
    registerRuntimeCollectors(registry);
    return registry;
  });
}

/**
 * Everything the application counts, created once per process. Modules reach
 * their metric through here, so the names and labels live in one place.
 */
export interface AppMetrics {
  httpRequests: Counter;
  httpDuration: Histogram;
  httpInFlight: Gauge;
  httpConflicts: Counter;
  diagramSaves: Counter;
  iconWrites: Counter;
  commentWrites: Counter;
  sessionsCreated: Counter;
  sessionsEnded: Counter;
  logins: Counter;
  sseConnections: Gauge;
  sseConnectionsTotal: Counter;
  sseEvents: Counter;
  dbTransactions: Counter;
  dbTransactionDuration: Histogram;
  unhandledErrors: Counter;
  busMessages: Counter;
  busDropped: Counter;
  busConnected: Gauge;
  busReconnects: Counter;
}

const APP_METRICS_KEY = 'appMetrics';

export function appMetrics(registry?: Registry): AppMetrics {
  if (registry) return defineAppMetrics(registry);
  return singleton(APP_METRICS_KEY, () => defineAppMetrics(metrics()));
}

function defineAppMetrics(registry: Registry): AppMetrics {
  const defined = declareAppMetrics(registry);
  // Unlabelled series exist from the first scrape, so "no sessions yet" is a 0, not a gap.
  defined.httpInFlight.set(0);
  defined.sessionsCreated.inc({}, 0);
  defined.sessionsEnded.inc({}, 0);
  defined.sseConnections.set(0);
  defined.sseConnectionsTotal.inc({}, 0);
  defined.busConnected.set(0);
  defined.busReconnects.inc({}, 0);
  return defined;
}

function declareAppMetrics(registry: Registry): AppMetrics {
  return {
    httpRequests: registry.counter(
      'acgraph_http_requests_total',
      'API requests handled, by route template, method and status code.',
      ['route', 'method', 'status'],
    ),
    httpDuration: registry.histogram(
      'acgraph_http_request_duration_seconds',
      'Time from receiving a request to returning its response headers.',
      ['route', 'method'],
    ),
    httpInFlight: registry.gauge(
      'acgraph_http_requests_in_flight',
      'API requests being handled right now.',
    ),
    httpConflicts: registry.counter(
      'acgraph_http_conflicts_total',
      'Writes refused with 412 because the editor held a stale revision.',
      ['route'],
    ),
    diagramSaves: registry.counter(
      'acgraph_diagram_saves_total',
      'Diagram writes through the repository, by operation and outcome.',
      ['operation', 'result'],
    ),
    iconWrites: registry.counter(
      'acgraph_icon_writes_total',
      "Writes to the workspace's icon library, by operation and outcome.",
      ['operation', 'result'],
    ),
    commentWrites: registry.counter(
      'acgraph_comment_writes_total',
      'Comment threads opened, answered, resolved or deleted, by outcome.',
      ['operation', 'result'],
    ),
    sessionsCreated: registry.counter(
      'acgraph_sessions_created_total',
      'Sign-ins that produced a session cookie.',
    ),
    sessionsEnded: registry.counter(
      'acgraph_sessions_ended_total',
      'Sessions ended explicitly by signing out.',
    ),
    logins: registry.counter('acgraph_logins_total', 'Sign-in attempts, by outcome.', ['result']),
    sseConnections: registry.gauge(
      'acgraph_sse_connections',
      'Open event streams (one per viewer per diagram) in this process.',
    ),
    sseConnectionsTotal: registry.counter(
      'acgraph_sse_connections_total',
      'Event streams opened since the process started.',
    ),
    sseEvents: registry.counter(
      'acgraph_sse_events_published_total',
      'Events published to streams, by type.',
      ['type'],
    ),
    dbTransactions: registry.counter(
      'acgraph_db_transactions_total',
      'Database transactions, by outcome.',
      ['result'],
    ),
    dbTransactionDuration: registry.histogram(
      'acgraph_db_transaction_duration_seconds',
      'Wall time of a database transaction, from connect to release.',
    ),
    unhandledErrors: registry.counter(
      'acgraph_unhandled_errors_total',
      'Errors that escaped a handler, by where Next.js caught them.',
      ['source'],
    ),
    busMessages: registry.counter(
      'acgraph_collab_bus_messages_total',
      'Collaboration bus traffic: sent, received from another replica, or echo of our own.',
      ['direction', 'kind'],
    ),
    busDropped: registry.counter(
      'acgraph_collab_bus_dropped_total',
      'Bus messages not delivered, by reason.',
      ['reason'],
    ),
    busConnected: registry.gauge(
      'acgraph_collab_bus_connected',
      '1 while this process listens to the collaboration bus.',
    ),
    busReconnects: registry.counter(
      'acgraph_collab_bus_reconnects_total',
      'Times the listening connection was re-established after a loss.',
    ),
  };
}

/**
 * Process and runtime gauges read at scrape time, named as `prom-client` names
 * them so existing Node.js dashboards apply unchanged.
 */
export function registerRuntimeCollectors(
  registry: Registry,
  options: { buildStamp?: string; pool?: () => Pool | undefined } = {},
): void {
  const startTime = registry.gauge(
    'process_start_time_seconds',
    'Start time of the process since unix epoch in seconds.',
  );
  const cpuUser = registry.counter(
    'process_cpu_user_seconds_total',
    'Total user CPU time spent in seconds.',
  );
  const cpuSystem = registry.counter(
    'process_cpu_system_seconds_total',
    'Total system CPU time spent in seconds.',
  );
  const rss = registry.gauge('process_resident_memory_bytes', 'Resident memory size in bytes.');
  const heapTotal = registry.gauge(
    'nodejs_heap_size_total_bytes',
    'Process heap size from Node.js in bytes.',
  );
  const heapUsed = registry.gauge(
    'nodejs_heap_size_used_bytes',
    'Process heap size used from Node.js in bytes.',
  );
  const external = registry.gauge(
    'nodejs_external_memory_bytes',
    'Node.js external memory size in bytes.',
  );
  const elu = registry.gauge(
    'nodejs_eventloop_utilization',
    'Share of time the event loop was busy since the previous scrape (0 to 1).',
  );
  const version = registry.gauge('nodejs_version_info', 'Node.js version info.', [
    'version',
    'major',
    'minor',
    'patch',
  ]);
  const build = registry.gauge('acgraph_build_info', 'The running build.', ['stamp', 'node']);
  const poolClients = registry.gauge(
    'acgraph_db_pool_clients',
    'PostgreSQL pool clients by state; absent until the pool exists.',
    ['state'],
  );

  const started = Date.now() / 1000 - process.uptime();
  const [major, minor, patch] = process.versions.node.split('.');
  let lastCpu = { user: 0, system: 0 };
  let lastElu = performance.eventLoopUtilization();
  const readPool = options.pool ?? (() => peekSingleton<Pool>('pgPool'));

  registry.collect(() => {
    startTime.set(started);
    const cpu = process.cpuUsage();
    cpuUser.inc({}, (cpu.user - lastCpu.user) / 1e6);
    cpuSystem.inc({}, (cpu.system - lastCpu.system) / 1e6);
    lastCpu = cpu;
    const memory = process.memoryUsage();
    rss.set(memory.rss);
    heapTotal.set(memory.heapTotal);
    heapUsed.set(memory.heapUsed);
    external.set(memory.external);
    const current = performance.eventLoopUtilization();
    elu.set(performance.eventLoopUtilization(current, lastElu).utilization);
    lastElu = current;
    version.set({ version: process.version, major, minor, patch }, 1);
    build.set(
      {
        stamp: options.buildStamp ?? process.env.NEXT_PUBLIC_BUILD_STAMP ?? '',
        node: process.version,
      },
      1,
    );
    const pool = readPool();
    if (pool) {
      poolClients.set({ state: 'total' }, pool.totalCount);
      poolClients.set({ state: 'idle' }, pool.idleCount);
      poolClients.set({ state: 'waiting' }, pool.waitingCount);
    }
  });
}
