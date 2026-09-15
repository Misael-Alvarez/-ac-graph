import type { NextRequest } from 'next/server';
import { beginLogin, safeNextPath } from '@/server/auth/oidc';
import { authenticate, callerAddress, LoginBodySchema, takeAttempt } from '@/server/auth/password';
import { authStateCookie, createSession, sessionCookie } from '@/server/auth/session';
import { withServerMode } from '@/server/handler';
import { HttpError, json } from '@/server/http';
import { parseBody } from '@/server/diagrams/routes';
import { annotateRequest } from '@/server/observability/context';
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
  return withServerMode(request, { route: '/api/auth/login', provider: 'oidc' }, async () => {
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

/**
 * Signs in with an e-mail and a password. Same-origin only, like every write.
 *
 * Two buckets of attempts are charged before the database is asked: one for
 * the address the request came from and one for the e-mail it names, so a
 * guesser is slowed down whichever of the two it varies. A wrong e-mail and a
 * wrong password are the same 401.
 */
export function POST(request: Request) {
  return withServerMode(
    request,
    { route: '/api/auth/login', mutating: true, provider: 'local' },
    async () => {
      const body = await parseBody(request, LoginBodySchema);
      takeAttempt('login', `ip:${callerAddress(request)}`);
      takeAttempt('login', `email:${body.email}`);
      try {
        const user = await authenticate(body);
        annotateRequest({ userId: user.id });
        const session = await createSession(user.id);
        appMetrics().logins.inc({ result: 'ok' });
        return json({ user }, { headers: { 'Set-Cookie': sessionCookie(session.id) } });
      } catch (error) {
        if (error instanceof HttpError && error.code === 'invalid_credentials') {
          appMetrics().logins.inc({ result: 'rejected' });
          // Counted and logged, never with the e-mail: an access log is not a
          // list of who tried.
          log().info('password rejected');
        }
        throw error;
      }
    },
  );
}
