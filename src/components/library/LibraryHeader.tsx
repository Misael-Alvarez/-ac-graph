'use client';

import type { User } from '@/lib/domain';
import type { MessageKey } from '@/lib/i18n/messages';
import { AcGraphLogo } from '@/components/brand/AcGraphLogo';
import { LogOutIcon, MoonIcon, PlusIcon, SunIcon } from '@/components/icons/ToolIcons';
import type { AuthState } from '@/components/app/AuthProvider';
import { WorkspaceActions } from './WorkspaceActions';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * The library's top line: the mark, where you are, the workspace actions, the
 * theme, who you are, and the one button that starts something new.
 */
export function LibraryHeader({
  t,
  dark,
  authState,
  user,
  displayName,
  onRefresh,
  onToggleTheme,
  onSignOut,
  onNew,
}: {
  t: Translate;
  dark: boolean;
  authState: AuthState;
  user: User;
  displayName: string;
  onRefresh: () => void;
  onToggleTheme: () => void;
  onSignOut: () => Promise<void> | void;
  onNew: () => void;
}) {
  return (
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
          onClick={() => void onSignOut()}
        >
          <LogOutIcon size={16} />
        </button>
      )}
      <button type="button" className="button is-primary" onClick={onNew}>
        <PlusIcon size={15} />
        {t('library.new')}
      </button>
    </header>
  );
}
