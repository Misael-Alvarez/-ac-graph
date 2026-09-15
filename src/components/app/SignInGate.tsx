'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { AcMark } from '@/components/brand/AcGraphLogo';
import type { MessageKey } from '@/lib/i18n/messages';
import { useLocale } from '@/lib/i18n/useLocale';
import { useAppConfig } from './AppConfigProvider';
import { useUser, type SignInFailure } from './AuthProvider';

/**
 * In server mode, nothing renders until the server has said who this is.
 *
 * The gate is a page rather than a redirect so a person arriving from a shared
 * link sees what they are signing in to, and so the return path survives the
 * round trip through an identity provider. With local accounts the page *is*
 * the login: an e-mail and a password, and — when the server allows it — a
 * second face that creates the account and signs it in at once.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const { state } = useUser();
  const { config } = useAppConfig();
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

  return (
    <main className="signin">
      <div className="signin-card">
        <AcMark size={40} animate title="AC Graph" />
        <h1 className="signin-title">{t('signin.title')}</h1>
        {config.auth?.provider === 'local' ? (
          <PasswordForm signupOpen={config.auth.signup} />
        ) : (
          <ProviderPrompt />
        )}
      </div>
    </main>
  );
}

/** The one button of a deployment that signs people in through a provider. */
function ProviderPrompt() {
  const { loginUrl } = useUser();
  const { t } = useLocale();
  const failed =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('auth_error');
  return (
    <>
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
    </>
  );
}

const FAILURE_KEYS: Record<SignInFailure, MessageKey> = {
  invalid_credentials: 'signin.invalid',
  email_taken: 'signin.emailTaken',
  signup_closed: 'signin.signupClosed',
  rate_limited: 'signin.rateLimited',
  bad_request: 'signin.badRequest',
  forbidden: 'signin.forbidden',
  unavailable: 'signin.unavailable',
};

/**
 * E-mail and password, with "create an account" as a second face of the same
 * card rather than a second page: the fields people have already typed stay.
 */
function PasswordForm({ signupOpen }: { signupOpen: boolean }) {
  const { signIn, register } = useUser();
  const { t } = useLocale();
  const ids = { name: useId(), email: useId(), password: useId() };
  const [face, setFace] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SignInFailure | null>(null);

  const creating = face === 'signup' && signupOpen;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = creating ? await register(name, email, password) : await signIn(email, password);
    setBusy(false);
    if (!result.ok) setFailure(result.error);
    // On success the provider already holds the user: the gate re-renders
    // straight into the app, with the same URL the person arrived at.
  };

  return (
    <form className="signin-form" onSubmit={onSubmit} noValidate>
      <p className="signin-subtitle">
        {t(creating ? 'signin.subtitleCreate' : 'signin.subtitlePassword')}
      </p>
      {creating && (
        <label className="signin-field" htmlFor={ids.name}>
          <span>{t('signin.name')}</span>
          <input
            id={ids.name}
            className="input"
            type="text"
            name="name"
            autoComplete="name"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      <label className="signin-field" htmlFor={ids.email}>
        <span>{t('signin.email')}</span>
        <input
          id={ids.email}
          className="input"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="signin-field" htmlFor={ids.password}>
        <span>{t('signin.password')}</span>
        <input
          id={ids.password}
          className="input"
          type="password"
          name="password"
          autoComplete={creating ? 'new-password' : 'current-password'}
          required
          minLength={10}
          maxLength={200}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {creating && <small className="signin-hint">{t('signin.passwordHint')}</small>}
      </label>
      {failure && (
        <p className="ai-error" role="alert">
          {t(FAILURE_KEYS[failure])}
        </p>
      )}
      <button type="submit" className="button is-primary" disabled={busy} aria-busy={busy}>
        {t(creating ? 'signin.create' : 'signin.enter')}
      </button>
      {signupOpen && (
        <button
          type="button"
          className="signin-switch"
          onClick={() => {
            setFace(creating ? 'signin' : 'signup');
            setFailure(null);
          }}
        >
          {t(creating ? 'signin.haveAccount' : 'signin.noAccount')}
        </button>
      )}
      <p className="signin-note">{t('signin.notePassword')}</p>
    </form>
  );
}
