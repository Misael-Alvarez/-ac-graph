import { DiagLogLevel, diag, type DiagLogger } from '@opentelemetry/api';
import type { ObservabilityEnv } from '../env';
import { log, type Logger } from './log';

/**
 * Optional OpenTelemetry traces.
 *
 * Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` names a collector. When on, a
 * tracer provider is registered globally and Next.js, which is instrumented
 * already, emits a span per request (`GET /api/diagrams/[id]`), per route
 * handler and per outgoing `fetch`; log records carry `traceId` and `spanId`.
 * The exporter reads the standard `OTEL_EXPORTER_OTLP_*` variables itself, so
 * headers and a traces-specific URL work exactly as the OpenTelemetry
 * specification says. The SDK is loaded only on this path: a deployment
 * without a collector never pays for it.
 */
export interface Tracing {
  shutdown(): Promise<void>;
}

export async function startTracing(
  env: Pick<ObservabilityEnv, 'otlpEndpoint' | 'serviceName'>,
  logger: Logger = log(),
): Promise<Tracing | null> {
  if (!env.otlpEndpoint) return null;

  const [sdk, exporter, resources, semconv] = await Promise.all([
    import('@opentelemetry/sdk-trace-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/semantic-conventions'),
  ]);

  // Exporter failures — a collector that is down — surface as log records.
  diag.setLogger(bridge(logger), DiagLogLevel.WARN);

  const provider = new sdk.NodeTracerProvider({
    resource: resources.resourceFromAttributes({
      [semconv.ATTR_SERVICE_NAME]: env.serviceName,
      [semconv.ATTR_SERVICE_VERSION]: process.env.NEXT_PUBLIC_BUILD_STAMP ?? 'dev',
    }),
    spanProcessors: [new sdk.BatchSpanProcessor(new exporter.OTLPTraceExporter())],
  });
  provider.register();

  return {
    shutdown: async () => {
      await provider.shutdown();
      diag.disable();
    },
  };
}

function bridge(logger: Logger): DiagLogger {
  const to =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (message: string, ...args: unknown[]) =>
      logger[level](`opentelemetry: ${message}`, args.length ? { args } : undefined);
  return {
    verbose: to('debug'),
    debug: to('debug'),
    info: to('info'),
    warn: to('warn'),
    error: to('error'),
  };
}
