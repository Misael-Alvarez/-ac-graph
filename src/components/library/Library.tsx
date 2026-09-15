'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DiagramMeta } from '@/lib/domain';
import { createEmptyModel } from '@/lib/engine';
import { TEMPLATES } from '@/lib/editor/templates';
import { thumbnailDataUrl } from '@/lib/store/thumbnail';
import { renderPreview } from '@/lib/store/preview';
import { useLocale } from '@/lib/i18n/useLocale';
import { useMembersApi, useRepository, useRepositoryReady } from '../app/RepositoryProvider';
import { DropImportError, readDroppedFile } from '@/lib/library/dropImport';
import { usePresence } from '@/lib/editor/usePresence';
import { sortDiagrams, useLibraryPrefs } from '@/lib/library/prefs';
import { useUser } from '../app/AuthProvider';
import { LOCAL_USER } from '@/lib/auth/user';
import { buildStamp } from '@/lib/appConfig';
import { useTheme } from '../app/useTheme';
import { ImportIcon, SearchIcon } from '@/components/icons/ToolIcons';
import { ConfirmDialog } from './ConfirmDialog';
import { DiagramCard } from './DiagramCard';
import { LibraryHeader } from './LibraryHeader';
import { LibraryHero } from './LibraryHero';
import { FAVOURITES, LibraryToolbar, NO_FOLDER } from './LibraryToolbar';
import { TemplateGallery } from './TemplateGallery';
import { NewDiagramDialog } from './NewDiagramDialog';
import { useActiveSection } from './useActiveSection';
import { useDiagramPreviews } from './useDiagramPreviews';

/** The two sections the header's pills point at, in page order. */
const SECTIONS = ['library-body', 'library-start'] as const;

/** How long the first paint's cards take to rise into place, stagger included. */
const ENTRANCE_MS = 700;

/** The diagram library: everything stored, with a way into each one. */
export function Library() {
  const repository = useRepository();
  const membersApi = useMembersApi();
  const ready = useRepositoryReady();
  const router = useRouter();
  const { user, state: authState, signOut } = useUser();
  const { dark, toggle: toggleTheme } = useTheme();

  const [all, setAll] = useState<DiagramMeta[]>([]);
  // The reader's own starting points are diagrams too, but never among the
  // diagrams: they have their own place, below, beside the built-in ones.
  const items = useMemo(() => all.filter((item) => !item.template), [all]);
  const templates = useMemo(() => all.filter((item) => item.template), [all]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState<DiagramMeta | null>(null);
  const { t, locale } = useLocale();
  const { sort, favourites, setSort, toggleFavourite } = useLibraryPrefs();
  const confirm = usePresence(deleting);
  const pick = usePresence(picking);
  const starred = useMemo(() => new Set(favourites), [favourites]);
  // The default local profile is called "You" in the model, which is the
  // right name for presence in another language's browser and the wrong one
  // in a Spanish header; the interface says it in its own language.
  const displayName =
    user.id === LOCAL_USER.id && user.name === LOCAL_USER.name ? t('account.you') : user.name;

  // `loading` starts true, so nothing needs setting before the read; a refresh
  // leaves the current list on screen rather than flashing a spinner.
  const refresh = useCallback(async () => {
    try {
      setAll(await repository.list());
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
  }, [ready, refresh]);

  // The cards rise into place once, on the first paint; after that a card
  // that appears — a duplicate, a search cleared — is simply there.
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => setEntering(false), ENTRANCE_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  // The diagram touched last is the one the hero shows large and offers to
  // pick up again. By `updatedAt`, whatever the list is sorted by.
  const latest = useMemo(
    () =>
      items.reduce<DiagramMeta | undefined>(
        (best, item) => (!best || item.updatedAt > best.updatedAt ? item : best),
        undefined,
      ),
    [items],
  );
  const upfront = useMemo(() => (latest ? [latest.id] : []), [latest]);

  // Each card's drawing is read as it scrolls into view — the hero's at once,
  // in view or not; the reader's own starting points — few, and shown whole —
  // are read at once too.
  const diagramPreviews = useDiagramPreviews(repository, items, dark, { upfront });
  const templatePreviews = useDiagramPreviews(repository, templates, dark, { eager: true });

  /** Folders with how much is in each: a scope with no count is a guess. */
  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items)
      if (item.folder) counts.set(item.folder, (counts.get(item.folder) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (folder === FAVOURITES && !starred.has(item.id)) return false;
      if (folder === NO_FOLDER && item.folder) return false;
      if (folder && folder !== NO_FOLDER && folder !== FAVOURITES && item.folder !== folder) {
        return false;
      }
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle) ||
        (item.folder?.toLowerCase().includes(needle) ?? false)
      );
    });
    return sortDiagrams(filtered, sort, favourites);
  }, [items, query, folder, sort, favourites, starred]);
  const starredCount = useMemo(
    () => items.filter((item) => starred.has(item.id)).length,
    [items, starred],
  );

  const create = useCallback(
    async (title: string, model = createEmptyModel()) => {
      const created = await repository.create({ title, model });
      router.push(`/d/${created.id}`);
    },
    [repository, router],
  );

  /*
   * A file dropped anywhere on the page becomes a diagram — or, for a
   * workspace dump, several. Counted rather than toggled, because dragging
   * over child elements fires enter/leave in pairs and a plain boolean flickers.
   */
  const [dragDepth, setDragDepth] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragDepth((depth) => depth + 1);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    setDragDepth((depth) => Math.max(0, depth - 1));
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragDepth(0);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      const read = readDroppedFile(file.name, await file.text(), locale);
      if (read.kind === 'workspace') {
        const count = await repository.importWorkspace(read.data);
        setNotice(t('library.imported', { count }));
        await refresh();
        return;
      }
      await create(read.title, read.model);
    } catch (thrown) {
      setNotice(
        t(
          thrown instanceof DropImportError
            ? (`import.${thrown.code}` as const)
            : 'toast.invalidFile',
        ),
      );
    }
  };
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

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
          src: thumbnailDataUrl(renderPreview(model, dark, { sheet: false })),
        };
      }),
    [locale, dark],
  );
  const showcase = previews.find((p) => p.template.id === 'microservices') ?? previews[0];
  const yours = useMemo(
    () =>
      templates.flatMap((meta) => {
        const preview = templatePreviews.previews.get(meta.id);
        return preview ? [{ meta, model: preview.model, src: preview.src }] : [];
      }),
    [templates, templatePreviews.previews],
  );

  const showTemplates = () =>
    document
      .getElementById('library-start')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // The mark, pressed while already home: back to the whole list, at the top.
  const goHome = () => {
    setQuery('');
    setFolder(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const section = useActiveSection(SECTIONS, !loading);

  // The key the field advertises. A dialog on top keeps it: the picker and the
  // confirmation have the keyboard, and a search behind them is not the point.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      if (picking || deleting || document.querySelector('.dialog')) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking, deleting]);

  return (
    <div
      className={`library${dragDepth > 0 ? ' is-dropping' : ''}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={(e) => void onDrop(e)}
    >
      {dragDepth > 0 && (
        <div className="library-drop" aria-hidden="true">
          <span className="library-drop-card">
            <ImportIcon size={22} />
            {t('library.dropHint')}
          </span>
        </div>
      )}
      {notice && (
        <p className="library-notice" role="status">
          {notice}
        </p>
      )}
      <LibraryHeader
        t={t}
        dark={dark}
        section={section}
        authState={authState}
        user={user}
        displayName={displayName}
        onHome={goHome}
        onRefresh={refresh}
        onToggleTheme={toggleTheme}
        onSignOut={signOut}
        onNew={() => setPicking(true)}
      />

      {/* The one place in the app with room to say what it is: the words on
          the left, and on the right a window onto a real drawing — a template
          on a first visit; once there is work here, the diagram touched last. */}
      <LibraryHero
        t={t}
        loading={loading}
        showcase={showcase}
        recent={
          latest ? { meta: latest, preview: diagramPreviews.previews.get(latest.id) } : undefined
        }
        onNew={() => setPicking(true)}
        onBrowseTemplates={showTemplates}
        onPick={(title, model) => void create(title, model)}
        onOpen={(meta) => router.push(`/d/${meta.id}`)}
      />

      <main className="library-main">
        <section className="library-body" id="library-body">
          <LibraryToolbar
            t={t}
            query={query}
            onQuery={setQuery}
            searchRef={searchRef}
            visibleCount={visible.length}
            total={items.length}
            sort={sort}
            onSort={setSort}
            folders={folders}
            folder={folder}
            onFolder={setFolder}
            starredCount={starredCount}
          />

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
              <p>{t('library.emptyHint')}</p>
              <div className="library-empty-actions">
                <button
                  type="button"
                  className="button is-primary"
                  onClick={() => setPicking(true)}
                >
                  {t('library.heroCta')}
                </button>
                <button type="button" className="button is-ghost" onClick={showTemplates}>
                  {t('library.browseTemplates')}
                </button>
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
            <ul className={`library-grid${entering ? ' is-entering' : ''}`}>
              {visible.map((item, index) => (
                <DiagramCard
                  key={item.id}
                  t={t}
                  item={item}
                  index={index}
                  starred={starred.has(item.id)}
                  preview={diagramPreviews.previews.get(item.id)}
                  observe={diagramPreviews.observe}
                  onOpen={() => router.push(`/d/${item.id}`)}
                  onToggleStar={() => {
                    // Un-starring the last favourite while looking at favourites
                    // would leave an empty page with no chip to leave it by.
                    if (folder === FAVOURITES && starred.has(item.id) && starredCount === 1) {
                      setFolder(null);
                    }
                    toggleFavourite(item.id);
                  }}
                  onDuplicate={() => void repository.duplicate(item.id).then(refresh)}
                  onRemove={() => setDeleting(item)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Starting points, always: a real drawing of each, not an icon. */}
        {!loading && (
          <TemplateGallery
            t={t}
            previews={previews}
            yours={yours}
            entering={entering}
            onPick={(title, model) => void create(title, model)}
            onEdit={(meta) => router.push(`/d/${meta.id}`)}
            onRemove={(meta) => setDeleting(meta)}
          />
        )}
      </main>

      <footer className="library-footer">
        <span>AC Graph · AION Cloud</span>
        {buildStamp(locale) && <span>{t('app.build', { when: buildStamp(locale) })}</span>}
      </footer>

      {confirm.shown && (
        <ConfirmDialog
          t={t}
          closing={confirm.closing}
          onExited={confirm.onExited}
          message={t(
            confirm.shown.role && confirm.shown.role !== 'owner'
              ? 'library.leaveConfirm'
              : 'library.confirmDelete',
            { title: confirm.shown.title },
          )}
          confirmLabel={t(
            confirm.shown.role && confirm.shown.role !== 'owner' ? 'share.leave' : 'action.delete',
          )}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const target = confirm.shown!;
            setDeleting(null);
            // Leaving a shared diagram removes only our own membership; deleting is the owner's.
            const gone =
              target.role && target.role !== 'owner' && membersApi
                ? membersApi.removeMember(target.id, user.id)
                : repository.delete(target.id);
            void gone.then(refresh);
          }}
        />
      )}

      {pick.shown && (
        <NewDiagramDialog
          t={t}
          closing={pick.closing}
          onExited={pick.onExited}
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
