'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CommentAnchor, CommentThread } from '@/lib/domain';
import { useRepository, useRepositoryReady } from '@/components/app/RepositoryProvider';

export interface Comments {
  threads: CommentThread[];
  /** Threads nobody has resolved, oldest first. */
  open: CommentThread[];
  loading: boolean;
  /** The last write failed; the list is what the store last said. */
  failed: boolean;
  /** Whether this person may delete any thread, not only their own: the owner. */
  canModerate: boolean;
  create: (anchor: CommentAnchor, body: string) => Promise<CommentThread | null>;
  reply: (threadId: string, body: string) => Promise<boolean>;
  setResolved: (threadId: string, resolved: boolean) => Promise<boolean>;
  remove: (threadId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const CommentsContext = createContext<Comments | null>(null);

export function useComments(): Comments {
  const context = useContext(CommentsContext);
  if (!context) throw new Error('useComments must be used inside <CommentsProvider>');
  return context;
}

/**
 * The conversations on this diagram, for the panel that lists them and the
 * canvas that pins them.
 *
 * Read from the store when the editor opens and again whenever `version`
 * moves — which is how the room says somebody else wrote something — and
 * after each write of our own, so what the panel shows is always what the
 * store holds rather than what we hoped it would. Comments never pass
 * through the document reducer: they are not part of the drawing, not
 * undone with it, and a viewer who may change nothing may still leave one.
 */
export function CommentsProvider({
  diagramId,
  version,
  canModerate,
  children,
}: {
  diagramId: string;
  /** Bumps when the room reports a change; see `useCollaboration`. */
  version: number;
  canModerate: boolean;
  children: ReactNode;
}) {
  const repository = useRepository();
  const ready = useRepositoryReady();
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Answers arriving out of order must not put an older list over a newer one.
  const sequence = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    if (!diagramId) return Promise.resolve();
    const reading = ++sequence.current;
    return repository.listThreads(diagramId).then(
      (found) => {
        if (reading !== sequence.current) return;
        setThreads(found);
        setLoading(false);
      },
      () => {
        if (reading !== sequence.current) return;
        setLoading(false);
      },
    );
  }, [repository, diagramId]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
  }, [ready, refresh, version]);

  /** Runs a write, then reads the truth back; false when the write failed. */
  const write = useCallback(
    async (run: () => Promise<unknown>) => {
      setFailed(false);
      try {
        await run();
        await refresh();
        return true;
      } catch {
        setFailed(true);
        return false;
      }
    },
    [refresh],
  );

  const create = useCallback(
    async (anchor: CommentAnchor, body: string) => {
      setFailed(false);
      try {
        const thread = await repository.createThread(diagramId, { anchor, body });
        await refresh();
        return thread;
      } catch {
        setFailed(true);
        return null;
      }
    },
    [repository, diagramId, refresh],
  );
  const reply = useCallback(
    (threadId: string, body: string) =>
      write(() => repository.reply(diagramId, threadId, { body })),
    [write, repository, diagramId],
  );
  const setResolved = useCallback(
    (threadId: string, resolved: boolean) =>
      write(() => repository.setThreadResolved(diagramId, threadId, resolved)),
    [write, repository, diagramId],
  );
  const remove = useCallback(
    (threadId: string) => write(() => repository.deleteThread(diagramId, threadId)),
    [write, repository, diagramId],
  );

  const value = useMemo<Comments>(
    () => ({
      threads,
      open: threads.filter((thread) => thread.resolvedAt === null),
      loading,
      failed,
      canModerate,
      create,
      reply,
      setResolved,
      remove,
      refresh,
    }),
    [threads, loading, failed, canModerate, create, reply, setResolved, remove, refresh],
  );

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}
