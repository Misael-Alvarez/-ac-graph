import { endSessionUrl } from '@/server/auth/oidc';
import { clearSessionCookie, destroySession } from '@/server/auth/session';
import { serverEnv } from '@/server/env';
import { withServerMode } from '@/server/handler';
import { json, noContent } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * Ends the app session. Same-origin only.
 *
 * 204 for a local account, or when the provider has no end-session endpoint;
 * otherwise 200 with `{ endSessionUrl }` so the browser can also sign out of
 * the provider.
 */
export function POST(request: Request) {
  return withServerMode(request, { route: '/api/auth/logout', mutating: true }, async () => {
    await destroySession(request);
    const headers = { 'Set-Cookie': clearSessionCookie() };
    const url = serverEnv().authProvider === 'oidc' ? await endSessionUrl() : null;
    return url ? json({ endSessionUrl: url }, { headers }) : noContent({ headers });
  });
}
