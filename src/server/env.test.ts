import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PG_POOL_MAX,
  DEFAULT_SESSION_TTL_HOURS,
  isSecureAppUrl,
  normalizeAppUrl,
  readServerEnv,
  serverEnv,
  serverMode,
} from './env';

const full = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  OIDC_ISSUER: 'https://auth.example.com/application/o/ac-graph/',
  OIDC_CLIENT_ID: 'client',
  APP_URL: 'https://graph.example.com/',
};

describe('server mode detection', () => {
  it('is off when any of the four variables is missing', () => {
    expect(serverMode({})).toBe(false);
    for (const key of Object.keys(full)) {
      const partial = { ...full, [key]: '' };
      expect(serverMode(partial)).toBe(false);
    }
  });

  it('is on when all four are present', () => {
    expect(serverMode(full)).toBe(true);
  });

  it('treats whitespace-only values as missing', () => {
    expect(serverMode({ ...full, OIDC_CLIENT_ID: '   ' })).toBe(false);
  });

  it('rejects an APP_URL that is not http(s)', () => {
    expect(serverMode({ ...full, APP_URL: 'ftp://x' })).toBe(false);
    expect(serverMode({ ...full, APP_URL: 'not a url' })).toBe(false);
  });
});

describe('readServerEnv', () => {
  it('applies defaults and normalises the app URL', () => {
    const env = readServerEnv(full)!;
    expect(env.appUrl).toBe('https://graph.example.com');
    expect(env.oidcClientSecret).toBeNull();
    expect(env.sessionTtlHours).toBe(DEFAULT_SESSION_TTL_HOURS);
    expect(env.pgPoolMax).toBe(DEFAULT_PG_POOL_MAX);
  });

  it('reads the optional settings', () => {
    const env = readServerEnv({
      ...full,
      OIDC_CLIENT_SECRET: 'shh',
      SESSION_TTL_HOURS: '48',
      PGPOOL_MAX: '4',
    })!;
    expect(env.oidcClientSecret).toBe('shh');
    expect(env.sessionTtlHours).toBe(48);
    expect(env.pgPoolMax).toBe(4);
  });

  it('falls back on nonsense numbers', () => {
    const env = readServerEnv({ ...full, SESSION_TTL_HOURS: 'soon', PGPOOL_MAX: '-3' })!;
    expect(env.sessionTtlHours).toBe(DEFAULT_SESSION_TTL_HOURS);
    expect(env.pgPoolMax).toBe(DEFAULT_PG_POOL_MAX);
  });

  it('throws from serverEnv when the mode is off', () => {
    expect(() => serverEnv({})).toThrow(/Server mode is off/);
  });
});

describe('normalizeAppUrl', () => {
  it('drops trailing slashes, query and hash', () => {
    expect(normalizeAppUrl('http://localhost:3080/?x=1#y')).toBe('http://localhost:3080');
    expect(normalizeAppUrl('https://a.example/app///')).toBe('https://a.example/app');
  });

  it('marks cookies Secure only over https', () => {
    expect(isSecureAppUrl({ appUrl: 'https://a.example' })).toBe(true);
    expect(isSecureAppUrl({ appUrl: 'http://localhost:3080' })).toBe(false);
  });
});
