import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as me } from '@/app/api/auth/me/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as register } from '@/app/api/auth/register/route';
import { GET as listDiagrams } from '@/app/api/diagrams/route';
import { closePool } from '../db';
import { resetSingleton } from '../globals';
import { appMetrics } from '../observability/metrics';
import { captureLogs } from '../testing/logs';
import {
  dropSchema,
  insertUser,
  pgAvailable,
  resetServerSingletons,
  testEnv,
  testPool,
} from '../testing/pg';
import { createLocalUser, LOCAL_ISSUER, setPassword, SIGNUP_LIMITS } from './password';
import { hashSessionId } from './session';

/**
 * The password login end to end: an account created from the sign-in page,
 * signed in, refused, throttled, signed out — against a real database, with
 * the same guards every write goes through.
 */
const SCHEMA = 't_password';
const ENV = pgAvailable() ? testEnv(SCHEMA, 'local') : null;
const ORIGIN = 'https://graph.example.com';

interface CallOptions {
  body?: unknown;
  cookie?: string | null;
  headers?: Record<string, string>;
}

function post(path: string, options: CallOptions = {}): NextRequest {
  const headers = new Headers({
    'x-requested-with': 'ac-graph',
    origin: ORIGIN,
    'content-type': 'application/json',
    ...options.headers,
  });
  if (options.cookie) headers.set('cookie', `acg_session=${options.cookie}`);
  const req = new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }) as Request & { nextUrl: URL };
  req.nextUrl = new URL(req.url);
  return req as unknown as NextRequest;
}

function get(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set('cookie', `acg_session=${cookie}`);
  const req = new Request(`${ORIGIN}${path}`, { headers }) as Request & { nextUrl: URL };
  req.nextUrl = new URL(req.url);
  return req as unknown as NextRequest;
}

/** The session id a Set-Cookie header installs. */
function cookieOf(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  const match = header.match(/acg_session=([^;]*)/);
  if (!match) throw new Error(`no session cookie in ${header}`);
  return match[1];
}

const ADA = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'poetical science 1843' };

describe.skipIf(!pgAvailable())('password login (PostgreSQL)', () => {
  let pool: Pool;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(ENV!)) vi.stubEnv(key, value);
    resetServerSingletons();
    pool = await testPool(SCHEMA);
    await dropSchema(pool);
    // First guarded call runs the migrations through ensureSchema().
    expect((await me(get('/api/auth/me', 'unknown'))).status).toBe(401);
  });

  beforeEach(async () => {
    await pool.query('delete from sessions');
    await pool.query('delete from users');
    vi.stubEnv('AUTH_SIGNUP', 'open');
    for (const key of ['loginLimiter', 'signupLimiter']) resetSingleton(key);
  });

  afterAll(async () => {
    await closePool();
    await dropSchema(pool);
    await pool.end();
    vi.unstubAllEnvs();
  });

  it('creates an account from the sign-in page and signs it in at once', async () => {
    const response = await register(post('/api/auth/register', { body: ADA }));
    expect(response.status).toBe(201);
    const { user } = await response.json();
    expect(user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(user.id).toMatch(/^usr_/);
    const cookie = cookieOf(response);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');

    // The cookie works for the rest of the API, and only its hash is stored.
    const who = await me(get('/api/auth/me', cookie));
    expect(who.status).toBe(200);
    expect((await who.json()).user.id).toBe(user.id);
    const stored = await pool.query('select id_hash from sessions');
    expect(stored.rows.map((r) => r.id_hash)).toEqual([hashSessionId(cookie)]);

    // The row: a local issuer, the e-mail as subject, a hash and never the password.
    const row = (
      await pool.query('select issuer, subject, email, password_hash from users where id = $1', [
        user.id,
      ])
    ).rows[0];
    expect(row).toMatchObject({ issuer: LOCAL_ISSUER, subject: 'ada@example.com' });
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_hash).not.toContain(ADA.password);
  });

  it('signs in with the right password and refuses the wrong one without saying which', async () => {
    await register(post('/api/auth/register', { body: ADA }));
    await pool.query('delete from sessions');

    const ok = await login(
      post('/api/auth/login', { body: { email: ' ADA@example.com ', password: ADA.password } }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).user.email).toBe('ada@example.com');
    expect((await me(get('/api/auth/me', cookieOf(ok)))).status).toBe(200);

    const wrong = await login(
      post('/api/auth/login', { body: { email: ADA.email, password: 'poetical science 1844' } }),
    );
    const nobody = await login(
      post('/api/auth/login', { body: { email: 'nobody@example.com', password: ADA.password } }),
    );
    for (const response of [wrong, nobody]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        code: 'invalid_credentials',
        message: 'The e-mail or the password is not right.',
      });
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect((await pool.query('select count(*)::int as n from sessions')).rows[0].n).toBe(1);
  });

  it('gives an account that came through a provider no password to sign in with', async () => {
    const grace = await insertUser(pool, 'Grace');
    const response = await login(
      post('/api/auth/login', { body: { email: grace.email!, password: 'anything at all' } }),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('invalid_credentials');
  });

  it('refuses a second account on the same e-mail, whatever its case', async () => {
    await register(post('/api/auth/register', { body: ADA }));
    const again = await register(
      post('/api/auth/register', { body: { ...ADA, email: 'Ada@Example.COM', name: 'Other' } }),
    );
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('email_taken');
    expect((await pool.query('select count(*)::int as n from users')).rows[0].n).toBe(1);
  });

  it('does not create accounts when the operator closed sign-up', async () => {
    vi.stubEnv('AUTH_SIGNUP', 'closed');
    const response = await register(post('/api/auth/register', { body: ADA }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('signup_closed');
    expect((await pool.query('select count(*)::int as n from users')).rows[0].n).toBe(0);

    // The CLI's path is what still works: an account made by hand signs in.
    await createLocalUser(ADA, pool);
    const ok = await login(post('/api/auth/login', { body: ADA }));
    expect(ok.status).toBe(200);
  });

  it('checks the body before the password: a malformed one is 400 with its issues', async () => {
    const response = await login(
      post('/api/auth/login', { body: { email: 'not-an-email', password: 'short' } }),
    );
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe('bad_request');
    expect(payload.issues.map((i: { path: string[] }) => i.path[0]).sort()).toEqual([
      'email',
      'password',
    ]);
    const noName = await register(
      post('/api/auth/register', { body: { email: ADA.email, password: ADA.password } }),
    );
    expect(noName.status).toBe(400);
  });

  // Every refused attempt still costs a real scrypt, on purpose; thirty of
  // them take longer than the default budget.
  it(
    'throttles a guesser by address and by e-mail, and says when to come back',
    { timeout: 40_000 },
    async () => {
      await register(post('/api/auth/register', { body: ADA }));
      const attempt = (email: string, ip: string) =>
        login(
          post('/api/auth/login', {
            body: { email, password: 'not it, not it' },
            headers: { 'x-forwarded-for': ip },
          }),
        );
      // Ten from one address, then the eleventh waits.
      for (let i = 0; i < 10; i++)
        expect((await attempt(`u${i}@example.com`, '10.0.0.1')).status).toBe(401);
      const limited = await attempt('u10@example.com', '10.0.0.1');
      expect(limited.status).toBe(429);
      expect((await limited.json()).code).toBe('rate_limited');
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      // Another address is fine — until it hammers one e-mail.
      for (let i = 0; i < 10; i++)
        expect((await attempt(ADA.email, `10.0.1.${i}`)).status).toBe(401);
      expect((await attempt(ADA.email, '10.0.2.1')).status).toBe(429);
      // Sign-up has its own, smaller bucket.
      resetSingleton('loginLimiter');
      for (let i = 0; i < SIGNUP_LIMITS.capacity; i++) {
        await register(
          post('/api/auth/register', {
            body: { ...ADA, email: `p${i}@example.com` },
            headers: { 'x-forwarded-for': '10.0.3.1' },
          }),
        );
      }
      const tooMany = await register(
        post('/api/auth/register', {
          body: { ...ADA, email: 'late@example.com' },
          headers: { 'x-forwarded-for': '10.0.3.1' },
        }),
      );
      expect(tooMany.status).toBe(429);
    },
  );

  it('signs out with a 204 and a cleared cookie, and the session is gone', async () => {
    const cookie = cookieOf(await register(post('/api/auth/register', { body: ADA })));
    const response = await logout(post('/api/auth/logout', { cookie }));
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('acg_session=;');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await me(get('/api/auth/me', cookie))).status).toBe(401);
    expect((await listDiagrams(get('/api/diagrams', cookie))).status).toBe(401);
  });

  it('lets the CLI replace a password, and only for an account that exists', async () => {
    await register(post('/api/auth/register', { body: ADA }));
    expect(await setPassword(ADA.email, 'a brand new passphrase', pool)).toBe(true);
    expect(await setPassword('nobody@example.com', 'a brand new passphrase', pool)).toBe(false);
    expect((await login(post('/api/auth/login', { body: ADA }))).status).toBe(401);
    expect(
      (
        await login(
          post('/api/auth/login', {
            body: { email: ADA.email, password: 'a brand new passphrase' },
          }),
        )
      ).status,
    ).toBe(200);
  });

  it('counts outcomes and logs without the e-mail or the password', async () => {
    const logs = captureLogs();
    try {
      const before = appMetrics().logins.get({ result: 'rejected' });
      await register(post('/api/auth/register', { body: ADA }));
      await login(
        post('/api/auth/login', { body: { email: ADA.email, password: 'wrong wrong wrong' } }),
      );
      expect(appMetrics().logins.get({ result: 'rejected' })).toBe(before + 1);
      const text = JSON.stringify(logs.records);
      expect(text).toContain('local account created');
      expect(text).toContain('password rejected');
      expect(text).not.toContain(ADA.password);
      expect(text).not.toContain('wrong wrong wrong');
      expect(text).not.toContain(ADA.email);
    } finally {
      logs.restore();
    }
  });
});
