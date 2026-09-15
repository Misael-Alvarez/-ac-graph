import { createHash } from 'node:crypto';
import type { User } from '@/lib/domain';
import { SESSION_COOKIE, assertSameOrigin, readCookie, requireUser } from './auth/session';
import { PgDiagramRepository } from './diagrams/repository';
import { PgIconLibrary } from './icons/repository';
import { serverEnv, serverMode, type AuthProvider } from './env';
import { HttpError, errorResponse, serverModeOff } from './http';
import { annotateRequest } from './observability/context';
import { observe } from './observability/request';
import { ensureSchema } from './schema';

/**
 * The common prologue of every server-mode route.
 *
 * Order matters: the request is observed first (id, metrics, access line), then
 * mode (local deployments answer 404 without touching a database), then the
 * CSRF check for mutating methods (cheap, no I/O), then the schema, then the
 * session. Anything thrown afterwards becomes a typed JSON error through
 * `errorResponse`.
 */
export interface ServerContext {
  user: User;
  repository: PgDiagramRepository;
  /** The workspace's icon library, acting as this user. */
  icons: PgIconLibrary;
  /** Opaque per-browser-session key for presence. Not reversible to the cookie. */
  sessionKey: string;
}

export interface GuardOptions {
  /** The route template; the only route name metrics and logs ever see. */
  route: string;
  /** Require the same-origin marker and Origin/Referer check. */
  mutating?: boolean;
}

/**
 * For the auth routes: the face of the login this route belongs to. A route
 * for the other face is 404 before the database is touched, so a deployment
 * with passwords has no provider redirect and one with a provider takes no
 * password — and neither can be told apart from a missing route.
 */
export interface AuthGuardOptions extends GuardOptions {
  provider?: AuthProvider;
}

/** Whether the request body is read at all: only under the right face. */
function assertProvider(provider: AuthProvider | undefined): void {
  if (provider && serverEnv().authProvider !== provider) {
    throw new HttpError(
      404,
      'not_found',
      provider === 'oidc'
        ? 'This server signs people in with a password, not through a provider.'
        : 'This server signs people in through its identity provider.',
    );
  }
}

export async function withUser(
  request: Request,
  options: GuardOptions,
  handler: (context: ServerContext) => Promise<Response>,
): Promise<Response> {
  return observe(request, { route: options.route }, async () => {
    if (!serverMode()) return serverModeOff();
    try {
      if (options.mutating) assertSameOrigin(request);
      // No cookie, no session: answer without waking the database.
      if (!readCookie(request, SESSION_COOKIE)) {
        throw new HttpError(401, 'unauthenticated', 'Sign in to use the server API.');
      }
      await ensureSchema();
      const user = await requireUser(request);
      const sessionKey = sessionKeyOf(request);
      annotateRequest({ userId: user.id, sessionKey });
      return await handler({
        user,
        repository: new PgDiagramRepository(user),
        icons: new PgIconLibrary(user),
        sessionKey,
      });
    } catch (thrown) {
      return errorResponse(thrown);
    }
  });
}

/** For the auth routes, which run before there is a user. */
export async function withServerMode(
  request: Request,
  options: AuthGuardOptions,
  handler: () => Promise<Response>,
): Promise<Response> {
  return observe(request, { route: options.route }, async () => {
    if (!serverMode()) return serverModeOff();
    try {
      if (options.mutating) assertSameOrigin(request);
      assertProvider(options.provider);
      await ensureSchema();
      return await handler();
    } catch (thrown) {
      return errorResponse(thrown);
    }
  });
}

/**
 * A short one-way digest of the session cookie. Two tabs of one browser share
 * it, two browsers of one person do not, and nobody can turn it back into the
 * cookie. Falls back to a constant when there is no cookie, which only happens
 * for requests that fail authentication anyway.
 */
export function sessionKeyOf(request: Request): string {
  const cookie = readCookie(request, SESSION_COOKIE) ?? '';
  return createHash('sha256').update(`presence:${cookie}`).digest('hex').slice(0, 16);
}
