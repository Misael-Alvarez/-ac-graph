'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LocalDiagramRepository, type DiagramRepository } from '@/lib/store';
import { HttpDiagramRepository } from '@/lib/store/httpRepository';
import { useAppConfig } from './AppConfigProvider';

interface RepositoryContextValue {
  repository: DiagramRepository;
  /** False until the store is usable: config known, legacy import run. */
  ready: boolean;
  /** Where the diagrams live. */
  mode: 'local' | 'server';
}

const RepositoryContext = createContext<RepositoryContextValue | null>(null);

export function useRepository(): DiagramRepository {
  const context = useContext(RepositoryContext);
  if (!context) throw new Error('useRepository must be used inside <RepositoryProvider>');
  return context.repository;
}

export function useRepositoryReady(): boolean {
  return useContext(RepositoryContext)?.ready ?? false;
}

export function useRepositoryMode(): 'local' | 'server' {
  return useContext(RepositoryContext)?.mode ?? 'local';
}

/**
 * Provides the single I/O boundary of the app.
 *
 * The concrete implementation is chosen here and nowhere else: IndexedDB for
 * the browser-only editor, the HTTP client for the shared workspace. Both
 * satisfy the same interface, so nothing downstream knows which it got.
 */
export function RepositoryProvider({ children }: { children: ReactNode }) {
  const { config, ready: configReady } = useAppConfig();
  const mode = config.mode;
  const repository = useMemo<DiagramRepository>(
    () => (mode === 'server' ? new HttpDiagramRepository() : new LocalDiagramRepository()),
    [mode],
  );
  const [migrated, setMigrated] = useState<DiagramRepository | null>(null);

  useEffect(() => {
    if (!configReady) return;
    let cancelled = false;
    const finish = () => {
      if (!cancelled) setMigrated(repository);
    };
    if (repository instanceof LocalDiagramRepository) {
      void repository
        .migrateLegacyAutosave(window.localStorage)
        .catch(() => null)
        .finally(finish);
    } else {
      finish();
    }
    return () => {
      cancelled = true;
    };
  }, [configReady, repository]);

  const value = useMemo(
    () => ({ repository, ready: configReady && migrated === repository, mode }),
    [repository, configReady, migrated, mode],
  );
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}
