import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PG_POOL_MAX,
  DEFAULT_SERVICE_NAME,
  DEFAULT_SESSION_TTL_HOURS,
  isSecureAppUrl,
  normalizeAppUrl,
  oidcEnv,
  readObservabilityEnv,
  readServerEnv,
  serverEnv,
  serverMode,
} from './env';

/** The two that turn server mode on: accounts with a password kept here. */
const local = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  APP_URL: 'https://graph.example.com/',
};

/** The same, signing people in through a provider. */
const full = {
  ...local,
  OIDC_ISSUER: 'https://auth.example.com/application/o/ac-graph/',
  OIDC_CLIENT_ID: 'client',
};

describe('server mode detection', () => {
  it('is off when the database or the public URL is missing', () => {
    expect(serverMode({})).toBe(false);
    for (const key of Object.keys(local)) {
      expect(serverMode({ ...local, [key]: '' })).toBe(false);
      expect(serverMode({ ...full, [key]: '' })).toBe(false);
    }
  });

  it('is on with the database and the URL alone, signing in with passwords', () => {
    expect(serverMode(local)).toBe(true);
    const env = readServerEnv(local)!;
    expect(env.authProvider).toBe('local');
    expect(env.oidcIssuer).toBeNull();
    expect(env.oidcClientId).toBeNull();
    expect(env.oidcClientSecret).toBeNull();
  });

  it('signs in through the provider when the issuer and client id are both set', () => {
    const env = readServerEnv(full)!;
    expect(env.authProvider).toBe('oidc');
    expect(env.oidcIssuer).toBe(full.OIDC_ISSUER);
    expect(env.oidcClientId).toBe('client');
    // A client secret means nothing without a provider to give it to.
    expect(readServerEnv({ ...local, OIDC_CLIENT_SECRET: 'shh' })!.oidcClientSecret).toBeNull();
  });

  it('refuses half a provider rather than falling back to passwords', () => {
    expect(serverMode({ ...local, OIDC_ISSUER: full.OIDC_ISSUER })).toBe(false);
    expect(serverMode({ ...local, OIDC_CLIENT_ID: 'client' })).toBe(false);
    expect(() => oidcEnv(local)).toThrow(/Single sign-on is off/);
    expect(oidcEnv(full).oidcClientId).toBe('client');
  });

  it('lets the sign-in page create accounts unless told not to, and never with a provider', () => {
    expect(readServerEnv(local)!.signupOpen).toBe(true);
    expect(readServerEnv({ ...local, AUTH_SIGNUP: 'open' })!.signupOpen).toBe(true);
    expect(readServerEnv({ ...local, AUTH_SIGNUP: 'Closed' })!.signupOpen).toBe(false);
    expect(readServerEnv(full)!.signupOpen).toBe(false);
  });

  it('treats whitespace-only values as missing', () => {
    expect(serverMode({ ...local, DATABASE_URL: '   ' })).toBe(false);
    expect(readServerEnv({ ...full, OIDC_CLIENT_SECRET: '  ' })!.oidcClientSecret).toBeNull();
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

describe('readObservabilityEnv', () => {
  it('defaults to info, JSON in production, pretty elsewhere, no token, no traces', () => {
    expect(readObservabilityEnv({ NODE_ENV: 'production' })).toEqual({
      logLevel: 'info',
      logFormat: 'json',
      metricsToken: null,
      otlpEndpoint: null,
      serviceName: DEFAULT_SERVICE_NAME,
    });
    expect(readObservabilityEnv({ NODE_ENV: 'development' }).logFormat).toBe('pretty');
    expect(readObservabilityEnv({}).logFormat).toBe('pretty');
  });

  it('reads every setting, case-insensitively for the enumerations', () => {
    expect(
      readObservabilityEnv({
        LOG_LEVEL: 'DEBUG',
        LOG_FORMAT: 'Json',
        METRICS_TOKEN: ' scrape ',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        OTEL_SERVICE_NAME: 'graph-eu',
      }),
    ).toEqual({
      logLevel: 'debug',
      logFormat: 'json',
      metricsToken: 'scrape',
      otlpEndpoint: 'http://collector:4318',
      serviceName: 'graph-eu',
    });
  });

  it('falls back on unknown levels and formats and treats blanks as unset', () => {
    const env = readObservabilityEnv({
      LOG_LEVEL: 'loud',
      LOG_FORMAT: 'xml',
      METRICS_TOKEN: '   ',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
      NODE_ENV: 'production',
    });
    expect(env.logLevel).toBe('info');
    expect(env.logFormat).toBe('json');
    expect(env.metricsToken).toBeNull();
    expect(env.otlpEndpoint).toBeNull();
  });

  it('is independent of server mode', () => {
    expect(readObservabilityEnv({ LOG_LEVEL: 'warn' }).logLevel).toBe('warn');
    expect(serverMode({ LOG_LEVEL: 'warn' })).toBe(false);
  });
});
