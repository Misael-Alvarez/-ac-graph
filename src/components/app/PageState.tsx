'use client';

import Link from 'next/link';
import { AcMark } from '@/components/brand/AcGraphLogo';
import { useLocale } from '@/lib/i18n/useLocale';

/**
 * The screen the app shows when a route has nothing to show: a missing page,
 * or an error the boundary caught.
 *
 * Same material and voice as everything else — a title, one plain line about
 * what happened and what is safe, and the way out — rather than the browser's
 * own blank page or Next's default. The reader is told their work is kept,
 * because that is the first thing anybody wonders when a screen breaks.
 */
export function PageState({
  kind,
  onRetry,
}: {
  kind: 'not-found' | 'error';
  onRetry?: () => void;
}) {
  const { t } = useLocale();
  const title = kind === 'error' ? t('page.errorTitle') : t('page.notFoundTitle');
  const hint = kind === 'error' ? t('page.errorHint') : t('page.notFoundHint');
  return (
    <main className={`page-state is-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <div className="page-state-card">
        <span className="page-state-mark" aria-hidden="true">
          <AcMark size={28} />
        </span>
        <h1 className="page-state-title">{title}</h1>
        <p className="page-state-hint">{hint}</p>
        <div className="page-state-actions">
          {onRetry && (
            <button type="button" className="button is-primary is-large" onClick={onRetry}>
              {t('page.retry')}
            </button>
          )}
          <Link href="/" className="button is-large is-ghost">
            {t('page.home')}
          </Link>
        </div>
      </div>
    </main>
  );
}
