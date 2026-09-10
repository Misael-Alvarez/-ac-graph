'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramRecord } from '@/lib/domain';
import {
  sendPresence,
  subscribeToDiagram,
  throttle,
  type CollabStatus,
  type PresenceUser,
  type SavedEvent,
} from '@/lib/collab/client';
import { toCanvas } from '@/lib/editor/viewport';
import { useRepository, useRepositoryMode } from '@/components/app/RepositoryProvider';
import { useEditor } from '../EditorProvider';

export interface Collaboration {
  /** Off in local mode: no channel, no presence. */
  enabled: boolean;
  status: CollabStatus | 'off';
  /** Everyone in the room, this tab first. */
  users: PresenceUser[];
  /** Fired by the last remote save adopted, for the toast. */
  lastRemoteSave: SavedEvent | null;
  /** Set when somebody deleted the diagram under us. */
  deletedBy: string | null;
}

const CURSOR_INTERVAL_MS = 80;

/**
 * The live channel for one open diagram.
 *
 * Listens for other people's saves and presence, and reports this tab's cursor
 * and editing state. When a remote save arrives and nothing is pending here the
 * canvas simply follows — one undo step, so the person can see what changed.
 * With local changes pending the save becomes a conflict, surfaced by the
 * document hook; nothing is merged behind anyone's back.
 */
export function useCollaboration(
  diagramId: string,
  doc: {
    adoptRemote: (record: DiagramRecord) => DiagramRecord | null;
    confirmedUpdatedAt: () => string | null;
    status: string;
  },
  onRemoteModel: (record: DiagramRecord) => void,
  onRemoteTitle: (title: string) => void,
): Collaboration {
  const mode = useRepositoryMode();
  const repository = useRepository();
  const { ui } = useEditor();
  const enabled = mode === 'server';

  const [status, setStatus] = useState<CollabStatus | 'off'>(enabled ? 'connecting' : 'off');
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [lastRemoteSave, setLastRemoteSave] = useState<SavedEvent | null>(null);
  const [deletedBy, setDeletedBy] = useState<string | null>(null);

  // Handlers read the latest props without re-subscribing on every render.
  const latest = useRef({ doc, onRemoteModel, onRemoteTitle });
  useEffect(() => {
    latest.current = { doc, onRemoteModel, onRemoteTitle };
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const stop = subscribeToDiagram(diagramId, {
      onStatus: (next) => {
        if (!cancelled) setStatus(next);
      },
      onPresence: (list) => {
        if (cancelled) return;
        // This tab first, then everybody else by name, so the stack is stable.
        const sorted = [...list].sort((a, b) =>
          a.self === b.self ? a.name.localeCompare(b.name) : a.self ? -1 : 1,
        );
        setUsers(sorted);
      },
      onSaved: (event) => {
        const { doc: current, onRemoteModel: apply } = latest.current;
        // Our own save comes back to us too; the coordinator already holds it.
        if (current.confirmedUpdatedAt() === event.updatedAt) return;
        void repository.get(diagramId).then((record) => {
          if (cancelled || !record) return;
          if (record.updatedAt !== event.updatedAt) return;
          const adopted = current.adoptRemote(record);
          if (adopted) {
            apply(adopted);
            setLastRemoteSave(event);
          }
        });
      },
      onMeta: (event) => latest.current.onRemoteTitle(event.title),
      onDeleted: () => {
        if (!cancelled) setDeletedBy(users.find((u) => !u.self)?.name ?? '');
      },
    });
    return () => {
      cancelled = true;
      stop();
    };
    // `users` is read only inside onDeleted for a name; not worth resubscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, diagramId, repository]);

  /* Cursor: canvas coordinates, throttled, only while over the canvas. */
  const viewportRef = useRef(ui.viewport);
  useEffect(() => {
    viewportRef.current = ui.viewport;
  });
  const cursorSender = useMemo(
    () =>
      throttle((cursor: { x: number; y: number } | null) => {
        void sendPresence(diagramId, { cursor });
      }, CURSOR_INTERVAL_MS),
    [diagramId],
  );
  useEffect(() => {
    if (!enabled) return;
    const surface = () => document.querySelector<Element>('.canvas-surface');
    const onMove = (event: PointerEvent) => {
      const el = surface();
      if (!el || !(event.target instanceof Node) || !el.contains(event.target)) return;
      const rect = el.getBoundingClientRect();
      const point = toCanvas(viewportRef.current, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      cursorSender({ x: Math.round(point.x), y: Math.round(point.y) });
    };
    const onLeave = () => {
      cursorSender.cancel();
      void sendPresence(diagramId, { cursor: null });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', onLeave);
    document.addEventListener('pointerleave', onLeave);
    return () => {
      cursorSender.cancel();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [enabled, diagramId, cursorSender]);

  /* Editing: on while a save is pending or in flight, off once confirmed. */
  const editing = doc.status === 'pending' || doc.status === 'saving';
  const lastEditing = useRef<boolean | null>(null);
  useEffect(() => {
    if (!enabled || lastEditing.current === editing) return;
    lastEditing.current = editing;
    void sendPresence(diagramId, { editing });
  }, [enabled, diagramId, editing]);

  const clearRemoteSave = useCallback(() => setLastRemoteSave(null), []);
  useEffect(() => {
    if (!lastRemoteSave) return;
    const timer = setTimeout(clearRemoteSave, 4000);
    return () => clearTimeout(timer);
  }, [lastRemoteSave, clearRemoteSave]);

  return { enabled, status, users, lastRemoteSave, deletedBy };
}
