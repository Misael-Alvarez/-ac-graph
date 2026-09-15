'use client';

import {
  useCallback,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AcMark } from '@/components/brand/AcGraphLogo';
import { EyeIcon, EyeOffIcon } from '@/components/icons/ToolIcons';
import type { MessageKey } from '@/lib/i18n/messages';
import { useLocale } from '@/lib/i18n/useLocale';
import { exitProps, usePresence } from '@/lib/editor/usePresence';
import { useAppConfig } from './AppConfigProvider';
import { useUser, type SignInFailure } from './AuthProvider';

/**
 * In server mode, nothing renders until the server has said who this is.
 *
 * The gate is a page rather than a redirect so a person arriving from a shared
 * link sees what they are signing in to, and so the return path survives the
 * round trip through an identity provider. With local accounts the page *is*
 * the login: an e-mail and a password, and — when the server allows it — a
 * second face of the same card that creates the account and signs it in.
 *
 * It arrives once (a rare event, so it may take 320 ms to settle) and leaves
 * once, faster, over the app it has just let in: `usePresence` keeps it on
 * screen for the exit, as every other surface that animates in does here.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const { state } = useUser();
  const { config } = useAppConfig();
  const { t } = useLocale();
  const gate = usePresence(state === 'anonymous');

  return (
    <>
      {(state === 'local' || state === 'authenticated') && children}
      {state === 'loading' && (
        <div className="signin" aria-busy="true">
          <div className="signin-card is-quiet">
            <AcMark size={28} animate />
            <p className="signin-subtitle">{t('library.loading')}</p>
          </div>
        </div>
      )}
      {gate.shown && (
        <main
          key={gate.key}
          className="signin"
          aria-label={t('signin.title')}
          {...exitProps(gate.closing, gate.onExited)}
        >
          <div className="signin-card">
            <header className="signin-brand">
              <AcMark size={20} title="AC Graph" />
              <span className="signin-brand-name">{t('signin.title')}</span>
            </header>
            {config.auth?.provider === 'local' ? (
              <PasswordForm signupOpen={config.auth.signup} />
            ) : (
              <ProviderPrompt />
            )}
          </div>
        </main>
      )}
    </>
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
      <div className="signin-heading">
        <h1 className="signin-title">{t('signin.titleSignIn')}</h1>
        <p className="signin-subtitle">{t('signin.subtitle')}</p>
      </div>
      {failed && (
        <p className="signin-error" role="alert">
          {t('signin.error')}
        </p>
      )}
      <a className="button is-primary signin-submit" href={loginUrl()}>
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

/** The same rule the server applies, so a typo is caught before the round trip. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 10;

type FieldName = 'name' | 'email' | 'password';

/**
 * E-mail and password, with "create an account" as a second face of the same
 * card rather than a second page: what has been typed stays, the name field
 * unfolds above it, the title and the button say what will happen.
 *
 * Mistakes are caught where they are made — an e-mail without an `@`, a
 * password too short — and said beside the field, before anything is sent.
 * What only the server can know (a wrong password, a taken e-mail) comes back
 * as one line above the button. The button never changes width while it
 * waits: the label fades and a spinner takes its place.
 */
function PasswordForm({ signupOpen }: { signupOpen: boolean }) {
  const { signIn, register } = useUser();
  const { t } = useLocale();
  const ids = { name: useId(), email: useId(), password: useId(), error: useId() };
  const [face, setFace] = useState<'signin' | 'signup'>('signin');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, MessageKey>>>({});
  const [formError, setFormError] = useState<SignInFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const focusField = (field: FieldName) => {
    const target = field === 'name' ? nameRef : field === 'email' ? emailRef : passwordRef;
    target.current?.focus();
  };

  const creating = face === 'signup' && signupOpen;

  const set = (field: FieldName) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    // A field being corrected stops being wrong the moment it changes; the
    // verdict comes back on the next submit, not on every keystroke.
    if (fieldErrors[field]) setFieldErrors((e) => ({ ...e, [field]: undefined }));
    if (formError) setFormError(null);
  };

  const validate = (): Partial<Record<FieldName, MessageKey>> => {
    const errors: Partial<Record<FieldName, MessageKey>> = {};
    if (creating && !values.name.trim()) errors.name = 'signin.nameRequired';
    if (!EMAIL.test(values.email.trim())) errors.email = 'signin.emailInvalid';
    if (values.password.length < PASSWORD_MIN) errors.password = 'signin.passwordShort';
    return errors;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const errors = validate();
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      const first = (['name', 'email', 'password'] as const).find((f) => errors[f]);
      if (first) focusField(first);
      return;
    }
    setBusy(true);
    setFormError(null);
    const email = values.email.trim();
    const result = creating
      ? await register(values.name.trim(), email, values.password)
      : await signIn(email, values.password);
    setBusy(false);
    if (result.ok) return; // the provider holds the user: the gate leaves on its own
    if (result.error === 'email_taken') {
      setFieldErrors({ email: 'signin.emailTaken' });
      focusField('email');
      return;
    }
    setFormError(result.error);
    if (result.error === 'invalid_credentials') {
      // Which one was wrong is never said, so both are the place to look; the
      // password is the likelier slip and gets the caret.
      passwordRef.current?.select();
    }
  };

  const switchFace = () => {
    setFace(creating ? 'signin' : 'signup');
    setFieldErrors({});
    setFormError(null);
    // The field that just unfolded is the one to type into next.
    requestAnimationFrame(() => focusField(creating ? 'email' : 'name'));
  };

  const onPasswordKey = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState('CapsLock'));
  }, []);

  const submitLabel = t(creating ? 'signin.create' : 'signin.enter');
  const describedBy = (field: FieldName, hintId?: string) =>
    [fieldErrors[field] ? `${ids[field]}-error` : null, hintId ?? null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <>
      <div className="signin-heading">
        <h1 className="signin-title">
          {t(creating ? 'signin.titleCreate' : 'signin.titleSignIn')}
        </h1>
        <p className="signin-subtitle">
          {t(creating ? 'signin.subtitleCreate' : 'signin.subtitlePassword')}
        </p>
      </div>

      <form className="signin-form" onSubmit={onSubmit} noValidate data-busy={busy || undefined}>
        {/* The name field unfolds when the card turns to creating an account:
            a grid row growing from nothing, so the fields below slide rather
            than jump. Out of the tab order and the tree while folded. */}
        <div className="signin-reveal" data-open={creating ? '' : undefined}>
          <div className="signin-reveal-inner" aria-hidden={!creating} inert={!creating}>
            <div className="signin-field" data-invalid={fieldErrors.name ? '' : undefined}>
              <label className="signin-label" htmlFor={ids.name}>
                {t('signin.name')}
              </label>
              <input
                ref={nameRef}
                id={ids.name}
                className="input signin-input"
                type="text"
                name="name"
                autoComplete="name"
                autoCapitalize="words"
                maxLength={120}
                value={values.name}
                onChange={(e) => set('name')(e.target.value)}
                aria-invalid={fieldErrors.name ? true : undefined}
                aria-describedby={describedBy('name')}
              />
              <FieldError id={`${ids.name}-error`} messageKey={fieldErrors.name} />
            </div>
          </div>
        </div>

        <div className="signin-field" data-invalid={fieldErrors.email ? '' : undefined}>
          <label className="signin-label" htmlFor={ids.email}>
            {t('signin.email')}
          </label>
          <input
            ref={emailRef}
            id={ids.email}
            className="input signin-input"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={values.email}
            onChange={(e) => set('email')(e.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={describedBy('email')}
          />
          <FieldError id={`${ids.email}-error`} messageKey={fieldErrors.email} />
        </div>

        <div className="signin-field" data-invalid={fieldErrors.password ? '' : undefined}>
          <label className="signin-label" htmlFor={ids.password}>
            {t('signin.password')}
          </label>
          <div className="signin-input-wrap">
            <input
              ref={passwordRef}
              id={ids.password}
              className="input signin-input has-trailing"
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete={creating ? 'new-password' : 'current-password'}
              minLength={PASSWORD_MIN}
              maxLength={200}
              value={values.password}
              onChange={(e) => set('password')(e.target.value)}
              onKeyDown={onPasswordKey}
              onKeyUp={onPasswordKey}
              onBlur={() => setCapsLock(false)}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={describedBy(
                'password',
                creating ? `${ids.password}-hint` : undefined,
              )}
            />
            <button
              type="button"
              className="signin-trailing"
              aria-label={t(showPassword ? 'signin.hidePassword' : 'signin.showPassword')}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((s) => !s)}
            >
              {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>
          <FieldError id={`${ids.password}-error`} messageKey={fieldErrors.password} />
          {/* Caps Lock is the commonest reason a right password is wrong;
              saying so is cheaper than a failed attempt. */}
          {capsLock && !fieldErrors.password && (
            <small className="signin-hint is-caps" role="status">
              {t('signin.capsLock')}
            </small>
          )}
          {creating && !fieldErrors.password && !capsLock && (
            <small
              id={`${ids.password}-hint`}
              className="signin-hint"
              data-met={values.password.length >= PASSWORD_MIN ? '' : undefined}
            >
              {t('signin.passwordHint')}
            </small>
          )}
        </div>

        {formError && (
          <p className="signin-error" role="alert" id={ids.error}>
            {t(FAILURE_KEYS[formError])}
          </p>
        )}

        <button
          type="submit"
          className="button is-primary signin-submit"
          disabled={busy}
          aria-busy={busy}
          aria-describedby={formError ? ids.error : undefined}
        >
          <span className="signin-submit-label">{submitLabel}</span>
          <span className="signin-spinner" aria-hidden="true" />
          {busy && (
            <span className="sr-only" role="status">
              {t(creating ? 'signin.creating' : 'signin.entering')}
            </span>
          )}
        </button>
      </form>

      {signupOpen && (
        <p className="signin-switch">
          {t(creating ? 'signin.haveAccount' : 'signin.noAccount')}{' '}
          <button type="button" className="signin-switch-action" onClick={switchFace}>
            {t(creating ? 'signin.haveAccountAction' : 'signin.noAccountAction')}
          </button>
        </p>
      )}
      <p className="signin-note">{t('signin.notePassword')}</p>
    </>
  );
}

/** The line under a field that is wrong. Rendered only when there is one. */
function FieldError({ id, messageKey }: { id: string; messageKey?: MessageKey }) {
  const { t } = useLocale();
  if (!messageKey) return null;
  return (
    <small id={id} className="signin-field-error" role="alert">
      {t(messageKey)}
    </small>
  );
}
