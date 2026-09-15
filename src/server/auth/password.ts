import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { User } from '@/lib/domain';
import { uid } from '@/lib/engine';
import { RateLimiter } from '@/lib/ai/rateLimit';
import { getPool } from '../db';
import { serverEnv, type ServerEnv } from '../env';
import { singleton } from '../globals';
import { HttpError } from '../http';
import { appMetrics } from '../observability/metrics';
import { log } from '../observability/log';
import { toUser, type UserRow } from './session';

/**
 * Accounts this server checks itself: an e-mail and a password.
 *
 * The password is never stored; scrypt of it is, with a salt of its own, so
 * two people with the same password share nothing and a leaked table is a
 * long way from a leaked password. Node's own scrypt, no dependency: the
 * parameters are OWASP's floor for it (N = 2^15, r = 8, p = 3 — about 32 MiB
 * and a few tens of milliseconds a hash) and travel inside the stored string,
 * so they can be raised later without touching what is already there.
 *
 * A local account is a `users` row with `issuer = 'local'` and its lower-cased
 * e-mail as `subject`: the `(issuer, subject)` key the table already has is
 * what keeps e-mails unique among them, and everything that reads a user by
 * id — sessions, diagrams, members — does not know or care how it signed in.
 */
export const LOCAL_ISSUER = 'local';

/** `promisify` drops the overload with options; spelled out instead. */
function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 3, keyLength: 64, saltBytes: 16 } as const;
/** scrypt needs 128 · N · r bytes; the default cap sits exactly on it. */
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
/** Long enough for any passphrase, short enough that nobody can make a hash slow. */
export const PASSWORD_MAX_LENGTH = 200;

/** `scrypt$N$r$p$<salt>$<hash>`, salt and hash in base64url. */
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, keyLength, saltBytes } = SCRYPT_PARAMS;
  const salt = randomBytes(saltBytes);
  const hash = await scrypt(password, salt, keyLength, { N, r, p, maxmem: SCRYPT_MAXMEM });
  return ['scrypt', N, r, p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

/**
 * Whether `password` is the one `stored` was made from. False, never a throw,
 * for a string that is not one of ours: a column with junk in it is a wrong
 * password, not a server error a caller might mistake for something else.
 */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (!salt.length || !expected.length) return false;
  try {
    const actual = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** What the sign-in form sends; the same rules for both of its faces. */
const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Not an e-mail address.');
const PasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const LoginBodySchema = z.object({ email: EmailSchema, password: PasswordSchema });
export const RegisterBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: EmailSchema,
  password: PasswordSchema,
});
export type LoginBody = z.infer<typeof LoginBodySchema>;
export type RegisterBody = z.infer<typeof RegisterBodySchema>;

/**
 * Attempts allowed before a caller has to wait. Per process, like the AI
 * limiter it reuses: enough to keep one address from guessing at speed, not a
 * lock-out anybody can inflict on somebody else — the per-e-mail bucket is
 * generous for that reason.
 */
export const LOGIN_LIMITS = { capacity: 10, refillPerMinute: 5 } as const;
export const SIGNUP_LIMITS = { capacity: 5, refillPerMinute: 2 } as const;

function limiter(key: 'loginLimiter' | 'signupLimiter'): RateLimiter {
  return singleton(
    key,
    () => new RateLimiter(key === 'loginLimiter' ? LOGIN_LIMITS : SIGNUP_LIMITS),
  );
}

/** Throws 429 when `key` has used up its attempts. */
export function takeAttempt(kind: 'login' | 'signup', key: string): void {
  const result = limiter(kind === 'login' ? 'loginLimiter' : 'signupLimiter').take(key);
  if (result.allowed) return;
  appMetrics().logins.inc({ result: 'rate_limited' });
  throw new HttpError(
    429,
    'rate_limited',
    'Too many attempts. Wait a moment and try again.',
    { retryAfter: result.retryAfter },
    { 'Retry-After': String(Math.max(1, result.retryAfter)) },
  );
}

/** The address a request came from, as well as a proxy tells us. */
export function callerAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'local';
}

const INVALID = () =>
  new HttpError(401, 'invalid_credentials', 'The e-mail or the password is not right.');

interface AccountRow extends UserRow {
  password_hash: string | null;
}

/**
 * The user for an e-mail and password, or a 401 that does not say which of
 * the two was wrong. An account that came through a provider has no password
 * here and fails the same way: the sign-in page must not reveal who exists.
 */
export async function authenticate(body: LoginBody, pool: Pool = getPool()): Promise<User> {
  const found = await pool.query<AccountRow>(
    `select id, name, email, picture, password_hash
       from users
      where issuer = $1 and subject = $2`,
    [LOCAL_ISSUER, body.email],
  );
  const row = found.rows[0];
  // The hash is checked even when there is no account, so "no such e-mail"
  // and "wrong password" take the same time to answer.
  const ok = await verifyPassword(row?.password_hash ?? (await decoy()), body.password);
  if (!row || !row.password_hash || !ok) throw INVALID();
  return toUser(row);
}

/** A hash of nothing in particular, made once, for the timing of a miss. */
function decoy(): Promise<string> {
  return singleton('passwordDecoy', () => hashPassword(randomBytes(12).toString('hex')));
}

/**
 * Creates a local account and returns its user. 403 when the server does not
 * let people sign themselves up, 409 when the e-mail already has an account —
 * said plainly here because the person is trying to create one, not to find
 * out whether it exists; the limiter is what keeps that from being a probe.
 */
export async function register(
  body: RegisterBody,
  pool: Pool = getPool(),
  env: Pick<ServerEnv, 'signupOpen'> = serverEnv(),
): Promise<User> {
  if (!env.signupOpen) {
    throw new HttpError(
      403,
      'signup_closed',
      'This server does not create accounts from the sign-in page. Ask whoever runs it.',
    );
  }
  return createLocalUser(body, pool);
}

/** The row for a new local account; used by `register` and by the users CLI. */
export async function createLocalUser(body: RegisterBody, pool: Pool = getPool()): Promise<User> {
  const passwordHash = await hashPassword(body.password);
  const inserted = await pool.query<UserRow>(
    `insert into users (id, issuer, subject, name, email, password_hash)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (issuer, subject) do nothing
     returning id, name, email, picture`,
    [uid('usr'), LOCAL_ISSUER, body.email, body.name, body.email, passwordHash],
  );
  const row = inserted.rows[0];
  if (!row)
    throw new HttpError(409, 'email_taken', 'There is an account with this e-mail already.');
  log().info('local account created', { userId: row.id });
  return toUser(row);
}

/** Replaces the password of a local account; false when there is none. */
export async function setPassword(
  email: string,
  password: string,
  pool: Pool = getPool(),
): Promise<boolean> {
  const parsed = LoginBodySchema.parse({ email, password });
  const passwordHash = await hashPassword(parsed.password);
  const updated = await pool.query(
    `update users set password_hash = $3, updated_at = now()
      where issuer = $1 and subject = $2`,
    [LOCAL_ISSUER, parsed.email, passwordHash],
  );
  return (updated.rowCount ?? 0) > 0;
}
