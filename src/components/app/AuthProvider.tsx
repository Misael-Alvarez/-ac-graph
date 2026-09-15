'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@/lib/domain';
import { LOCAL_USER, LOCAL_USER_KEY, readUser, writeUser } from '@/lib/auth/user';
import { notifyStoreChanged, useStoredValue } from '@/lib/browserStore';
import { useAppConfig } from './AppConfigProvider';

export type AuthState =
  /** Still finding out. */
  | 'loading'
  /** Browser-only deployment: a local profile, no accounts. */
  | 'local'
  /** Server mode with a valid session. */
  | 'authenticated'
  /** Server mode, no session: the sign-in page is the only way forward. */
  | 'anonymous';

/** What the sign-in form is told when the server says no. */
export type SignInFailure =
  | 'invalid_credentials'
  | 'email_taken'
  | 'signup_closed'
  | 'rate_limited'
  | 'bad_request'
  | 'forbidden'
  | 'unavailable';

export type SignInResult = { ok: true } | { ok: false; error: SignInFailure; retryAfter?: number };

interface AuthContextValue {
  user: User;
  state: AuthState;
  /** Local mode only: changes the display name. */
  rename: (name: string) => void;
  /** Server mode with a provider: where to go to sign in, with a return path. */
  loginUrl: (next?: string) => string;
  /** Server mode with local accounts: signs in with an e-mail and a password. */
  signIn: (email: string, password: string) => Promise<SignInResult>;
  /** Server mode with local accounts: creates an account and signs it in. */
  register: (name: string, email: string, password: string) => Promise<SignInResult>;
  /** Server mode: ends the session here and, when possible, at the provider. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useUser(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useUser must be used inside <AuthProvider>');
  return context;
}

const REQUESTED_WITH = { 'x-requested-with': 'ac-graph' };

const FAILURES: ReadonlySet<string> = new Set([
  'invalid_credentials',
  'email_taken',
  'signup_closed',
  'rate_limited',
  'bad_request',
  'forbidden',
]);

/**
 * Who is using the app.
 *
 * In local mode that is a name kept in localStorage. In server mode it is
 * whoever the session belongs to, read from `/api/auth/me` — an account with a
 * password kept on the server, or whoever the identity provider said. The
 * session cookie is HttpOnly, so this component never sees a token: it only
 * sees a user or a 401.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { config, ready } = useAppConfig();
  const localUser = useStoredValue<User>(
    LOCAL_USER_KEY,
    (raw) => readUser({ getItem: () => raw }),
    LOCAL_USER,
  );
  const [remote, setRemote] = useState<{ user: User | null; resolved: boolean }>({
    user: null,
    resolved: false,
  });

  useEffect(() => {
    if (!ready || config.mode !== 'server') return;
    let cancelled = false;
    void fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = (await response.json()) as { user?: User };
        return body.user ?? null;
      })
      .catch(() => null)
      .then((user) => {
        if (!cancelled) setRemote({ user, resolved: true });
      });
    return () => {
      cancelled = true;
    };
  }, [ready, config.mode]);

  const rename = useCallback(
    (name: string) => {
      if (config.mode === 'server') return;
      writeUser(window.localStorage, { ...localUser, name });
      notifyStoreChanged();
    },
    [config.mode, localUser],
  );

  const loginUrl = useCallback(
    (next?: string) => {
      const base = config.auth?.loginUrl ?? '/api/auth/login';
      const target = next ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
      return `${base}?next=${encodeURIComponent(target)}`;
    },
    [config.auth],
  );

  /**
   * One round trip for both faces of the form. A success carries the user in
   * the body, so the app is signed in on the spot without asking `/me` again;
   * a failure is one of the codes the form knows how to word.
   */
  const submit = useCallback(async (url: string, body: unknown): Promise<SignInResult> => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...REQUESTED_WITH, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        user?: User;
        code?: string;
        retryAfter?: number;
      };
      if (response.ok && payload.user) {
        setRemote({ user: payload.user, resolved: true });
        return { ok: true };
      }
      const error = payload.code && FAILURES.has(payload.code) ? payload.code : 'unavailable';
      return { ok: false, error: error as SignInFailure, retryAfter: payload.retryAfter };
    } catch {
      return { ok: false, error: 'unavailable' };
    }
  }, []);

  const signIn = useCallback(
    (email: string, password: string) =>
      submit(config.auth?.loginUrl ?? '/api/auth/login', { email, password }),
    [config.auth, submit],
  );

  const register = useCallback(
    (name: string, email: string, password: string) =>
      submit('/api/auth/register', { name, email, password }),
    [submit],
  );

  const signOut = useCallback(async () => {
    const url = config.auth?.logoutUrl ?? '/api/auth/logout';
    let endSession: string | null = null;
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: REQUESTED_WITH,
      });
      if (response.status === 200) {
        const body = (await response.json()) as { endSessionUrl?: string };
        endSession = body.endSessionUrl ?? null;
      }
    } catch {
      // The cookie may already be gone; landing on the sign-in page is still right.
    }
    window.location.assign(endSession ?? '/');
  }, [config.auth]);

  const value = useMemo<AuthContextValue>(() => {
    let state: AuthState = 'loading';
    let user: User = localUser;
    if (ready && config.mode === 'local') state = 'local';
    else if (ready && remote.resolved) {
      if (remote.user) {
        state = 'authenticated';
        user = remote.user;
      } else {
        state = 'anonymous';
      }
    }
    return { user, state, rename, loginUrl, signIn, register, signOut };
  }, [ready, config.mode, remote, localUser, rename, loginUrl, signIn, register, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
