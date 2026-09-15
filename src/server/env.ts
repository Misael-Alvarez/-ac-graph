/**
 * Server-mode configuration.
 *
 * The app is a browser-only tool until two variables are present together: a
 * database and the public URL the browser uses. With those, people sign in
 * with an e-mail and a password kept in that database; when an OIDC issuer
 * and client id are also set, the company's identity provider signs them in
 * instead. Everything under `src/server` reads its settings through here so a
 * missing or malformed value fails in one place, never deep inside a request.
 *
 * Nothing is read at import time; every call re-reads the environment so tests
 * can stub variables and the Next.js server can be configured at start-up.
 */

/** Who checks the password: this server, or an OpenID Connect provider. */
export type AuthProvider = 'local' | 'oidc';

export interface ServerEnv {
  databaseUrl: string;
  /** Origin the browser uses, without a trailing slash. */
  appUrl: string;
  authProvider: AuthProvider;
  /**
   * Whether the sign-in page offers to create an account. Local accounts
   * only: an OIDC deployment leaves who-may-join to the provider.
   */
  signupOpen: boolean;
  /** Set exactly when `authProvider` is `oidc`. */
  oidcIssuer: string | null;
  oidcClientId: string | null;
  /** Absent for a public client, which then relies on PKCE alone. */
  oidcClientSecret: string | null;
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
  const rawAppUrl = clean(source.APP_URL);
  if (!databaseUrl || !rawAppUrl) return null;

  const appUrl = normalizeAppUrl(rawAppUrl);
  if (!appUrl) return null;

  // Both or neither: an issuer without a client id cannot start a login, and
  // a half-configured provider must not silently fall back to passwords.
  const oidcIssuer = clean(source.OIDC_ISSUER);
  const oidcClientId = clean(source.OIDC_CLIENT_ID);
  if ((oidcIssuer === null) !== (oidcClientId === null)) return null;
  const oidc = oidcIssuer !== null && oidcClientId !== null;

  return {
    databaseUrl,
    appUrl,
    authProvider: oidc ? 'oidc' : 'local',
    signupOpen: !oidc && (clean(source.AUTH_SIGNUP)?.toLowerCase() ?? 'open') !== 'closed',
    oidcIssuer,
    oidcClientId,
    oidcClientSecret: oidc ? clean(source.OIDC_CLIENT_SECRET) : null,
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
      'Server mode is off: set DATABASE_URL and APP_URL together (and OIDC_ISSUER with OIDC_CLIENT_ID for single sign-on).',
    );
  }
  return env;
}

/** The OIDC settings, when that is the provider; throws otherwise. */
export function oidcEnv(source: EnvSource = process.env): ServerEnv & {
  oidcIssuer: string;
  oidcClientId: string;
} {
  const env = serverEnv(source);
  if (env.authProvider !== 'oidc' || !env.oidcIssuer || !env.oidcClientId) {
    throw new Error('Single sign-on is off: set OIDC_ISSUER and OIDC_CLIENT_ID together.');
  }
  return { ...env, oidcIssuer: env.oidcIssuer, oidcClientId: env.oidcClientId };
}

/** Cookies are marked Secure exactly when the browser reaches the app over https. */
export function isSecureAppUrl(env: Pick<ServerEnv, 'appUrl'>): boolean {
  return env.appUrl.startsWith('https://');
}

/**
 * Observability settings. Independent of server mode: a local-mode container
 * logs and exposes metrics exactly like a server-mode one.
 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFormat = 'json' | 'pretty';

export interface ObservabilityEnv {
  logLevel: LogLevel;
  /** One JSON object per line for collectors; `pretty` for a terminal. */
  logFormat: LogFormat;
  /** When set, `/api/metrics` demands `Authorization: Bearer <token>`. */
  metricsToken: string | null;
  /** Traces are exported only when a collector endpoint is configured. */
  otlpEndpoint: string | null;
  serviceName: string;
}

export const DEFAULT_SERVICE_NAME = 'ac-graph';

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

export function readObservabilityEnv(source: EnvSource = process.env): ObservabilityEnv {
  const level = clean(source.LOG_LEVEL)?.toLowerCase() ?? '';
  const format = clean(source.LOG_FORMAT)?.toLowerCase() ?? '';
  return {
    logLevel: isLogLevel(level) ? level : 'info',
    logFormat:
      format === 'json' || format === 'pretty'
        ? format
        : source.NODE_ENV === 'production'
          ? 'json'
          : 'pretty',
    metricsToken: clean(source.METRICS_TOKEN),
    otlpEndpoint: clean(source.OTEL_EXPORTER_OTLP_ENDPOINT),
    serviceName: clean(source.OTEL_SERVICE_NAME) ?? DEFAULT_SERVICE_NAME,
  };
}
