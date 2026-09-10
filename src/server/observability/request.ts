import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { errorResponse } from '../http';
import { runWithRequest, type RequestContext } from './context';
import { rootLogger } from './log';
import { appMetrics } from './metrics';

/**
 * The one place every API request passes through.
 *
 * `observe` gives the request an id (the caller's `x-request-id` when it looks
 * like one, a fresh UUID otherwise), runs the handler inside a request context
 * so anything it touches can log with that id, records the request in the
 * metrics under its route template, writes one access line, and echoes the id
 * back in the response so a person can quote it when something went wrong.
 *
 * Health checks and metric scrapes are `quiet`: they would otherwise be most of
 * the log and a constant, uninteresting share of the metrics.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/** What an upstream proxy or a client may hand us as an id. Anything else is replaced. */
const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

const MAX_PARAM_LENGTH = 64;

export interface ObserveOptions {
  /** The route template, e.g. `/api/diagrams/[id]`; the only route label metrics ever see. */
  route: string;
  quiet?: boolean;
}

export function requestIdFrom(request: Request): string {
  const given = request.headers.get(REQUEST_ID_HEADER)?.trim();
  return given && REQUEST_ID.test(given) ? given : randomUUID();
}

/**
 * The dynamic segments of `route` as found in `pathname`, so a request that
 * never reaches its handler — a 401, a 404 — is still logged with its diagram.
 */
export function routeParams(route: string, pathname: string): Record<string, string> {
  const pattern = route.split('/');
  const actual = pathname.split('/');
  if (pattern.length !== actual.length) return {};
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const segment = pattern[i];
    if (segment.startsWith('[') && segment.endsWith(']')) {
      params[segment.slice(1, -1)] = decodeSegment(actual[i]);
    } else if (segment !== actual[i]) {
      return {};
    }
  }
  return params;
}

function decodeSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // Keep the raw segment: it is only ever logged.
  }
  return decoded.slice(0, MAX_PARAM_LENGTH);
}

/** Sets the id on the response, rebuilding it when its headers are immutable. */
export function withRequestId(response: Response, requestId: string): Response {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export async function observe(
  request: Request,
  options: ObserveOptions,
  run: () => Promise<Response> | Response,
): Promise<Response> {
  const requestId = requestIdFrom(request);
  const method = request.method;
  const route = options.route;
  const path = new URL(request.url).pathname;

  const fields: Record<string, unknown> = {};
  const params = routeParams(route, path);
  if (route.startsWith('/api/diagrams/[id]') && params.id) fields.diagramId = params.id;
  if (params.versionId) fields.versionId = params.versionId;

  const context: RequestContext = {
    requestId,
    method,
    route,
    path,
    startedAt: performance.now(),
    fields,
    logger: rootLogger().child(() => ({ requestId, method, route, ...fields })),
  };

  const app = appMetrics();
  if (!options.quiet) app.httpInFlight.inc();

  return runWithRequest(context, async () => {
    let response: Response;
    try {
      response = await run();
    } catch (thrown) {
      response = errorResponse(thrown);
    }

    const durationMs = performance.now() - context.startedAt;
    const status = response.status;
    if (!options.quiet) {
      app.httpInFlight.dec();
      app.httpRequests.inc({ route, method, status });
      app.httpDuration.observe({ route, method }, durationMs / 1000);
      if (status === 412) app.httpConflicts.inc({ route });
    }

    const level = status >= 500 ? 'error' : options.quiet ? 'debug' : 'info';
    context.logger[level]('http request', {
      path,
      status,
      durationMs: Math.round(durationMs * 10) / 10,
    });

    return withRequestId(response, requestId);
  });
}
