'use client';

import type { PresenceUser } from '@/lib/collab/client';
import { toScreen } from '@/lib/editor/viewport';
import { useEditor } from '../EditorProvider';
import type { Collaboration } from '../hooks/useCollaboration';

const MAX_AVATARS = 5;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** The stack of avatars in the top bar, plus the live pill. */
export function PresenceStack({ collab }: { collab: Collaboration }) {
  const { t } = useEditor();
  if (!collab.enabled) return null;

  const others = collab.users.filter((u) => !u.self);
  const shown = collab.users.slice(0, MAX_AVATARS);
  const overflow = collab.users.length - shown.length;
  const liveClass =
    collab.status === 'open'
      ? ' is-live'
      : collab.status === 'reconnecting' || collab.status === 'connecting'
        ? ' is-reconnecting'
        : '';
  const liveLabel =
    collab.status === 'open'
      ? t('live.connected')
      : collab.status === 'reconnecting'
        ? t('live.reconnecting')
        : collab.status === 'connecting'
          ? t('live.connecting')
          : t('live.offline');
  const count =
    others.length === 0
      ? t('live.alone')
      : others.length === 1
        ? t('live.other')
        : t('live.others', { count: others.length });

  return (
    <div className="topbar-live" role="group" aria-label={count}>
      <span className={`live-pill${liveClass}`} title={`${liveLabel} · ${count}`}>
        <span>{liveLabel}</span>
      </span>
      {shown.length > 0 && (
        <div className="presence-stack">
          {shown.map((user) => (
            <span
              key={`${user.id}-${user.self ? 'self' : 'other'}`}
              className={`presence-avatar${user.self ? ' is-self' : ''}${user.editing ? ' is-editing' : ''}`}
              style={{ '--user-color': user.color } as React.CSSProperties}
              title={`${user.self ? `${user.name} (${t('live.you')})` : user.name}${user.editing ? ` · ${t('live.editing')}` : ''}`}
              aria-label={user.self ? `${user.name} (${t('live.you')})` : user.name}
            >
              {initials(user.name)}
            </span>
          ))}
          {overflow > 0 && <span className="presence-more">+{overflow}</span>}
        </div>
      )}
    </div>
  );
}

/** Other people's cursors, drawn over the canvas in screen space. */
export function RemoteCursors({ users }: { users: PresenceUser[] }) {
  const { ui } = useEditor();
  const visible = users.filter((u) => !u.self && u.cursor);
  if (!visible.length) return null;
  return (
    <div className="remote-cursors" aria-hidden="true">
      {visible.map((user) => {
        const point = toScreen(ui.viewport, user.cursor!);
        return (
          <div
            key={user.id}
            className="remote-cursor"
            style={
              {
                '--cx': `${Math.round(point.x)}px`,
                '--cy': `${Math.round(point.y)}px`,
                '--user-color': user.color,
              } as React.CSSProperties
            }
          >
            <span className="remote-cursor-dot" />
            <span className="remote-cursor-name">{user.name}</span>
          </div>
        );
      })}
    </div>
  );
}
