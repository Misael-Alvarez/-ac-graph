import { collaboration } from '../collab/collaboration';
import { readObservabilityEnv, serverMode } from '../env';
import { rootLogger } from './log';
import { appMetrics } from './metrics';
import { startTracing } from './tracing';

/**
 * What happens once, when the Node.js server starts: the logger takes its
 * configuration, the metrics exist with zero values so a first scrape sees
 * every series, the collaboration bus starts listening in server mode, traces
 * start if a collector is configured, and one record says which build is
 * running in which mode with which settings.
 *
 * Called from `src/instrumentation.ts`; safe to call more than once.
 */
export async function startObservability(): Promise<void> {
  const env = readObservabilityEnv();
  const logger = rootLogger();
  appMetrics();
  // Server mode: open the replica bus now, so the first viewer already hears the others.
  if (serverMode()) collaboration();

  const tracing = await startTracing(env, logger).catch((thrown: unknown) => {
    logger.error('tracing did not start', { err: thrown });
    return null;
  });

  if (tracing) {
    const stop = () => {
      tracing.shutdown().catch(() => {});
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  }

  logger.info('server started', {
    mode: serverMode() ? 'server' : 'local',
    node: process.version,
    build: process.env.NEXT_PUBLIC_BUILD_STAMP ?? null,
    pid: process.pid,
    logLevel: env.logLevel,
    logFormat: env.logFormat,
    tracing: tracing !== null,
    metricsProtected: env.metricsToken !== null,
  });
}

interface RequestErrorInfo {
  path: string;
  method: string;
}

interface RequestErrorContext {
  routerKind: string;
  routePath: string;
  routeType: string;
}

/**
 * Errors Next.js caught outside our handlers: a page render, a server action,
 * the proxy. Route handlers log their own through `errorResponse`, so this is
 * the safety net, not the main path. Headers are deliberately not read.
 */
export function reportRequestError(
  thrown: unknown,
  request: RequestErrorInfo,
  context: RequestErrorContext,
): void {
  appMetrics().unhandledErrors.inc({ source: context.routeType });
  rootLogger().error('unhandled request error', {
    err: thrown,
    method: request.method,
    path: request.path.split('?')[0],
    route: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    digest: digestOf(thrown),
  });
}

function digestOf(thrown: unknown): string | undefined {
  if (typeof thrown === 'object' && thrown !== null && 'digest' in thrown) {
    const digest = (thrown as { digest: unknown }).digest;
    return typeof digest === 'string' ? digest : undefined;
  }
  return undefined;
}
