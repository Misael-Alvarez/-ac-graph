'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AcMark } from '@/components/brand/AcGraphLogo';
import { useUser } from '@/components/app/AuthProvider';
import { LOCAL_USER } from '@/lib/auth/user';
import { buildStamp } from '@/lib/appConfig';
import { LOCALES, LOCALE_LABELS, type MessageKey } from '@/lib/i18n/messages';
import { ACCENTS } from '@/lib/editor/uiState';
import type { SaveStatus } from '@/components/app/useDiagramDocument';
import { spellChord } from '@/lib/editor/platform';
import { shortcutFor } from '@/lib/editor/shortcuts';
import { useEditor } from '../EditorProvider';
import { useCommands } from '../hooks/useCommands';
import type { Collaboration } from '../hooks/useCollaboration';
import { PresenceStack } from './Presence';
import { MenuGroup, MenuItem, MenuSeparator, TopBarMenu } from './TopBarMenu';
import {
  ArrowLeftIcon,
  AutoLayoutIcon,
  BracesIcon,
  ChartIcon,
  ChevronDownIcon,
  CloudIcon,
  CodeIcon,
  DocumentIcon,
  DownloadIcon,
  EraseIcon,
  FileTextIcon,
  FitIcon,
  FolderIcon,
  GridIcon,
  HistoryIcon,
  ImageIcon,
  ImportIcon,
  KeyboardIcon,
  ListIcon,
  LogOutIcon,
  MapIcon,
  MoonIcon,
  MoreIcon,
  PrintIcon,
  RedoIcon,
  SaveIcon,
  SearchIcon,
  ShareIcon,
  SparkleIcon,
  SunIcon,
  TemplateIcon,
  UndoIcon,
  UserIcon,
  VectorIcon,
  ZoomOutIcon,
} from '@/components/icons/ToolIcons';

interface TopBarProps {
  title: string;
  status: SaveStatus;
  onRename: (title: string) => void;
  collab: Collaboration;
}

const STATUS_KEY = {
  saved: 'status.saved',
  pending: 'status.pending',
  saving: 'status.saving',
  error: 'status.error',
  conflict: 'status.conflict',
} as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * The top bar: where the document is, who is here, and every way out of it.
 *
 * Export lives here rather than only in the palette because handing a diagram
 * to somebody is the most common thing done with one after drawing it — it
 * should not need a search to find. The same reasoning put the panels and the
 * canvas tools either side of the search: opening the service browser, the
 * code view, the history or the analysis, and fitting or tidying the drawing,
 * are the things done ten times an hour. A search is a fine way to reach the
 * thirtieth command and a poor way to reach the fourth.
 */
export function TopBar({ title, status, onRename, collab }: TopBarProps) {
  const { ui, dispatchUi, canUndo, canRedo, t } = useEditor();
  const { user, state: authState, signOut, rename } = useUser();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const commands = useCommands();
  const router = useRouter();
  const displayName =
    user.id === LOCAL_USER.id && user.name === LOCAL_USER.name ? t('account.you') : user.name;
  const stamp = buildStamp(ui.locale);
  const run = (id: string) => commands.find((c) => c.id === id)?.run();
  const closeMenu = useCallback(() => dispatchUi({ type: 'setMenu', menu: null }), [dispatchUi]);
  const toggleMenu = (menu: 'export' | 'account' | 'more') =>
    dispatchUi({ type: 'setMenu', menu: ui.menu === menu ? null : menu });
  /** An icon button that runs a command and shows its shortcut on hover. */
  const tool = (id: string, icon: React.ReactNode, pressed?: boolean) => {
    const cmd = commands.find((c) => c.id === id);
    if (!cmd) return null;
    const hint = chord(id);
    return (
      <button
        key={id}
        type="button"
        className={`icon-button${pressed ? ' is-on' : ''}`}
        title={hint ? `${cmd.label} · ${hint}` : cmd.label}
        aria-label={cmd.label}
        aria-pressed={pressed}
        disabled={cmd.enabled === false}
        onClick={() => cmd.run()}
      >
        {icon}
      </button>
    );
  };
  const pick = (id: string) => {
    closeMenu();
    run(id);
  };
  const chord = (id: string) => {
    const keys = shortcutFor(id);
    return keys ? spellChord(keys) : undefined;
  };

  return (
    <header className="topbar">
      <div className="topbar-identity">
        <button
          type="button"
          className="topbar-back"
          title={t('library.back')}
          aria-label={t('library.back')}
          onClick={() => router.push('/')}
        >
          {/* The app's own mark doubles as the way out: it is where every
              product of this shape puts the way back to the file list. */}
          <AcMark size={18} className="topbar-back-mark" />
          <ArrowLeftIcon size={16} className="topbar-back-arrow" />
        </button>

        <input
          className="topbar-name"
          value={title}
          aria-label={t('inspector.label')}
          spellCheck={false}
          onChange={(e) => onRename(e.target.value)}
        />
        {/* Keyed on the status so the check draws itself again each time a
            save lands: the moment work becomes safe is worth a small flourish. */}
        <span key={status} className={`save-status is-${status}`} role="status">
          {status === 'saved' ? (
            <svg className="save-check" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 6.5 5 9l4.5-6" />
            </svg>
          ) : (
            <span className="save-dot" aria-hidden="true" />
          )}
          {t(STATUS_KEY[status])}
        </span>
        <PresenceStack collab={collab} />
      </div>

      <div className="topbar-center">
        {/* The panels: each one a place to look at the same architecture. */}
        <div className="topbar-group topbar-panels" role="group" aria-label={t('topbar.panels')}>
          {tool('toggleBrowser', <ListIcon size={16} />, ui.browserOpen)}
          {tool('toggleCode', <CodeIcon size={16} />, ui.codeOpen)}
          {tool('toggleVersions', <HistoryIcon size={16} />, ui.versionsOpen)}
          {tool('insights', <ChartIcon size={16} />, ui.insightsOpen)}
        </div>

        <button
          type="button"
          className="topbar-search"
          onClick={() => dispatchUi({ type: 'setPaletteOpen', open: true })}
        >
          <SearchIcon size={14} />
          <span>{t('palette.placeholder')}</span>
          <kbd>{chord('palette')}</kbd>
        </button>

        {/* The canvas: frame it, tidy it, snap it. */}
        <div className="topbar-group topbar-canvas" role="group" aria-label={t('topbar.canvas')}>
          {tool('zoomFit', <FitIcon size={16} />)}
          {tool('autoLayout', <AutoLayoutIcon size={16} />)}
          {tool('toggleGrid', <GridIcon size={16} />, ui.gridSnap)}
        </div>
      </div>

      <div className="topbar-actions">
        <div className="topbar-group" role="group" aria-label={t('shortcuts.edit')}>
          <button
            type="button"
            className="icon-button"
            disabled={!canUndo}
            title={`${t('action.undo')} · ${chord('undo')}`}
            aria-label={t('action.undo')}
            onClick={() => run('undo')}
          >
            <UndoIcon size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            disabled={!canRedo}
            title={`${t('action.redo')} · ${chord('redo')}`}
            aria-label={t('action.redo')}
            onClick={() => run('redo')}
          >
            <RedoIcon size={16} />
          </button>
        </div>

        <button
          type="button"
          className="icon-button"
          title={`${t('action.toggleTheme')} · ${chord('toggleTheme')}`}
          aria-label={t('action.toggleTheme')}
          aria-pressed={ui.dark}
          onClick={() => dispatchUi({ type: 'toggleDark' })}
        >
          {ui.dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>

        <span className="topbar-divider" />

        <div className="topbar-menu-host">
          <button
            type="button"
            className="button"
            title={`${t('export.title')} · ${chord('exportMenu')}`}
            aria-label={t('export.title')}
            aria-haspopup="menu"
            aria-expanded={ui.menu === 'export'}
            onClick={() => toggleMenu('export')}
          >
            <DownloadIcon size={15} />
            <span className="button-label">{t('export.title')}</span>
            <ChevronDownIcon size={12} />
          </button>
          {ui.menu === 'export' && (
            <TopBarMenu label={t('export.title')} onClose={closeMenu}>
              <p className="topbar-menu-note">{t('export.subtitle')}</p>
              <MenuGroup label={t('export.image')} />
              <MenuItem
                icon={<ImageIcon size={15} />}
                label={t('export.png')}
                hint={t('export.pngHint')}
                onSelect={() => pick('exportPng')}
              />
              <MenuItem
                icon={<VectorIcon size={15} />}
                label={t('export.svg')}
                hint={t('export.svgHint')}
                onSelect={() => pick('exportSvg')}
              />
              <MenuItem
                icon={<PrintIcon size={15} />}
                label={t('export.pdf')}
                hint={t('export.pdfHint')}
                onSelect={() => pick('exportPdf')}
              />
              <MenuSeparator />
              <MenuGroup label={t('export.document')} />
              <MenuItem
                icon={<FileTextIcon size={15} />}
                label={t('export.markdown')}
                hint={t('export.markdownHint')}
                onSelect={() => pick('exportMarkdown')}
              />
              <MenuItem
                icon={<DocumentIcon size={15} />}
                label={t('export.mermaid')}
                hint={t('export.mermaidHint')}
                onSelect={() => pick('exportMermaid')}
              />
              <MenuSeparator />
              <MenuGroup label={t('export.code')} />
              <MenuItem
                icon={<BracesIcon size={15} />}
                label={t('export.yaml')}
                hint={t('export.yamlHint')}
                onSelect={() => pick('exportYaml')}
              />
              <MenuItem
                icon={<BracesIcon size={15} />}
                label={t('export.json')}
                hint={t('export.jsonHint')}
                shortcut={chord('saveProject')}
                onSelect={() => pick('saveProject')}
              />
            </TopBarMenu>
          )}
        </div>

        <button
          type="button"
          className="button"
          title={`${t('action.ai')} · ${chord('ai')}`}
          aria-label={t('topbar.ai')}
          onClick={() => run('ai')}
        >
          <SparkleIcon size={15} />
          <span className="button-label">{t('topbar.ai')}</span>
        </button>
        <button
          type="button"
          className="button is-primary"
          title={`${t('action.share')} · ${chord('share')}`}
          aria-label={t('topbar.share')}
          onClick={() => run('share')}
        >
          <ShareIcon size={15} />
          <span className="button-label">{t('topbar.share')}</span>
        </button>

        {/* Everything done once a week lives one click away, not in a search. */}
        <div className="topbar-menu-host">
          <button
            type="button"
            className="icon-button"
            title={t('topbar.more')}
            aria-label={t('topbar.more')}
            aria-haspopup="menu"
            aria-expanded={ui.menu === 'more'}
            onClick={() => toggleMenu('more')}
          >
            <MoreIcon size={16} />
          </button>
          {ui.menu === 'more' && (
            <TopBarMenu label={t('topbar.more')} onClose={closeMenu}>
              <MenuGroup label={t('topbar.document')} />
              <MenuItem
                icon={<TemplateIcon size={15} />}
                label={t('action.templates')}
                onSelect={() => pick('templates')}
              />
              <MenuItem
                icon={<CloudIcon size={15} />}
                label={t('action.switchCloud')}
                onSelect={() => pick('switchCloud')}
              />
              <MenuItem
                icon={<ImportIcon size={15} />}
                label={t('action.importMarkdown')}
                onSelect={() => pick('importMarkdown')}
              />
              <MenuItem
                icon={<FolderIcon size={15} />}
                label={t('action.open')}
                onSelect={() => pick('openProject')}
              />
              <MenuItem
                icon={<SaveIcon size={15} />}
                label={t('action.save')}
                shortcut={chord('saveProject')}
                onSelect={() => pick('saveProject')}
              />
              <MenuSeparator />
              <MenuGroup label={t('topbar.canvas')} />
              <MenuItem
                icon={<ZoomOutIcon size={15} />}
                label={t('action.zoomReset')}
                shortcut={chord('zoomReset')}
                onSelect={() => pick('zoomReset')}
              />
              <MenuItem
                icon={<MapIcon size={15} />}
                label={t('action.toggleMinimap')}
                shortcut={chord('toggleMinimap')}
                active={ui.minimapOpen}
                onSelect={() => pick('toggleMinimap')}
              />
              <MenuItem
                icon={<ImportIcon size={15} />}
                label={t('action.icons')}
                hint={t('icons.uploadHint')}
                onSelect={() => pick('icons')}
              />
              <MenuItem
                icon={<KeyboardIcon size={15} />}
                label={t('action.shortcuts')}
                shortcut={chord('shortcuts')}
                onSelect={() => pick('shortcuts')}
              />
              <MenuSeparator />
              <MenuItem
                icon={<EraseIcon size={15} />}
                label={t('action.clear')}
                danger
                onSelect={() => pick('clear')}
              />
            </TopBarMenu>
          )}
        </div>

        <div className="topbar-menu-host">
          <button
            type="button"
            className="user-button"
            aria-haspopup="menu"
            aria-expanded={ui.menu === 'account'}
            aria-label={t('account.title')}
            title={authState === 'authenticated' ? displayName : t('account.local')}
            onClick={() => toggleMenu('account')}
          >
            <span className="user-avatar" aria-hidden="true">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- provider-hosted avatar
                <img src={user.avatarUrl} alt="" />
              ) : (
                initials(displayName)
              )}
            </span>
            <ChevronDownIcon size={12} />
          </button>
          {ui.menu === 'account' && (
            <TopBarMenu label={t('account.title')} onClose={closeMenu}>
              <p className="topbar-menu-note">
                {authState === 'authenticated'
                  ? `${t('account.signedInAs')} ${user.name}${user.email ? ` · ${user.email}` : ''}`
                  : t('account.localHint')}
                {stamp && (
                  <span className="topbar-menu-stamp">{t('app.build', { when: stamp })}</span>
                )}
              </p>
              <MenuSeparator />
              <MenuGroup label={t('account.tone')} />
              <div className="tone-row" role="radiogroup" aria-label={t('account.tone')}>
                {ACCENTS.map((accent) => (
                  <button
                    key={accent}
                    type="button"
                    role="radio"
                    aria-checked={ui.accent === accent}
                    className={`tone-swatch is-${accent}${ui.accent === accent ? ' is-active' : ''}`}
                    title={t(`tone.${accent}` as MessageKey)}
                    aria-label={t(`tone.${accent}` as MessageKey)}
                    onClick={() => dispatchUi({ type: 'setAccent', accent })}
                  />
                ))}
              </div>
              <MenuSeparator />
              <MenuGroup label={t('account.language')} />
              {LOCALES.map((locale) => (
                <MenuItem
                  key={locale}
                  label={LOCALE_LABELS[locale]}
                  active={ui.locale === locale}
                  onSelect={() => {
                    dispatchUi({ type: 'setLocale', locale });
                    closeMenu();
                  }}
                />
              ))}
              <MenuSeparator />
              <MenuItem
                icon={ui.brand === 'aion' ? <AcMark size={12} /> : <DocumentIcon size={15} />}
                label={t('account.brand')}
                active={ui.brand === 'aion'}
                onSelect={() => {
                  dispatchUi({ type: 'setBrand', brand: ui.brand === 'aion' ? 'none' : 'aion' });
                }}
              />
              {authState === 'authenticated' && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={<LogOutIcon size={15} />}
                    label={t('account.signOut')}
                    onSelect={() => {
                      closeMenu();
                      void signOut();
                    }}
                  />
                </>
              )}
              {authState === 'local' && (
                <>
                  <MenuSeparator />
                  {/* The local profile is editable, not a dead row: the name is
                      what other people see beside your cursor and on the
                      avatar, so it is worth being able to change it here. */}
                  {renaming ? (
                    <form
                      className="topbar-menu-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const next = nameDraft.trim();
                        if (next) rename(next);
                        setRenaming(false);
                        closeMenu();
                      }}
                    >
                      <input
                        className="input"
                        value={nameDraft}
                        autoFocus
                        maxLength={40}
                        aria-label={t('account.rename')}
                        placeholder={t('account.renamePlaceholder')}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setRenaming(false);
                        }}
                      />
                      <button type="submit" className="button is-primary is-small">
                        {t('account.renameSave')}
                      </button>
                    </form>
                  ) : (
                    <MenuItem
                      icon={<UserIcon size={15} />}
                      label={displayName}
                      hint={t('account.renameHint')}
                      onSelect={() => {
                        setNameDraft(
                          user.id === LOCAL_USER.id && user.name === LOCAL_USER.name
                            ? ''
                            : user.name,
                        );
                        setRenaming(true);
                      }}
                    />
                  )}
                </>
              )}
            </TopBarMenu>
          )}
        </div>
      </div>
    </header>
  );
}
