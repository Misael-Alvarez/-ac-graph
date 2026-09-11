'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AcMark } from '@/components/brand/AcGraphLogo';
import type { SaveStatus } from '@/components/app/useDiagramDocument';
import { spellChord } from '@/lib/editor/platform';
import { shortcutFor } from '@/lib/editor/shortcuts';
import { usePresence } from '@/lib/editor/usePresence';
import { Kbd } from '@/components/ui/Kbd';
import { useEditor } from '../EditorProvider';
import { useCommands } from '../hooks/useCommands';
import type { Collaboration } from '../hooks/useCollaboration';
import { PresenceStack } from './Presence';
import { AccountMenu } from './AccountMenu';
import { ExportMenu } from './ExportMenu';
import { MoreMenu } from './MoreMenu';
import {
  ArrowLeftIcon,
  AutoLayoutIcon,
  ChartIcon,
  CodeIcon,
  FitIcon,
  GridIcon,
  HistoryIcon,
  ListIcon,
  LockIcon,
  MoonIcon,
  RedoIcon,
  SearchIcon,
  ShareIcon,
  SparkleIcon,
  SunIcon,
  UndoIcon,
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
  const { ui, dispatchUi, canUndo, canRedo, readOnly, t } = useEditor();
  const commands = useCommands();
  const router = useRouter();
  const run = (id: string) => commands.find((c) => c.id === id)?.run();
  const closeMenu = useCallback(() => dispatchUi({ type: 'setMenu', menu: null }), [dispatchUi]);
  // The menu that is closing stays for its exit; the buttons report the real state.
  const menu = usePresence(ui.menu);
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
  /** True when the command exists and is currently disabled (a viewer, an empty selection). */
  const off = (id: string) => commands.find((c) => c.id === id)?.enabled === false;
  const label = (id: string) => commands.find((c) => c.id === id)?.label;
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
          readOnly={readOnly}
          onChange={(e) => onRename(e.target.value)}
        />
        {readOnly ? (
          /* Nothing is ever saved from here, so the save status would only mislead. */
          <span className="readonly-badge" role="status" title={t('readonly.hintNoOwner')}>
            <LockIcon size={12} />
            {t('readonly.badge')}
          </span>
        ) : (
          /* Keyed on the status so the check draws itself again each time a
             save lands: the moment work becomes safe is worth a small flourish. */
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
        )}
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
          <Kbd>{chord('palette')}</Kbd>
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

        <ExportMenu
          menu={menu}
          onToggle={() => toggleMenu('export')}
          onClose={closeMenu}
          pick={pick}
          chord={chord}
          off={off}
          label={label}
        />

        <button
          type="button"
          className="button"
          title={`${t('action.ai')} · ${chord('ai')}`}
          aria-label={t('topbar.ai')}
          disabled={off('ai')}
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

        <MoreMenu
          menu={menu}
          onToggle={() => toggleMenu('more')}
          onClose={closeMenu}
          pick={pick}
          chord={chord}
          off={off}
          label={label}
        />

        <AccountMenu menu={menu} onToggle={() => toggleMenu('account')} onClose={closeMenu} />
      </div>
    </header>
  );
}
