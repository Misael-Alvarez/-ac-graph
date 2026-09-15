'use client';

import { useState } from 'react';
import { useUser } from '@/components/app/AuthProvider';
import { AcMark } from '@/components/brand/AcGraphLogo';
import {
  ChevronDownIcon,
  DocumentIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UserIcon,
} from '@/components/icons/ToolIcons';
import { buildStamp } from '@/lib/appConfig';
import { LOCAL_USER } from '@/lib/auth/user';
import { systemPrefersDark } from '@/lib/editor/systemTheme';
import { ACCENTS, THEME_MODES } from '@/lib/editor/uiState';
import { LOCALES, LOCALE_LABELS, type MessageKey } from '@/lib/i18n/messages';
import { useEditor } from '../EditorProvider';
import type { MenuProps } from './menuProps';
import { MenuGroup, MenuItem, MenuSeparator, TopBarMenu } from './TopBarMenu';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Who is signed in, and the preferences that are theirs: tone, language, the
 * brand footer on exports, signing out — or, in the browser-only editor, the
 * name shown to nobody but themself.
 */
export function AccountMenu({
  menu,
  onToggle,
  onClose,
}: Pick<MenuProps, 'menu' | 'onToggle' | 'onClose'>) {
  const { ui, dispatchUi, t } = useEditor();
  const { user, state: authState, signOut, rename } = useUser();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const displayName =
    user.id === LOCAL_USER.id && user.name === LOCAL_USER.name ? t('account.you') : user.name;
  const stamp = buildStamp(ui.locale);
  return (
    <div className="topbar-menu-host">
      <button
        type="button"
        className="user-button"
        aria-haspopup="menu"
        aria-expanded={ui.menu === 'account'}
        aria-label={t('account.title')}
        title={authState === 'authenticated' ? displayName : t('account.local')}
        onClick={() => onToggle()}
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
      {menu.shown === 'account' && (
        <TopBarMenu
          label={t('account.title')}
          onClose={onClose}
          closing={menu.closing}
          onExited={menu.onExited}
        >
          <p className="topbar-menu-note">
            {authState === 'authenticated'
              ? `${t('account.signedInAs')} ${user.name}${user.email ? ` · ${user.email}` : ''}`
              : t('account.localHint')}
            {stamp && <span className="topbar-menu-stamp">{t('app.build', { when: stamp })}</span>}
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
          <MenuGroup label={t('account.theme')} />
          {THEME_MODES.map((mode) => (
            <MenuItem
              key={mode}
              icon={
                mode === 'system' ? (
                  <MonitorIcon size={15} />
                ) : mode === 'light' ? (
                  <SunIcon size={15} />
                ) : (
                  <MoonIcon size={15} />
                )
              }
              label={t(`theme.${mode}` as MessageKey)}
              active={ui.theme === mode}
              onSelect={() =>
                dispatchUi({ type: 'setTheme', theme: mode, systemDark: systemPrefersDark() })
              }
            />
          ))}
          <MenuSeparator />
          <MenuGroup label={t('account.language')} />
          {LOCALES.map((locale) => (
            <MenuItem
              key={locale}
              label={LOCALE_LABELS[locale]}
              active={ui.locale === locale}
              onSelect={() => {
                dispatchUi({ type: 'setLocale', locale });
                onClose();
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
                  onClose();
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
                    onClose();
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
                      user.id === LOCAL_USER.id && user.name === LOCAL_USER.name ? '' : user.name,
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
  );
}
