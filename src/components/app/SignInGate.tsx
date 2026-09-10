'use client';

import type { ReactNode } from 'react';
import { AcMark } from '@/components/brand/AcGraphLogo';
import { useLocale } from '@/lib/i18n/useLocale';
import { useUser } from './AuthProvider';

/**
 * In server mode, nothing renders until Authentik has said who this is.
 *
 * The gate is a page rather than a redirect so a person arriving from a shared
 * link sees what they are signing in to, and so the return path survives the
 * round trip through the identity provider.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const { state, loginUrl } = useUser();
  const { t } = useLocale();

  if (state === 'local' || state === 'authenticated') return <>{children}</>;

  if (state === 'loading') {
    return (
      <div className="signin" aria-busy="true">
        <div className="signin-card">
          <AcMark size={36} animate />
          <p className="signin-subtitle">{t('library.loading')}</p>
        </div>
      </div>
    );
  }

  const failed =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('auth_error');

  return (
    <main className="signin">
      <div className="signin-card">
        <AcMark size={40} animate title="AC Graph" />
        <h1 className="signin-title">{t('signin.title')}</h1>
        <p className="signin-subtitle">{t('signin.subtitle')}</p>
        {failed && (
          <p className="ai-error" role="alert">
            {t('signin.error')}
          </p>
        )}
        <a className="button is-primary" href={loginUrl()}>
          {t('signin.action')}
        </a>
        <p className="signin-note">{t('signin.note')}</p>
      </div>
    </main>
  );
}
