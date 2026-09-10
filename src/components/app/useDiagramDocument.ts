'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiagramModel, DiagramRecord, Role } from '@/lib/domain';
import { DraftJournal } from '@/lib/store/draftJournal';
import { acquireDraftSession, type DraftSessionLease } from '@/lib/store/draftSession';
import { NoAccessError } from '@/lib/store/httpRepository';
import { SaveCoordinator, type RemoteConflict, type SaveStatus } from '@/lib/store/saveCoordinator';
import type { DiagramRepository } from '@/lib/store/types';
import { useRepository, useRepositoryReady } from './RepositoryProvider';

export type { SaveStatus } from '@/lib/store/saveCoordinator';

// A quick return to the same route must not load ahead of its departing writer.
const departures = new WeakMap<DiagramRepository, Map<string, Promise<void>>>();

/** The diagram exists and this person is not (or no longer) allowed in. */
export interface NoAccess {
  required: Role;
  /** Whom to ask, when the server knows. */
  ownerName: string | null;
}

export interface DiagramDocument {
  record: DiagramRecord | null;
  loading: boolean;
  notFound: boolean;
  noAccess: NoAccess | null;
  /** What this person may do here; `owner` in the browser-only store. */
  role: Role;
  status: SaveStatus;
  recoveryConflict: DiagramModel | null;
  recoveryUnavailable: boolean;
  /** Somebody else's newer revision, when this editor has unsaved changes. */
  remoteConflict: RemoteConflict | null;
  save: (model: DiagramModel) => void;
  rename: (title: string) => Promise<void>;
  snapshot: (model: DiagramModel) => Promise<void>;
  restore: (versionId: string, model: DiagramModel) => Promise<DiagramRecord>;
  retry: () => Promise<void>;
  /**
   * Takes a revision saved elsewhere as the baseline. Returns the record when
   * it was adopted (nothing was pending here), null when it became a conflict.
   */
  adoptRemote: (record: DiagramRecord) => DiagramRecord | null;
  /** Resolves a conflict in favour of the other side; returns their record. */
  acceptRemote: () => DiagramRecord | null;
  /** The revision this editor last confirmed, to compare with live events. */
  confirmedUpdatedAt: () => string | null;
  /** The room said this person's access changed: a new role, or none at all — and by whom. */
  applyAccess: (role: Role | null, by: string) => void;
  /** Who took the access away while looking; read-only from then on, the copy on screen stays. */
  accessRevokedBy: string | null;
}

/** Browser lifecycle adapter; all write ordering and recovery live outside React. */
export function useDiagramDocument(id: string): DiagramDocument {
  const repository = useRepository();
  const ready = useRepositoryReady();
  const writer = useRef<{ id: string; coordinator: SaveCoordinator } | null>(null);
  const [state, setState] = useState<{
    id: string;
    record: DiagramRecord | null;
    loading: boolean;
    notFound: boolean;
    noAccess: NoAccess | null;
    status: SaveStatus;
    recoveryConflict: DiagramModel | null;
    recoveryUnavailable: boolean;
    remoteConflict: RemoteConflict | null;
  }>({
    id,
    record: null,
    loading: true,
    notFound: false,
    noAccess: null,
    status: 'saved',
    recoveryConflict: null,
    recoveryUnavailable: false,
    remoteConflict: null,
  });
  // A role change announced by the room, until the next load says otherwise.
  const [liveRole, setLiveRole] = useState<{
    id: string;
    role: Role;
    revokedBy: string | null;
  } | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let leftPage = false;
    let lease: DraftSessionLease | null = null;
    let coordinator: SaveCoordinator | null = null;
    let recoveryUnavailable = false;
    const closing = departures.get(repository) ?? new Map<string, Promise<void>>();
    departures.set(repository, closing);
    const previous = Promise.all([...closing.values()]);

    const publish = () => {
      if (cancelled || leftPage || !coordinator) return;
      setState({
        id,
        record: coordinator.record,
        status: coordinator.status,
        recoveryConflict: coordinator.recoveryConflict?.model ?? null,
        recoveryUnavailable,
        remoteConflict: coordinator.remoteConflict,
        notFound: false,
        noAccess: null,
        loading: false,
      });
    };
    const flush = () => void coordinator?.flush().catch(() => {});
    const onPageHide = () => {
      leftPage = true;
      flush();
      void lease?.release().catch(() => {});
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // A bfcache document released its lease. Reopen under a new lease before editing.
      if (event.persisted) window.location.reload();
    };
    const onVisibility = () => {
      if (!leftPage && document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);

    const opened = (async () => {
      try {
        await previous;
        if (cancelled || leftPage) return;
        try {
          lease = await acquireDraftSession(window.sessionStorage, navigator.locks);
        } catch {
          // Denied locks/storage must not enable recovery under an unowned id.
        }
        if (cancelled || leftPage) {
          await lease?.release();
          return;
        }
        let found: DiagramRecord | null;
        try {
          found = await repository.get(id);
        } catch (thrown) {
          if (!(thrown instanceof NoAccessError)) throw thrown;
          await lease?.release();
          if (cancelled || leftPage) return;
          setState({
            id,
            record: null,
            loading: false,
            notFound: false,
            noAccess: { required: thrown.required, ownerName: thrown.ownerName },
            status: 'saved',
            recoveryConflict: null,
            recoveryUnavailable: false,
            remoteConflict: null,
          });
          return;
        }
        if (cancelled || leftPage) return;
        if (!found) {
          await lease?.release();
          setState({
            id,
            record: null,
            loading: false,
            notFound: true,
            noAccess: null,
            status: 'saved',
            recoveryConflict: null,
            recoveryUnavailable: false,
            remoteConflict: null,
          });
          return;
        }
        let journal: DraftJournal | null = null;
        try {
          if (lease) {
            const owner = lease;
            journal = new DraftJournal(window.localStorage, owner.id, found, () => owner.active);
          }
        } catch {
          // Storage can be denied independently of IndexedDB. The coordinator
          // then bypasses debounce and keeps unsuccessful writes retryable.
        }
        recoveryUnavailable = !journal;
        coordinator = new SaveCoordinator(repository, found, journal, publish);
        writer.current = { id, coordinator };
        publish();
        if (coordinator.status === 'pending') flush();
      } catch {
        await lease?.release().catch(() => {});
        if (!cancelled && !leftPage) {
          setState({
            id,
            record: null,
            loading: false,
            notFound: false,
            noAccess: null,
            status: 'error',
            recoveryConflict: null,
            recoveryUnavailable,
            remoteConflict: null,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
      if (writer.current?.coordinator === coordinator) writer.current = null;
      const departure = opened
        .then(async () => {
          await coordinator?.flush().catch(() => {});
          await lease?.release();
        })
        .catch(() => {});
      closing.set(id, departure);
      void departure.then(() => {
        if (closing.get(id) === departure) closing.delete(id);
      });
    };
  }, [ready, repository, id]);

  const current = useCallback(() => {
    if (writer.current?.id !== id) throw new Error('The diagram is not ready.');
    return writer.current.coordinator;
  }, [id]);
  const save = useCallback((model: DiagramModel) => current().save(model), [current]);
  const rename = useCallback((title: string) => current().rename(title), [current]);
  const snapshot = useCallback((model: DiagramModel) => current().snapshot(model), [current]);
  const restore = useCallback(
    (versionId: string, model: DiagramModel) => current().restore(versionId, model),
    [current],
  );
  const retry = useCallback(() => current().flush(), [current]);
  const adoptRemote = useCallback(
    (record: DiagramRecord) => {
      const coordinator = writer.current?.id === id ? writer.current.coordinator : null;
      if (!coordinator) return null;
      return coordinator.adoptRemote(record) === 'adopted' ? record : null;
    },
    [id],
  );
  const acceptRemote = useCallback(() => {
    const coordinator = writer.current?.id === id ? writer.current.coordinator : null;
    return coordinator?.acceptRemote() ?? null;
  }, [id]);
  const confirmedUpdatedAt = useCallback(() => {
    const coordinator = writer.current?.id === id ? writer.current.coordinator : null;
    return coordinator?.confirmedUpdatedAt ?? null;
  }, [id]);
  const applyAccess = useCallback(
    // Removed while looking: nothing more can be written, the screen stays.
    (role: Role | null, by: string) =>
      setLiveRole({ id, role: role ?? 'viewer', revokedBy: role === null ? by : null }),
    [id],
  );

  const live = liveRole?.id === id ? liveRole : null;
  const role: Role = live?.role ?? state.record?.role ?? 'owner';

  return {
    ...state,
    loading: state.id !== id || state.loading,
    role,
    applyAccess,
    accessRevokedBy: live?.revokedBy ?? null,
    save,
    rename,
    snapshot,
    restore,
    retry,
    adoptRemote,
    acceptRemote,
    confirmedUpdatedAt,
  };
}
