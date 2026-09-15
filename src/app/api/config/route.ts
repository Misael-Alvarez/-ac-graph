import { readServerEnv } from '@/server/env';
import { json } from '@/server/http';
import { observe } from '@/server/observability/request';

export const dynamic = 'force-dynamic';

/**
 * How the browser learns which mode this deployment runs in.
 *
 * Local mode: IndexedDB, no accounts. Server mode: PostgreSQL behind a login —
 * with a password kept here (`local`, and whether the sign-in page may create
 * an account) or through the company's provider (`oidc`). The answer depends
 * only on environment variables, so it never touches the database or the
 * identity provider.
 */
export function GET(request: Request) {
  return observe(request, { route: '/api/config' }, () => {
    const env = readServerEnv();
    if (!env) return json({ mode: 'local' });
    return json({
      mode: 'server',
      auth: {
        provider: env.authProvider,
        signup: env.signupOpen,
        loginUrl: '/api/auth/login',
        logoutUrl: '/api/auth/logout',
      },
    });
  });
}
