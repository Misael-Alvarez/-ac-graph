import { timingSafeEqual } from 'node:crypto';
import { readObservabilityEnv } from '@/server/env';
import { error } from '@/server/http';
import { metrics } from '@/server/observability/metrics';
import { observe } from '@/server/observability/request';

export const dynamic = 'force-dynamic';

/**
 * Prometheus scrape endpoint.
 *
 * Open by default because the metrics carry no user data — route templates,
 * status codes, counts, process gauges — and Docker publishes the port on
 * loopback. Behind a public reverse proxy set `METRICS_TOKEN` and scrape with
 * `Authorization: Bearer <token>`.
 */
export function GET(request: Request) {
  return observe(request, { route: '/api/metrics', quiet: true }, () => {
    const { metricsToken } = readObservabilityEnv();
    if (metricsToken && !bearerMatches(request, metricsToken)) {
      return error(401, 'unauthenticated', 'This endpoint requires the metrics token.');
    }
    return new Response(metrics().render(), {
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  });
}

function bearerMatches(request: Request, token: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
