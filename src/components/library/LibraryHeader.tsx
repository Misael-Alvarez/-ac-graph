'use client';

import Link from 'next/link';
import type { User } from '@/lib/domain';
import type { MessageKey } from '@/lib/i18n/messages';
import { AcGraphLogo } from '@/components/brand/AcGraphLogo';
import { LogOutIcon, MoonIcon, PlusIcon, SunIcon } from '@/components/icons/ToolIcons';
import type { AuthState } from '@/components/app/AuthProvider';
import { WorkspaceActions } from './WorkspaceActions';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** The page's two sections, by the id their nav pill points at. */
export type LibrarySection = 'library-body' | 'library-start';

/**
 * The library's top line: the mark, which is the way home; where you are, in
 * two pills; the workspace actions; the theme; who you are; and the one
 * button that starts something new.
 */
export function LibraryHeader({
  t,
  dark,
  section,
  authState,
  user,
  displayName,
  onHome,
  onRefresh,
  onToggleTheme,
  onSignOut,
  onNew,
}: {
  t: Translate;
  dark: boolean;
  /** The section the reader is in; its pill is the lit one. */
  section: LibrarySection;
  authState: AuthState;
  user: User;
  displayName: string;
  /** Pressed the mark while already home: the page clears its filters and scrolls up. */
  onHome: () => void;
  onRefresh: () => void;
  onToggleTheme: () => void;
  onSignOut: () => Promise<void> | void;
  onNew: () => void;
}) {
  return (
    <header className="library-header">
      <Link
        href="/"
        className="library-identity"
        aria-label={t('library.home')}
        title={t('library.home')}
        onClick={(event) => {
          // Already here: the mark resets the page rather than reloading it.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onHome();
        }}
      >
        <AcGraphLogo size={28} />
      </Link>
      {/* Where you are and where you can go, in the header itself: a home
          that is only a logo and two buttons reads as a page, not a place. */}
      <nav className="library-nav" aria-label={t('library.navLabel')}>
        <a
          className={`library-nav-link${section === 'library-body' ? ' is-active' : ''}`}
          href="#library-body"
          aria-current={section === 'library-body' ? 'location' : undefined}
        >
          {t('library.recent')}
        </a>
        <a
          className={`library-nav-link${section === 'library-start' ? ' is-active' : ''}`}
          href="#library-start"
          aria-current={section === 'library-start' ? 'location' : undefined}
        >
          {t('library.startPoints')}
        </a>
      </nav>
      <div className="library-header-actions">
        <WorkspaceActions onChanged={onRefresh} t={t} />
        <button
          type="button"
          className="icon-button"
          title={t('action.toggleTheme')}
          aria-label={t('action.toggleTheme')}
          aria-pressed={dark}
          onClick={onToggleTheme}
        >
          {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>
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
            onClick={() => void onSignOut()}
          >
            <LogOutIcon size={16} />
          </button>
        )}
        <button
          type="button"
          className="button is-primary"
          title={t('library.new')}
          aria-label={t('library.new')}
          onClick={onNew}
        >
          <PlusIcon size={15} />
          <span className="button-label">{t('library.new')}</span>
        </button>
      </div>
    </header>
  );
}
