import type { NextRequest } from 'next/server';
import { completeLogin } from '@/server/auth/oidc';
import {
  AUTH_STATE_COOKIE,
  clearAuthStateCookie,
  createSession,
  readCookie,
  sessionCookie,
} from '@/server/auth/session';
import { withServerMode } from '@/server/handler';

export const dynamic = 'force-dynamic';

/**
 * Where the provider sends the browser back. Validates state and nonce, then
 * signs the user in. A failed exchange — a replayed state, a rejected token, a
 * provider error — lands on the sign-in page with a flag; the detail stays in
 * the server log.
 */
export function GET(request: NextRequest) {
  return withServerMode(request, {}, async () => {
    const boundState = readCookie(request, AUTH_STATE_COOKIE);
    try {
      const { user, nextPath } = await completeLogin(request.nextUrl.searchParams, boundState);
      const session = await createSession(user.id);

      const headers = new Headers({ Location: nextPath, 'Cache-Control': 'no-store' });
      headers.append('Set-Cookie', sessionCookie(session.id));
      headers.append('Set-Cookie', clearAuthStateCookie());
      return new Response(null, { status: 302, headers });
    } catch (error) {
      console.error('[auth] login callback failed', error instanceof Error ? error.message : error);
      const headers = new Headers({
        Location: '/?auth_error=callback',
        'Cache-Control': 'no-store',
      });
      headers.append('Set-Cookie', clearAuthStateCookie());
      return new Response(null, { status: 302, headers });
    }
  });
}
