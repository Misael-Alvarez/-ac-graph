import type { NextRequest } from 'next/server';
import { beginLogin, safeNextPath } from '@/server/auth/oidc';
import { authStateCookie } from '@/server/auth/session';
import { withServerMode } from '@/server/handler';
import { log } from '@/server/observability/log';
import { appMetrics } from '@/server/observability/metrics';

export const dynamic = 'force-dynamic';

/**
 * Starts the OIDC flow. `?next=` must be a same-site path; anything else becomes `/`.
 *
 * When the identity provider cannot be reached — discovery failed, wrong issuer,
 * network down — the browser is sent back to the sign-in page with a flag rather
 * than shown a JSON 500: the person can read what happened and try again, and
 * the real cause is in the server log, never in the response.
 */
export function GET(request: NextRequest) {
  return withServerMode(request, { route: '/api/auth/login' }, async () => {
    const next = safeNextPath(request.nextUrl.searchParams.get('next'));
    try {
      const { authorizationUrl, state } = await beginLogin(next);
      return new Response(null, {
        status: 302,
        headers: {
          Location: authorizationUrl.href,
          'Set-Cookie': authStateCookie(state),
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      appMetrics().logins.inc({ result: 'error' });
      log().error('could not start login', { err: error });
      const back = new URL(next, request.nextUrl.origin);
      back.searchParams.set('auth_error', 'provider');
      return new Response(null, {
        status: 302,
        headers: { Location: back.pathname + back.search, 'Cache-Control': 'no-store' },
      });
    }
  });
}
