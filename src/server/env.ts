/**
 * Server-mode configuration.
 *
 * The app is a browser-only tool until four variables are present together:
 * a database, an OIDC issuer, a client id and the public URL the browser uses.
 * Everything under `src/server` reads its settings through here so a missing
 * or malformed value fails in one place, never deep inside a request.
 *
 * Nothing is read at import time; every call re-reads the environment so tests
 * can stub variables and the Next.js server can be configured at start-up.
 */

export interface ServerEnv {
  databaseUrl: string;
  oidcIssuer: string;
  oidcClientId: string;
  /** Absent for a public client, which then relies on PKCE alone. */
  oidcClientSecret: string | null;
  /** Origin the browser uses, without a trailing slash. */
  appUrl: string;
  sessionTtlHours: number;
  pgPoolMax: number;
}

export const DEFAULT_SESSION_TTL_HOURS = 12;
export const DEFAULT_PG_POOL_MAX = 10;

type EnvSource = Record<string, string | undefined>;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Normalises the public URL: absolute http(s), no trailing slash, no query or hash. */
export function normalizeAppUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/+$/, '');
}

/** The configuration, or null when the deployment is not in server mode. */
export function readServerEnv(source: EnvSource = process.env): ServerEnv | null {
  const databaseUrl = clean(source.DATABASE_URL);
  const oidcIssuer = clean(source.OIDC_ISSUER);
  const oidcClientId = clean(source.OIDC_CLIENT_ID);
  const rawAppUrl = clean(source.APP_URL);
  if (!databaseUrl || !oidcIssuer || !oidcClientId || !rawAppUrl) return null;

  const appUrl = normalizeAppUrl(rawAppUrl);
  if (!appUrl) return null;

  return {
    databaseUrl,
    oidcIssuer,
    oidcClientId,
    oidcClientSecret: clean(source.OIDC_CLIENT_SECRET),
    appUrl,
    sessionTtlHours: positiveNumber(source.SESSION_TTL_HOURS, DEFAULT_SESSION_TTL_HOURS),
    pgPoolMax: Math.floor(positiveNumber(source.PGPOOL_MAX, DEFAULT_PG_POOL_MAX)),
  };
}

export function serverMode(source: EnvSource = process.env): boolean {
  return readServerEnv(source) !== null;
}

/** The configuration when server mode is on; throws otherwise. */
export function serverEnv(source: EnvSource = process.env): ServerEnv {
  const env = readServerEnv(source);
  if (!env) {
    throw new Error(
      'Server mode is off: set DATABASE_URL, OIDC_ISSUER, OIDC_CLIENT_ID and APP_URL together.',
    );
  }
  return env;
}

/** Cookies are marked Secure exactly when the browser reaches the app over https. */
export function isSecureAppUrl(env: Pick<ServerEnv, 'appUrl'>): boolean {
  return env.appUrl.startsWith('https://');
}
