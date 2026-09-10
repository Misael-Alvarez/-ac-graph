'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LOCAL_CONFIG, fetchAppConfig, type AppConfig } from '@/lib/appConfig';

interface AppConfigContextValue {
  config: AppConfig;
  /** False until the server has answered (or failed to). */
  ready: boolean;
}

const AppConfigContext = createContext<AppConfigContextValue>({
  config: LOCAL_CONFIG,
  ready: false,
});

export function useAppConfig(): AppConfigContextValue {
  return useContext(AppConfigContext);
}

/**
 * Asks the server once which kind of deployment this is.
 *
 * Everything that differs between the browser-only editor and the shared
 * workspace — which repository to use, whether to demand a sign-in, whether to
 * open the live channel — reads this and nothing else.
 */
export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppConfigContextValue>({
    config: LOCAL_CONFIG,
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;
    void fetchAppConfig().then((config) => {
      if (!cancelled) setState({ config, ready: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <AppConfigContext.Provider value={state}>{children}</AppConfigContext.Provider>;
}
