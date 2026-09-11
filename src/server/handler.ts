import { createHash } from 'node:crypto';
import type { User } from '@/lib/domain';
import { SESSION_COOKIE, assertSameOrigin, readCookie, requireUser } from './auth/session';
import { PgDiagramRepository } from './diagrams/repository';
import { PgIconLibrary } from './icons/repository';
import { serverMode } from './env';
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
  options: GuardOptions,
  handler: () => Promise<Response>,
): Promise<Response> {
  return observe(request, { route: options.route }, async () => {
    if (!serverMode()) return serverModeOff();
    try {
      if (options.mutating) assertSameOrigin(request);
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
