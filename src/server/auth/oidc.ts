import * as oidc from 'openid-client';
import type { Pool } from 'pg';
import type { User } from '@/lib/domain';
import { uid } from '@/lib/engine';
import { getPool } from '../db';
import { oidcEnv, type ServerEnv } from '../env';
import { resetSingleton, singleton } from '../globals';
import { HttpError } from '../http';
import { toUser, type UserRow } from './session';

/**
 * OpenID Connect login against Authentik (or any compliant provider).
 *
 * Authorization Code with PKCE, `state` and `nonce`. The per-attempt secrets
 * live in `auth_states` for ten minutes and are consumed exactly once, so a
 * callback can never be replayed. A user is identified by `(issuer, subject)`
 * and never by e-mail: e-mail addresses change hands, subjects do not.
 */
export const AUTH_STATE_TTL_MINUTES = 10;
export const OIDC_SCOPES = 'openid profile email';
export const CALLBACK_PATH = '/api/auth/callback';

/** The server settings with the provider present: what every function here needs. */
export type OidcEnv = ReturnType<typeof oidcEnv>;

const CONFIG_KEY = 'oidcConfig';

export function callbackUrl(env: Pick<ServerEnv, 'appUrl'>): string {
  return `${env.appUrl}${CALLBACK_PATH}`;
}

/**
 * Discovered provider configuration, once per process.
 *
 * Discovery happens on the first login, never at import. A failed discovery is
 * forgotten so a provider that was briefly down is retried on the next attempt.
 */
export function getOidcConfig(env: OidcEnv = oidcEnv()): Promise<oidc.Configuration> {
  return singleton(CONFIG_KEY, () =>
    discover(env).catch((error: unknown) => {
      resetSingleton(CONFIG_KEY);
      throw error;
    }),
  );
}

function discover(env: OidcEnv): Promise<oidc.Configuration> {
  const issuer = new URL(env.oidcIssuer);
  const metadata = env.oidcClientSecret ? { client_secret: env.oidcClientSecret } : undefined;
  const clientAuth = env.oidcClientSecret
    ? oidc.ClientSecretPost(env.oidcClientSecret)
    : oidc.None();
  return oidc.discovery(issuer, env.oidcClientId, metadata, clientAuth, {
    execute: [
      // Verify the ID token signature against the provider's JWKS as well, not
      // only the TLS channel it arrived on. Requires an asymmetric signing key.
      oidc.enableNonRepudiationChecks,
      // Plain-http issuers are only ever a developer's laptop; the library
      // refuses them unless told otherwise.
      ...(issuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : []),
    ],
  });
}

/** Forgets the discovered configuration. Tests only. */
export function resetOidcConfig(): void {
  resetSingleton(CONFIG_KEY);
}

/**
 * Only same-site relative paths may be used as a post-login destination. A
 * protocol-relative `//evil.example` or an absolute URL would turn the login
 * endpoint into an open redirect.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (/[\r\n]/.test(raw)) return '/';
  return raw;
}

export interface LoginStart {
  /** Where to send the browser. */
  authorizationUrl: URL;
  /** Handed back to the browser in a short-lived cookie to bind the callback. */
  state: string;
}

export async function beginLogin(
  nextPath: string,
  pool: Pool = getPool(),
  env: OidcEnv = oidcEnv(),
): Promise<LoginStart> {
  const config = await getOidcConfig(env);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  await pool.query('delete from auth_states where expires_at <= now()');
  await pool.query(
    `insert into auth_states (state, code_verifier, nonce, next_path, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
    [state, codeVerifier, nonce, safeNextPath(nextPath), AUTH_STATE_TTL_MINUTES],
  );

  const authorizationUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl(env),
    scope: OIDC_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return { authorizationUrl, state };
}

interface AuthStateRow {
  code_verifier: string;
  nonce: string;
  next_path: string;
}

export interface LoginResult {
  user: User;
  nextPath: string;
}

/**
 * Finishes the flow: validates state and nonce, redeems the code, upserts the
 * user. `callbackParams` are the query parameters the provider sent back;
 * `boundState` is the state the browser proved it started with (cookie).
 */
export async function completeLogin(
  callbackParams: URLSearchParams,
  boundState: string | null,
  pool: Pool = getPool(),
  env: OidcEnv = oidcEnv(),
): Promise<LoginResult> {
  const state = callbackParams.get('state');
  if (!state || !boundState || state !== boundState) {
    throw new HttpError(400, 'bad_request', 'The login state does not match this browser.');
  }

  const consumed = await pool.query<AuthStateRow>(
    `delete from auth_states where state = $1 and expires_at > now()
     returning code_verifier, nonce, next_path`,
    [state],
  );
  const attempt = consumed.rows[0];
  if (!attempt) {
    throw new HttpError(400, 'bad_request', 'The login attempt expired. Start again.');
  }

  const config = await getOidcConfig(env);
  // The redirect_uri sent to the token endpoint must be the public one the
  // browser was redirected to, not whatever host the container sees.
  const currentUrl = new URL(callbackUrl(env));
  currentUrl.search = callbackParams.toString();

  let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: attempt.code_verifier,
      expectedNonce: attempt.nonce,
      expectedState: state,
      idTokenExpected: true,
    });
  } catch {
    // Provider error details can carry the code; only a generic message goes out.
    throw new HttpError(400, 'bad_request', 'The provider rejected the login. Start again.');
  }

  const claims = tokens.claims();
  if (!claims?.sub || !claims.iss) {
    throw new HttpError(400, 'bad_request', 'The provider did not identify the user.');
  }

  const user = await upsertUser(pool, {
    issuer: claims.iss,
    subject: claims.sub,
    name: displayName(claims),
    email: optionalString(claims.email),
    picture: optionalString(claims.picture),
  });
  return { user, nextPath: safeNextPath(attempt.next_path) };
}

interface IdentityClaims {
  issuer: string;
  subject: string;
  name: string;
  email: string | null;
  picture: string | null;
}

async function upsertUser(pool: Pool, identity: IdentityClaims): Promise<User> {
  const result = await pool.query<UserRow>(
    `insert into users (id, issuer, subject, name, email, picture)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (issuer, subject) do update
       set name = excluded.name,
           email = excluded.email,
           picture = excluded.picture,
           updated_at = now()
     returning id, name, email, picture`,
    [
      uid('usr'),
      identity.issuer,
      identity.subject,
      identity.name,
      identity.email,
      identity.picture,
    ],
  );
  return toUser(result.rows[0]);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Something to show next to a cursor: name, then username, then e-mail, then subject. */
export function displayName(claims: {
  name?: unknown;
  preferred_username?: unknown;
  email?: unknown;
  sub: string;
}): string {
  return (
    optionalString(claims.name) ??
    optionalString(claims.preferred_username) ??
    optionalString(claims.email) ??
    claims.sub
  );
}

/** Where Authentik can end its own session too, if it says so. */
export async function endSessionUrl(env: OidcEnv = oidcEnv()): Promise<string | null> {
  try {
    const config = await getOidcConfig(env);
    if (!config.serverMetadata().end_session_endpoint) return null;
    return oidc.buildEndSessionUrl(config, { post_logout_redirect_uri: env.appUrl }).href;
  } catch {
    return null;
  }
}
