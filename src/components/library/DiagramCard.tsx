'use client';

import type { DiagramMeta } from '@/lib/domain';
import type { MessageKey } from '@/lib/i18n/messages';
import { relativeDay } from '@/lib/i18n/relativeDay';
import { thumbnailDataUrl } from '@/lib/store/thumbnail';
import {
  CopyIcon,
  FolderIcon,
  LogOutIcon,
  StarIcon,
  TemplateIcon,
  TrashIcon,
  UsersIcon,
} from '@/components/icons/ToolIcons';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * One diagram in the grid: its picture, its name, when it changed, where it
 * lives and what one may do with it; the star, duplicate and delete — or,
 * for someone else's diagram, leave — appear on hover.
 */
export function DiagramCard({
  t,
  item,
  index,
  starred,
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
  onOpen: () => void;
  onToggleStar: () => void;
  onDuplicate: () => void;
  /** Delete for the owner; leave for everyone else. The card only asks. */
  onRemove: () => void;
}) {
  return (
    <li className="library-card" style={{ '--i': index } as React.CSSProperties}>
      <button type="button" className="library-card-open" onClick={onOpen}>
        <span className="library-thumb">
          {item.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL
            <img src={thumbnailDataUrl(item.thumbnail)} alt="" />
          ) : (
            <TemplateIcon size={22} />
          )}
        </span>
        <span className="library-card-body">
          <span className="library-card-title">{item.title}</span>
          <span className="library-card-meta">
            <span>{t('library.updated', { when: relativeDay(item.updatedAt, t) })}</span>
            {item.folder && (
              <span className="library-card-folder">
                <FolderIcon size={11} />
                {item.folder}
              </span>
            )}
            {item.role && item.role !== 'owner' && (
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
        {item.role && item.role !== 'owner' ? (
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
