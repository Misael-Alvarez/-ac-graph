import { callerAddress, register, RegisterBodySchema, takeAttempt } from '@/server/auth/password';
import { createSession, sessionCookie } from '@/server/auth/session';
import { withServerMode } from '@/server/handler';
import { json } from '@/server/http';
import { parseBody } from '@/server/diagrams/routes';
import { annotateRequest } from '@/server/observability/context';
import { appMetrics } from '@/server/observability/metrics';

export const dynamic = 'force-dynamic';

/**
 * Creates a local account and signs it in, in one step: nobody should have to
 * type a password twice in a row. 403 `signup_closed` when the operator has
 * turned this off, 409 `email_taken` when the e-mail already has an account,
 * 404 when the server signs people in through a provider instead.
 */
export function POST(request: Request) {
  return withServerMode(
    request,
    { route: '/api/auth/register', mutating: true, provider: 'local' },
    async () => {
      const body = await parseBody(request, RegisterBodySchema);
      takeAttempt('signup', `ip:${callerAddress(request)}`);
      const user = await register(body);
      annotateRequest({ userId: user.id });
      const session = await createSession(user.id);
      appMetrics().logins.inc({ result: 'ok' });
      return json({ user }, { status: 201, headers: { 'Set-Cookie': sessionCookie(session.id) } });
    },
  );
}
