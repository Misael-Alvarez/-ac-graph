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

interface AuthContextValue {
  user: User;
  state: AuthState;
  /** Local mode only: changes the display name. */
  rename: (name: string) => void;
  /** Server mode: where to go to sign in, with a return path. */
  loginUrl: (next?: string) => string;
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

/**
 * Who is using the app.
 *
 * In local mode that is a name kept in localStorage. In server mode it is
 * whoever Authentik says it is, read from `/api/auth/me`; the session cookie is
 * HttpOnly, so this component never sees a token — it only sees a user or a 401.
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
    return { user, state, rename, loginUrl, signOut };
  }, [ready, config.mode, remote, localUser, rename, loginUrl, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
