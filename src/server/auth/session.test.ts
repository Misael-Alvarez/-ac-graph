import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../http';
import {
  AUTH_STATE_COOKIE,
  REQUESTED_WITH_HEADER,
  REQUESTED_WITH_VALUE,
  SESSION_COOKIE,
  assertSameOrigin,
  authStateCookie,
  clearAuthStateCookie,
  clearSessionCookie,
  generateSessionId,
  hashSessionId,
  readCookie,
  sessionCookie,
  sessionCookieAttributes,
  toUser,
} from './session';

const https = { appUrl: 'https://graph.example.com', sessionTtlHours: 12 };
const http = { appUrl: 'http://localhost:3080', sessionTtlHours: 1 };

describe('session ids', () => {
  it('are 32 random bytes in base64url', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(id, 'base64url')).toHaveLength(32);
    expect(generateSessionId()).not.toBe(id);
  });

  it('are stored only as their SHA-256', () => {
    const id = generateSessionId();
    expect(hashSessionId(id)).toBe(createHash('sha256').update(id).digest('hex'));
    expect(hashSessionId(id)).toHaveLength(64);
    expect(hashSessionId(id)).not.toContain(id);
  });
});

describe('session cookie', () => {
  it('is HttpOnly, Lax, root path and bounded by the TTL', () => {
    expect(sessionCookieAttributes(https)).toEqual({
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      path: '/',
      maxAge: 12 * 3600,
    });
  });

  it('is Secure exactly when the app URL is https', () => {
    expect(sessionCookie('abc', https)).toContain('Secure');
    expect(sessionCookie('abc', http)).not.toContain('Secure');
  });

  it('serialises every attribute', () => {
    const header = sessionCookie('abc', https);
    expect(header.startsWith(`${SESSION_COOKIE}=abc; `)).toBe(true);
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=43200');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('HttpOnly');
  });

  it('clears with Max-Age=0 and an empty value', () => {
    const header = clearSessionCookie(https);
    expect(header.startsWith(`${SESSION_COOKIE}=; `)).toBe(true);
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('HttpOnly');
  });

  it('binds a login attempt with a ten-minute cookie', () => {
    const header = authStateCookie('st4te', http);
    expect(header.startsWith(`${AUTH_STATE_COOKIE}=st4te; `)).toBe(true);
    expect(header).toContain('Max-Age=600');
    expect(header).toContain('HttpOnly');
    expect(clearAuthStateCookie(http)).toContain('Max-Age=0');
  });
});

describe('readCookie', () => {
  const request = (cookie?: string) =>
    new Request('https://graph.example.com/api/auth/me', {
      headers: cookie === undefined ? {} : { cookie },
    });

  it('reads one cookie out of several', () => {
    expect(readCookie(request('a=1; acg_session=xyz; b=2'), SESSION_COOKIE)).toBe('xyz');
  });

  it('returns null when absent or empty', () => {
    expect(readCookie(request(), SESSION_COOKIE)).toBeNull();
    expect(readCookie(request('other=1'), SESSION_COOKIE)).toBeNull();
    expect(readCookie(request('acg_session='), SESSION_COOKIE)).toBeNull();
  });

  it('does not confuse a prefix with the name', () => {
    expect(readCookie(request('xacg_session=no; acg_session=yes'), SESSION_COOKIE)).toBe('yes');
  });
});

describe('toUser', () => {
  it('drops empty optional fields instead of sending nulls to the domain', () => {
    expect(toUser({ id: 'u', name: 'N', email: null, picture: null })).toEqual({
      id: 'u',
      name: 'N',
    });
    expect(toUser({ id: 'u', name: 'N', email: 'e@x', picture: 'p' })).toEqual({
      id: 'u',
      name: 'N',
      email: 'e@x',
      avatarUrl: 'p',
    });
  });
});

describe('assertSameOrigin', () => {
  const env = { appUrl: 'https://graph.example.com' } as const;
  const request = (headers: Record<string, string>) =>
    new Request('https://graph.example.com/api/diagrams', { method: 'POST', headers });

  const forbidden = (headers: Record<string, string>) => {
    try {
      assertSameOrigin(request(headers), env);
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(HttpError);
      expect((thrown as HttpError).status).toBe(403);
      expect((thrown as HttpError).code).toBe('forbidden');
      return true;
    }
    return false;
  };

  it('accepts the marker plus a matching Origin', () => {
    expect(() =>
      assertSameOrigin(
        request({ [REQUESTED_WITH_HEADER]: REQUESTED_WITH_VALUE, origin: env.appUrl }),
        env,
      ),
    ).not.toThrow();
  });

  it('falls back to the Referer when there is no Origin', () => {
    expect(() =>
      assertSameOrigin(
        request({
          [REQUESTED_WITH_HEADER]: REQUESTED_WITH_VALUE,
          referer: `${env.appUrl}/d/dgm_1`,
        }),
        env,
      ),
    ).not.toThrow();
  });

  it('rejects a missing or wrong marker', () => {
    expect(forbidden({ origin: env.appUrl })).toBe(true);
    expect(forbidden({ [REQUESTED_WITH_HEADER]: 'XMLHttpRequest', origin: env.appUrl })).toBe(true);
  });

  it('rejects a foreign Origin, a null Origin and no source at all', () => {
    const marker = { [REQUESTED_WITH_HEADER]: REQUESTED_WITH_VALUE };
    expect(forbidden({ ...marker, origin: 'https://evil.example' })).toBe(true);
    expect(forbidden({ ...marker, origin: 'null' })).toBe(true);
    expect(forbidden({ ...marker })).toBe(true);
    expect(forbidden({ ...marker, referer: 'https://graph.example.com.evil.example/' })).toBe(true);
  });

  it('compares origins, not prefixes', () => {
    const marker = { [REQUESTED_WITH_HEADER]: REQUESTED_WITH_VALUE };
    expect(forbidden({ ...marker, origin: 'https://graph.example.com:8443' })).toBe(true);
    expect(forbidden({ ...marker, origin: 'http://graph.example.com' })).toBe(true);
  });
});
