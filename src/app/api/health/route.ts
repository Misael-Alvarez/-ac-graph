import { observe } from '@/server/observability/request';

export const dynamic = 'force-dynamic';

/** Liveness only: the process answers. Quiet, so probes stay out of the metrics. */
export function GET(request: Request) {
  return observe(request, { route: '/api/health', quiet: true }, () =>
    Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } }),
  );
}
