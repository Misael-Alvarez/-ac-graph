'use client';

import type { MessageKey } from '@/lib/i18n/messages';
import type { LibrarySort } from '@/lib/library/prefs';
import { CloseIcon, FolderIcon, StarIcon } from '@/components/icons/ToolIcons';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { SearchField } from '@/components/ui/SearchField';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** A filter value, not a folder: diagrams without one. */
export const NO_FOLDER = '__none__';
/** A filter value, not a folder: the starred diagrams. */
export const FAVOURITES = '__favourites__';

/**
 * The head of the list of diagrams: its title with the count, the search and
 * the sort beside it, and — when there is something to narrow by — the chips:
 * all, favourites, then one per folder.
 */
export function LibraryToolbar({
  t,
  query,
  onQuery,
  visibleCount,
  total,
  sort,
  onSort,
  folders,
  folder,
  onFolder,
  starredCount,
}: {
  t: Translate;
  query: string;
  onQuery: (query: string) => void;
  visibleCount: number;
  total: number;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  /** Folder names with how many diagrams each holds, alphabetical. */
  folders: [string, number][];
  /** The active filter: a folder name, `FAVOURITES`, `NO_FOLDER` or null for all. */
  folder: string | null;
  onFolder: (folder: string | null) => void;
  starredCount: number;
}) {
  const narrowed = query.trim() !== '' || folder !== null;
  return (
    <div className="library-toolbar">
      <div className="library-toolbar-row">
        <h2 className="library-toolbar-title">
          {t('library.recent')}
          <span className="library-count tabular">
            {narrowed ? t('browser.showing', { count: visibleCount, total }) : total}
          </span>
        </h2>
        <SearchField
          className="library-search"
          inputClassName="library-search-input"
          iconSize={15}
          placeholder={t('library.search')}
          value={query}
          onChange={onQuery}
          trailing={
            query && (
              <button
                type="button"
                className="library-search-clear"
                aria-label={t('library.clearSearch')}
                onClick={() => onQuery('')}
              >
                <CloseIcon size={13} />
              </button>
            )
          }
        />
        {total > 1 && (
          <label className="library-sort">
            <span className="sr-only">{t('library.sort')}</span>
            <select
              className="input is-choice"
              value={sort}
              onChange={(e) => onSort(e.target.value as LibrarySort)}
            >
              <option value="recent">{t('library.sortRecent')}</option>
              <option value="name">{t('library.sortName')}</option>
              <option value="created">{t('library.sortCreated')}</option>
            </select>
          </label>
        )}
      </div>

      {(folders.length > 0 || starredCount > 0) && (
        <ChipRow className="library-folders">
          <Chip
            className="library-folder"
            active={folder === null}
            count={total}
            onClick={() => onFolder(null)}
          >
            {t('library.all')}
          </Chip>
          {starredCount > 0 && (
            <Chip
              className="library-folder"
              active={folder === FAVOURITES}
              count={starredCount}
              onClick={() => onFolder(folder === FAVOURITES ? null : FAVOURITES)}
            >
              <StarIcon size={13} filled />
              {t('library.favourites')}
            </Chip>
          )}
          {folders.map(([name, count]) => (
            <Chip
              key={name}
              className="library-folder"
              active={folder === name}
              count={count}
              onClick={() => onFolder(name)}
            >
              <FolderIcon size={13} />
              {name}
            </Chip>
          ))}
        </ChipRow>
      )}
    </div>
  );
}
