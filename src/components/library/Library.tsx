'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DiagramMeta } from '@/lib/domain';
import { createEmptyModel } from '@/lib/engine';
import { TEMPLATES } from '@/lib/editor/templates';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { thumbnailDataUrl } from '@/lib/store/thumbnail';
import { renderPreview } from '@/lib/store/preview';
import { useLocale } from '@/lib/i18n/useLocale';
import { relativeDay } from '@/lib/i18n/relativeDay';
import { AcGraphLogo } from '@/components/brand/AcGraphLogo';
import { useRepository, useRepositoryReady } from '../app/RepositoryProvider';
import { useUser } from '../app/AuthProvider';
import { LOCAL_USER } from '@/lib/auth/user';
import { buildStamp } from '@/lib/appConfig';
import { useTheme } from '../app/useTheme';
import {
  CloseIcon,
  CopyIcon,
  FolderIcon,
  LogOutIcon,
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
import { CountUp } from './CountUp';

const NO_FOLDER = '__none__';
const SERVICE_COUNT = SERVICE_ICONS.length;
/** The public clouds in the catalogue; AION and the generic set are not clouds. */
const CLOUD_COUNT = new Set(
  SERVICE_ICONS.map((s) => s.category).filter((c) => c !== 'aion' && c !== 'generic'),
).size;

/** The diagram library: everything stored, with a way into each one. */
export function Library() {
  const repository = useRepository();
  const ready = useRepositoryReady();
  const router = useRouter();
  const { user, state: authState, signOut } = useUser();
  const { dark, toggle: toggleTheme } = useTheme();

  const [items, setItems] = useState<DiagramMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState<DiagramMeta | null>(null);
  const { t, locale } = useLocale();
  // The default local profile is called "You" in the model, which is the
  // right name for presence in another language's browser and the wrong one
  // in a Spanish header; the interface says it in its own language.
  const displayName =
    user.id === LOCAL_USER.id && user.name === LOCAL_USER.name ? t('account.you') : user.name;

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

  // Each template drawn for real, small: a starting point shown as the diagram
  // it produces says more than an icon and a line of text ever did. Six models
  // and six little SVGs, memoised per language and theme.
  const previews = useMemo(
    () =>
      TEMPLATES.map((template) => {
        const model = template.build(locale);
        return {
          template,
          model,
          src: thumbnailDataUrl(renderPreview(model, dark)),
        };
      }),
    [locale, dark],
  );
  const showcase = previews.find((p) => p.template.id === 'microservices') ?? previews[0];

  // The showcase leans towards the hand, a few degrees, and settles back when
  // it leaves: the one gesture that says "this is a thing, not a picture".
  const tilt = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty('--tilt-x', `${(x * 10).toFixed(2)}deg`);
    el.style.setProperty('--tilt-y', `${(-y * 8).toFixed(2)}deg`);
  }, []);
  const settle = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.currentTarget.style.removeProperty('--tilt-x');
    event.currentTarget.style.removeProperty('--tilt-y');
  }, []);
  const showTemplates = () =>
    document
      .getElementById('library-start')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="library">
      <header className="library-header">
        <div className="library-identity">
          <AcGraphLogo size={22} animate />
        </div>
        {/* Where you are and where you can go, in the header itself: a home
            that is only a logo and two buttons reads as a page, not a place. */}
        <nav className="library-nav" aria-label={t('library.navLabel')}>
          <a className="library-nav-link is-active" href="#library-body">
            {t('library.recent')}
          </a>
          <a className="library-nav-link" href="#library-start">
            {t('library.startPoints')}
          </a>
        </nav>
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
        <span
          className="library-user"
          title={authState === 'authenticated' ? (user.email ?? user.name) : t('account.local')}
        >
          <span className="library-avatar" aria-hidden="true">
            {user.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- provider-hosted avatar
              <img src={user.avatarUrl} alt="" />
            ) : (
              displayName.slice(0, 1).toUpperCase()
            )}
          </span>
          {displayName}
        </span>
        {authState === 'authenticated' && (
          <button
            type="button"
            className="icon-button"
            title={t('account.signOut')}
            aria-label={t('account.signOut')}
            onClick={() => void signOut()}
          >
            <LogOutIcon size={16} />
          </button>
        )}
        <button type="button" className="button is-primary" onClick={() => setPicking(true)}>
          <PlusIcon size={15} />
          {t('library.new')}
        </button>
      </header>

      {/* The one place in the app with room to say what it is: the words on
          the left, and on the right the proof — a real template, really drawn. */}
      <section className="library-hero">
        <div className="library-hero-aurora" aria-hidden="true" />
        <div className="library-hero-grid" aria-hidden="true" />
        <div className="library-hero-inner is-split">
          <div className="library-hero-copy">
            <p className="library-hero-eyebrow">
              <span className="library-hero-pulse" aria-hidden="true" />
              {t('library.eyebrow')}
            </p>
            <h1 className="library-hero-title">{t('library.heroTitle')}</h1>
            <p className="library-hero-subtitle">{t('library.heroLede')}</p>
            <div className="library-hero-actions">
              <button
                type="button"
                className="button is-primary is-large"
                onClick={() => setPicking(true)}
              >
                <PlusIcon size={16} />
                {t('library.heroCta')}
              </button>
              <button type="button" className="button is-large is-ghost" onClick={showTemplates}>
                {t('library.browseTemplates')}
              </button>
            </div>
            <ul className="library-hero-points">
              <li>
                <kbd>⌘K</kbd>
                {t('library.pointSearch')}
              </li>
              <li>
                <span className="library-point-mark" aria-hidden="true">
                  YAML
                </span>
                {t('library.pointCode')}
              </li>
              <li>
                <span className="library-point-mark" aria-hidden="true">
                  PDF
                </span>
                {t('library.pointShare')}
              </li>
            </ul>
          </div>
          {showcase && (
            <button
              type="button"
              className="library-showcase"
              aria-label={`${t('library.showcaseLabel')}: ${t(showcase.template.nameKey)}`}
              onPointerMove={tilt}
              onPointerLeave={settle}
              onClick={() => void create(t(showcase.template.nameKey), showcase.model)}
            >
              <span className="library-showcase-bar" aria-hidden="true">
                <i />
                <i />
                <i />
                <span>{t(showcase.template.nameKey)}</span>
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
              <img className="library-showcase-image" src={showcase.src} alt="" />
              <span className="library-showcase-caption">
                <span className="library-showcase-label">{t('library.showcaseLabel')}</span>
                <span>
                  {t('status.shapes', {
                    count: showcase.model.shapes.filter((s) => s.type === 'item').length,
                  })}
                  {' · '}
                  {t('status.connectors', { count: showcase.model.connectors.length })}
                </span>
              </span>
            </button>
          )}
        </div>
        <div className="library-hero-inner">
          <ul className="library-stats" aria-label={t('library.statsLabel')}>
            <li className="library-stat">
              <CountUp className="tabular" value={items.length} />
              <span>
                {items.length === 1 ? t('library.statDiagram') : t('library.statDiagrams')}
              </span>
            </li>
            <li className="library-stat">
              <CountUp className="tabular" value={SERVICE_COUNT} />
              <span>{t('library.statServices')}</span>
            </li>
            <li className="library-stat">
              <CountUp className="tabular" value={CLOUD_COUNT} />
              <span>{t('library.statClouds')}</span>
            </li>
            <li className="library-stat">
              <CountUp className="tabular" value={TEMPLATES.length + 1} />
              <span>{t('library.statTemplates')}</span>
            </li>
          </ul>
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

      <main className="library-body" id="library-body">
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
          <section className="library-empty" aria-live="polite">
            <h2>{t('library.emptyTitle')}</h2>
            <p>{t('library.emptyInline')}</p>
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

        {/* Starting points, always: a real drawing of each, not an icon. */}
        {!loading && (
          <section className="library-start" id="library-start">
            <div className="library-section-head">
              <h2>{t('library.startPoints')}</h2>
              <p>{t('library.startPointsHint')}</p>
            </div>
            <div className="library-templates is-rich">
              <button
                type="button"
                className="template-card is-blank is-rich"
                onClick={() => void create(t('app.untitled'))}
              >
                <span className="template-thumb is-blank">
                  <PlusIcon size={22} />
                </span>
                <span className="template-text">
                  <b>{t('library.blank')}</b>
                  <small>{t('library.blankHint')}</small>
                </span>
              </button>
              {previews.map(({ template, model, src }) => (
                <button
                  key={template.id}
                  type="button"
                  className="template-card is-rich"
                  onClick={() => void create(t(template.nameKey), model)}
                >
                  <span className="template-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
                    <img src={src} alt="" />
                    <span className="template-glyph">
                      <Glyph name={template.icon} size={14} />
                    </span>
                  </span>
                  <span className="template-text">
                    <b>{t(template.nameKey)}</b>
                    <small>{t(template.descriptionKey)}</small>
                    <span className="template-meta">
                      <span>
                        {t('status.shapes', {
                          count: model.shapes.filter((s) => s.type === 'item').length,
                        })}
                      </span>
                      <span>·</span>
                      <span>{t('status.connectors', { count: model.connectors.length })}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="library-footer">
        <span>AC Graph · AION Cloud</span>
        {buildStamp(locale) && <span>{t('app.build', { when: buildStamp(locale) })}</span>}
      </footer>

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
