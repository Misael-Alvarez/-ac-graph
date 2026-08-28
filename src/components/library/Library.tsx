'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DiagramMeta } from '@/lib/domain';
import { createEmptyModel } from '@/lib/engine';
import { TEMPLATES } from '@/lib/editor/templates';
import { thumbnailDataUrl } from '@/lib/store/thumbnail';
import { useLocale } from '@/lib/i18n/useLocale';
import { relativeDay } from '@/lib/i18n/relativeDay';
import { AcGraphLogo } from '@/components/brand/AcGraphLogo';
import { useRepository, useRepositoryReady } from '../app/RepositoryProvider';
import { useUser } from '../app/AuthProvider';
import { useTheme } from '../app/useTheme';
import {
  CloseIcon,
  CopyIcon,
  FolderIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
  TemplateIcon,
  TrashIcon,
} from '@/components/icons/ToolIcons';
import { Glyph } from '@/components/icons/Glyph';
import { ConfirmDialog } from './ConfirmDialog';
import { WorkspaceActions } from './WorkspaceActions';
import { NewDiagramDialog } from './NewDiagramDialog';

const NO_FOLDER = '__none__';

/** The diagram library: everything stored, with a way into each one. */
export function Library() {
  const repository = useRepository();
  const ready = useRepositoryReady();
  const router = useRouter();
  const { user } = useUser();
  const { dark, toggle: toggleTheme } = useTheme();

  const [items, setItems] = useState<DiagramMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState<DiagramMeta | null>(null);
  const { t, locale } = useLocale();

  // `loading` starts true, so nothing needs setting before the read; a refresh
  // leaves the current list on screen rather than flashing a spinner.
  const refresh = useCallback(async () => {
    try {
      setItems(await repository.list());
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
  }, [ready, refresh]);

  /** Folders with how much is in each: a scope with no count is a guess. */
  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items)
      if (item.folder) counts.set(item.folder, (counts.get(item.folder) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (folder === NO_FOLDER && item.folder) return false;
      if (folder && folder !== NO_FOLDER && item.folder !== folder) return false;
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle)
      );
    });
  }, [items, query, folder]);

  const create = useCallback(
    async (title: string, model = createEmptyModel()) => {
      const created = await repository.create({ title, model });
      router.push(`/d/${created.id}`);
    },
    [repository, router],
  );

  return (
    <div className="library">
      <header className="library-header">
        <div className="library-identity">
          <AcGraphLogo size={22} animate />
        </div>
        <span className="library-spacer" />
        <WorkspaceActions onChanged={refresh} t={t} />
        <button
          type="button"
          className="icon-button"
          title={t('action.toggleTheme')}
          aria-label={t('action.toggleTheme')}
          aria-pressed={dark}
          onClick={toggleTheme}
        >
          {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>
        <span className="topbar-divider" />
        <span className="library-user" title={user.name}>
          <span className="library-avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          {user.name}
        </span>
        <button type="button" className="button is-primary" onClick={() => setPicking(true)}>
          <PlusIcon size={15} />
          {t('library.new')}
        </button>
      </header>

      {/* The one place in the app with room to say what it is. */}
      <section className="library-hero">
        <div className="library-hero-inner">
          <h1 className="library-hero-title">{t('library.recent')}</h1>
          <p className="library-hero-subtitle">{t('library.subtitle')}</p>
          {items.length > 0 && (
            <p className="library-hero-count tabular">
              {items.length === 1
                ? t('library.countOne')
                : t('library.countMany', { count: items.length })}
            </p>
          )}
        </div>
      </section>

      <div className="library-toolbar">
        <div className="library-search filter-field">
          <SearchIcon size={15} />
          <input
            className="library-search-input filter-input"
            placeholder={t('library.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="library-search-clear"
              aria-label={t('library.clearSearch')}
              onClick={() => setQuery('')}
            >
              <CloseIcon size={13} />
            </button>
          )}
        </div>
        {query.trim() !== '' && (
          <span className="result-count">
            {t('browser.showing', { count: visible.length, total: items.length })}
          </span>
        )}

        {folders.length > 0 && (
          <div className="library-folders chip-row">
            <button
              type="button"
              className={`library-folder chip${folder === null ? ' is-active' : ''}`}
              onClick={() => setFolder(null)}
            >
              {t('library.all')}
              <span className="chip-count">{items.length}</span>
            </button>
            {folders.map(([name, count]) => (
              <button
                key={name}
                type="button"
                className={`library-folder chip${folder === name ? ' is-active' : ''}`}
                onClick={() => setFolder(name)}
              >
                <FolderIcon size={13} />
                {name}
                <span className="chip-count">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <main className="library-body">
        {/* Cards rather than a line of text: the page keeps its shape, so
            nothing jumps when the real list arrives. */}
        {loading && (
          <ul className="library-grid" aria-busy="true" aria-label={t('library.loading')}>
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="library-card is-skeleton" aria-hidden="true">
                <span className="library-thumb" />
                <span className="library-card-body">
                  <span className="skeleton-line" />
                  <span className="skeleton-line is-short" />
                </span>
              </li>
            ))}
          </ul>
        )}

        {!loading && items.length === 0 && (
          <section className="library-start">
            <h2>{t('library.emptyTitle')}</h2>
            <p>{t('library.emptyHint')}</p>
            <div className="library-templates">
              <button
                type="button"
                className="template-card is-blank"
                onClick={() => void create(t('app.untitled'))}
              >
                <span className="template-icon">
                  <PlusIcon size={20} />
                </span>
                <span>
                  <b>{t('library.blank')}</b>
                  <small>{t('library.blankHint')}</small>
                </span>
              </button>
              {TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="template-card"
                  onClick={() => void create(t(template.nameKey), template.build(locale))}
                >
                  <span className="template-icon">
                    <Glyph name={template.icon} size={20} />
                  </span>
                  <span>
                    <b>{t(template.nameKey)}</b>
                    <small>{t(template.descriptionKey)}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {!loading && items.length > 0 && visible.length === 0 && (
          <div className="library-note">
            <SearchIcon size={22} />
            <p>{t('library.noMatches')}</p>
            <small>{t('library.noMatchesHint')}</small>
          </div>
        )}

        {visible.length > 0 && (
          <ul className="library-grid">
            {visible.map((item, index) => (
              <li
                key={item.id}
                className="library-card"
                style={{ '--i': index } as React.CSSProperties}
              >
                <button
                  type="button"
                  className="library-card-open"
                  onClick={() => router.push(`/d/${item.id}`)}
                >
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
                    </span>
                  </span>
                </button>
                <div className="library-card-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title={t('action.duplicate')}
                    aria-label={`${t('action.duplicate')}: ${item.title}`}
                    onClick={() => void repository.duplicate(item.id).then(refresh)}
                  >
                    <CopyIcon size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button is-danger"
                    title={t('action.delete')}
                    aria-label={`${t('action.delete')}: ${item.title}`}
                    onClick={() => setDeleting(item)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {deleting && (
        <ConfirmDialog
          t={t}
          message={t('library.confirmDelete', { title: deleting.title })}
          confirmLabel={t('action.delete')}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void repository.delete(id).then(refresh);
          }}
        />
      )}

      {picking && (
        <NewDiagramDialog
          t={t}
          onClose={() => setPicking(false)}
          onPick={(title, model) => {
            setPicking(false);
            void create(title, model);
          }}
        />
      )}
    </div>
  );
}
