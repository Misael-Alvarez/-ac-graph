'use client';

import { useCallback } from 'react';
import type { DiagramMeta } from '@/lib/domain';
import type { MessageKey } from '@/lib/i18n/messages';
import { relativeDay, withinADay } from '@/lib/i18n/relativeDay';
import { thumbnailDataUrl } from '@/lib/store/thumbnail';
import {
  CopyIcon,
  FolderIcon,
  LogOutIcon,
  StarIcon,
  TrashIcon,
  UsersIcon,
} from '@/components/icons/ToolIcons';
import type { DiagramPreview } from './useDiagramPreviews';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * One diagram in the grid: its drawing, its name — with a green dot while the
 * day it was last touched is today — when it changed, where it lives and what
 * one may do with it; how much is in it waits in the tooltip. The star,
 * duplicate and delete — or, for someone else's diagram, leave — appear on
 * hover; a star that is on stays.
 */
export function DiagramCard({
  t,
  item,
  index,
  starred,
  preview,
  observe,
  onOpen,
  onToggleStar,
  onDuplicate,
  onRemove,
}: {
  t: Translate;
  item: DiagramMeta;
  /** Position in the grid, for the stagger of the entrance. */
  index: number;
  starred: boolean;
  /** The real drawing, once it has been read; the stored thumbnail stands in until then. */
  preview: DiagramPreview | undefined;
  /** Attached to the card so its drawing is read when it scrolls into view. */
  observe: (meta: DiagramMeta) => (element: Element | null) => (() => void) | undefined;
  onOpen: () => void;
  onToggleStar: () => void;
  onDuplicate: () => void;
  /** Delete for the owner; leave for everyone else. The card only asks. */
  onRemove: () => void;
}) {
  // One ref per card and revision, stable across renders, so the observer is
  // not told to forget and re-learn every card each time a drawing arrives.
  const ref = useCallback(
    (element: HTMLLIElement | null) => observe(item)(element),
    [observe, item],
  );
  const src = preview?.src ?? (item.thumbnail ? thumbnailDataUrl(item.thumbnail) : null);
  const shared = item.role !== undefined && item.role !== 'owner';
  // A diagram never named is said to be unnamed, quietly, rather than shown
  // with the default the store gave it as if someone had chosen it.
  const untitled = item.title.trim() === '' || item.title === t('app.untitled');
  const shapes = preview?.model.shapes.filter((s) => s.type === 'item').length;

  return (
    <li ref={ref} className="library-card" style={{ '--i': index } as React.CSSProperties}>
      <button type="button" className="library-card-open" onClick={onOpen}>
        <span className={`library-thumb${src ? '' : ' is-empty'}`}>
          {src && (
            // eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL
            <img src={src} alt="" />
          )}
        </span>
        <span className="library-card-body">
          <span className={`library-card-title${untitled ? ' is-untitled' : ''}`}>
            <span className="library-card-title-text">
              {untitled ? t('app.untitled') : item.title}
            </span>
            {withinADay(item.updatedAt) && <i className="library-card-live" aria-hidden="true" />}
          </span>
          <span
            className="library-card-meta"
            title={shapes === undefined ? undefined : t('status.shapes', { count: shapes })}
          >
            <span>{t('library.editedWhen', { when: relativeDay(item.updatedAt, t) })}</span>
            {item.folder && (
              <span className="library-card-folder">
                <FolderIcon size={11} />
                {item.folder}
              </span>
            )}
            {shared && (
              /* Someone else's diagram: say so, and how far one may go with it. */
              <span className="library-card-role" title={t('library.sharedWithYou')}>
                <UsersIcon size={11} />
                {t(item.role === 'editor' ? 'role.editor' : 'role.viewer')}
              </span>
            )}
          </span>
        </span>
      </button>
      <div className="library-card-actions">
        <button
          type="button"
          className={`icon-button library-star${starred ? ' is-on' : ''}`}
          title={t(starred ? 'library.unfavourite' : 'library.favourite')}
          aria-label={`${t(starred ? 'library.unfavourite' : 'library.favourite')}: ${item.title}`}
          aria-pressed={starred}
          onClick={onToggleStar}
        >
          <StarIcon size={14} filled={starred} />
        </button>
        <button
          type="button"
          className="icon-button"
          title={t('action.duplicate')}
          aria-label={`${t('action.duplicate')}: ${item.title}`}
          onClick={onDuplicate}
        >
          <CopyIcon size={14} />
        </button>
        {shared ? (
          <button
            type="button"
            className="icon-button"
            title={t('share.leave')}
            aria-label={`${t('share.leave')}: ${item.title}`}
            onClick={onRemove}
          >
            <LogOutIcon size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-button is-danger"
            title={t('action.delete')}
            aria-label={`${t('action.delete')}: ${item.title}`}
            onClick={onRemove}
          >
            <TrashIcon size={14} />
          </button>
        )}
      </div>
    </li>
  );
}
