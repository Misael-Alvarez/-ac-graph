import { serverMode } from '@/server/env';
import { json } from '@/server/http';
import { observe } from '@/server/observability/request';

export const dynamic = 'force-dynamic';

/**
 * How the browser learns which mode this deployment runs in.
 *
 * Local mode: IndexedDB, no accounts. Server mode: PostgreSQL behind a login.
 * The answer depends only on environment variables, so it never touches the
 * database or the identity provider.
 */
export function GET(request: Request) {
  return observe(request, { route: '/api/config' }, () => {
    if (!serverMode()) return json({ mode: 'local' });
    return json({
      mode: 'server',
      auth: { loginUrl: '/api/auth/login', logoutUrl: '/api/auth/logout' },
    });
  });
}
