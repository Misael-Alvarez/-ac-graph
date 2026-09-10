import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { User } from '@/lib/domain';
import { getPool } from '../db';
import { isSecureAppUrl, serverEnv, type ServerEnv } from '../env';
import { HttpError } from '../http';

/**
 * Cookie sessions.
 *
 * The browser holds an opaque 256-bit id; the database holds only its SHA-256,
 * so a leaked dump cannot be replayed as a cookie. Sessions expire on a fixed
 * TTL and are not refreshed — a bounded lifetime is simpler to reason about
 * than sliding expiry, and Authentik's own SSO session makes re-login cheap.
 */
export const SESSION_COOKIE = 'acg_session';

/** Only this origin may mutate; the header makes a cross-site form post impossible. */
export const REQUESTED_WITH_HEADER = 'x-requested-with';
export const REQUESTED_WITH_VALUE = 'ac-graph';

export interface UserRow {
  id: string;
  name: string;
  email: string | null;
  picture: string | null;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.picture ? { avatarUrl: row.picture } : {}),
  };
}

export function generateSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionId(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

export interface CookieAttributes {
  httpOnly: true;
  sameSite: 'Lax';
  secure: boolean;
  path: '/';
  maxAge: number;
}

/** The two settings cookies depend on; tests pass them directly. */
export type CookieEnv = Pick<ServerEnv, 'appUrl' | 'sessionTtlHours'>;

export function sessionCookieAttributes(env: CookieEnv): CookieAttributes {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureAppUrl(env),
    path: '/',
    maxAge: Math.round(env.sessionTtlHours * 3600),
  };
}

export function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  const parts = [
    `${name}=${value}`,
    `Path=${attributes.path}`,
    `Max-Age=${attributes.maxAge}`,
    `SameSite=${attributes.sameSite}`,
  ];
  if (attributes.httpOnly) parts.push('HttpOnly');
  if (attributes.secure) parts.push('Secure');
  return parts.join('; ');
}

/** The `Set-Cookie` value that installs a session in the browser. */
export function sessionCookie(id: string, env: CookieEnv = serverEnv()): string {
  return serializeCookie(SESSION_COOKIE, id, sessionCookieAttributes(env));
}

/** The `Set-Cookie` value that removes the session cookie. */
export function clearSessionCookie(env: CookieEnv = serverEnv()): string {
  return serializeCookie(SESSION_COOKIE, '', { ...sessionCookieAttributes(env), maxAge: 0 });
}

/**
 * Binds a login attempt to the browser that started it.
 *
 * The `state` lives in the database too, but a row alone would let an attacker
 * finish *their* login in a victim's browser (login CSRF). The callback must
 * present the same state in this cookie and in the query string.
 */
export const AUTH_STATE_COOKIE = 'acg_auth_state';
export const AUTH_STATE_COOKIE_MAX_AGE = 10 * 60;

export function authStateCookie(state: string, env: CookieEnv = serverEnv()): string {
  return serializeCookie(AUTH_STATE_COOKIE, state, {
    ...sessionCookieAttributes(env),
    maxAge: AUTH_STATE_COOKIE_MAX_AGE,
  });
}

export function clearAuthStateCookie(env: CookieEnv = serverEnv()): string {
  return serializeCookie(AUTH_STATE_COOKIE, '', { ...sessionCookieAttributes(env), maxAge: 0 });
}

/** Reads one cookie from a raw `Cookie` header; works on any `Request`. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value ? value : null;
  }
  return null;
}

export interface CreatedSession {
  /** The opaque id to put in the cookie. Never stored. */
  id: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  pool: Pool = getPool(),
  env: Pick<ServerEnv, 'sessionTtlHours'> = serverEnv(),
): Promise<CreatedSession> {
  const id = generateSessionId();
  const expiresAt = new Date(Date.now() + env.sessionTtlHours * 3600 * 1000);
  await pool.query('insert into sessions (id_hash, user_id, expires_at) values ($1, $2, $3)', [
    hashSessionId(id),
    userId,
    expiresAt,
  ]);
  // Every login sweeps what has expired, so the table never needs a cron job.
  await pool.query('delete from sessions where expires_at <= now()');
  return { id, expiresAt };
}

/** The user behind the request's session cookie, or null. */
export async function getSessionUser(
  request: Request,
  pool: Pool = getPool(),
): Promise<User | null> {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id) return null;
  const result = await pool.query<UserRow>(
    `select u.id, u.name, u.email, u.picture
       from sessions s
       join users u on u.id = s.user_id
      where s.id_hash = $1 and s.expires_at > now()`,
    [hashSessionId(id)],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

export async function requireUser(request: Request, pool: Pool = getPool()): Promise<User> {
  const user = await getSessionUser(request, pool);
  if (!user) throw new HttpError(401, 'unauthenticated', 'Sign in to use the server API.');
  return user;
}

/** Forgets the request's session; a missing or unknown cookie is not an error. */
export async function destroySession(request: Request, pool: Pool = getPool()): Promise<void> {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id) return;
  await pool.query('delete from sessions where id_hash = $1', [hashSessionId(id)]);
  // Piggy-back the sweep: expired rows are cheap to drop here and never pile up.
  await pool.query('delete from sessions where expires_at <= now()');
}

/**
 * CSRF guard for mutating requests.
 *
 * Two independent checks: the custom header cannot be set by a cross-site form
 * or a plain navigation, and the `Origin` (or, failing that, `Referer`) must be
 * the app itself. Either failing is a 403.
 */
export function assertSameOrigin(
  request: Request,
  env: Pick<ServerEnv, 'appUrl'> = serverEnv(),
): void {
  const requestedWith = request.headers.get(REQUESTED_WITH_HEADER);
  if (requestedWith !== REQUESTED_WITH_VALUE) {
    throw new HttpError(403, 'forbidden', 'Missing the same-origin request marker.');
  }
  const origin = request.headers.get('origin');
  const source = origin && origin !== 'null' ? origin : request.headers.get('referer');
  if (!source || !sameOrigin(source, env.appUrl)) {
    throw new HttpError(403, 'forbidden', 'Cross-origin requests are not allowed.');
  }
}

function sameOrigin(candidate: string, appUrl: string): boolean {
  try {
    return new URL(candidate).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
