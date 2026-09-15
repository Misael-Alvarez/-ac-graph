'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AcMark } from '@/components/brand/AcGraphLogo';
import { CheckIcon, EyeIcon, EyeOffIcon } from '@/components/icons/ToolIcons';
import { notifyStoreChanged } from '@/lib/browserStore';
import { PREFERENCES_KEY, readPreferences } from '@/lib/editor/uiState';
import { exitProps, usePresence } from '@/lib/editor/usePresence';
import type { Locale, MessageKey } from '@/lib/i18n/messages';
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
            <LanguageSwitch />
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

/**
 * The other language, offered by its own name at the foot of the card. The
 * app keeps the choice with the rest of the preferences, so the page that
 * follows the sign-in speaks the same language the sign-in did.
 */
function LanguageSwitch() {
  const { locale, t } = useLocale();
  const other: Locale = locale === 'es' ? 'en' : 'es';
  const choose = () => {
    try {
      const current = readPreferences(window.localStorage);
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...current, locale: other }));
      notifyStoreChanged();
    } catch {
      // Storage refused: the page stays in the language it had.
    }
  };
  return (
    <button
      type="button"
      className="signin-language"
      lang={other}
      aria-label={t('signin.language')}
      onClick={choose}
    >
      {t('signin.otherLanguage')}
    </button>
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
type FieldErrors = Partial<Record<FieldName, MessageKey>>;

/**
 * E-mail and password, with "create an account" as a second face of the same
 * card rather than a second page: what has been typed stays, the name field
 * unfolds above it, the title and the button say what will happen.
 *
 * Mistakes are caught where they are made — an e-mail without an `@`, a
 * password too short — when the field is left and again on submit, and said
 * beside the field before anything is sent. What only the server can know (a
 * wrong password, a taken e-mail, too many tries) comes back as one line that
 * unfolds above the button, each with the way out: the password field
 * selected for another go, the e-mail marked, a count-down to the next try.
 * The button never changes size while it waits: the label fades and a
 * spinner takes its place.
 */
function PasswordForm({ signupOpen }: { signupOpen: boolean }) {
  const { signIn, register } = useUser();
  const { t } = useLocale();
  const ids = { name: useId(), email: useId(), password: useId(), error: useId() };
  const [face, setFace] = useState<'signin' | 'signup'>('signin');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<SignInFailure | null>(null);
  const [retryIn, setRetryIn] = useState(0);
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

  /* The caret goes to the e-mail on arrival — but only where there is a
     pointer to have moved it elsewhere. On a phone, focusing a field opens
     the keyboard over half the page before anyone has read the title. */
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) emailRef.current?.focus();
  }, []);

  /* After a 429 the server says how long to wait; the button waits with the
     person, counting down, and comes back on its own. */
  useEffect(() => {
    if (retryIn <= 0) return;
    const timer = setTimeout(() => {
      // The last second also clears the line: there is nothing left to wait for.
      setRetryIn((s) => s - 1);
      if (retryIn === 1) setFormError((error) => (error === 'rate_limited' ? null : error));
    }, 1000);
    return () => clearTimeout(timer);
  }, [retryIn]);

  const set = (field: FieldName) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    // A field being corrected stops being wrong the moment it changes; the
    // verdict comes back when it is left, or on the next submit.
    if (fieldErrors[field]) setFieldErrors((e) => ({ ...e, [field]: undefined }));
    if (formError && formError !== 'rate_limited') setFormError(null);
  };

  const check = (field: FieldName, current = values): MessageKey | undefined => {
    if (field === 'name')
      return creating && !current.name.trim() ? 'signin.nameRequired' : undefined;
    if (field === 'email')
      return EMAIL.test(current.email.trim()) ? undefined : 'signin.emailInvalid';
    return current.password.length < PASSWORD_MIN ? 'signin.passwordShort' : undefined;
  };

  /* On leaving a field that has something in it. An empty one is left alone:
     tabbing through to read is not a mistake, and the submit will say so. */
  const onBlur = (field: FieldName) => () => {
    if (!values[field]) return;
    const error = check(field);
    if (error) setFieldErrors((e) => ({ ...e, [field]: error }));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || retryIn > 0) return;
    const errors: FieldErrors = {};
    for (const field of ['name', 'email', 'password'] as const) {
      const error = check(field);
      if (error) errors[field] = error;
    }
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      const first = (['name', 'email', 'password'] as const).find((f) => errors[f]);
      if (first) focusField(first);
      return;
    }
    // The line above the button stays until there is a verdict to replace it
    // with: folding it on every try, to unfold it again a moment later, is a
    // twitch. Typing in any field has already cleared it.
    setBusy(true);
    const email = values.email.trim();
    const result = creating
      ? await register(values.name.trim(), email, values.password)
      : await signIn(email, values.password);
    // On success the provider already holds the user and the card is leaving:
    // the spinner stays for the exit rather than flashing the label back.
    if (result.ok) return;
    setBusy(false);
    if (result.error === 'email_taken') {
      setFormError(null);
      setFieldErrors({ email: 'signin.emailTaken' });
      focusField('email');
      return;
    }
    setFormError(result.error);
    if (result.error === 'rate_limited')
      setRetryIn(Math.max(1, Math.round(result.retryAfter ?? 30)));
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

  const waiting = retryIn > 0;
  const submitLabel = t(creating ? 'signin.create' : 'signin.enter');
  const passwordMet = values.password.length >= PASSWORD_MIN;
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
        <Reveal open={creating}>
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
              enterKeyHint="next"
              maxLength={120}
              value={values.name}
              onChange={(e) => set('name')(e.target.value)}
              onBlur={onBlur('name')}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={describedBy('name')}
            />
            <FieldError id={`${ids.name}-error`} messageKey={fieldErrors.name} />
          </div>
        </Reveal>

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
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            value={values.email}
            onChange={(e) => set('email')(e.target.value)}
            onBlur={onBlur('email')}
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
              enterKeyHint="go"
              minLength={PASSWORD_MIN}
              maxLength={200}
              value={values.password}
              onChange={(e) => set('password')(e.target.value)}
              onKeyDown={onPasswordKey}
              onKeyUp={onPasswordKey}
              onBlur={() => {
                setCapsLock(false);
                onBlur('password')();
              }}
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
              data-met={passwordMet ? '' : undefined}
            >
              {passwordMet && <CheckIcon size={12} />}
              {t('signin.passwordHint')}
            </small>
          )}
        </div>

        {/* What only the server could know, unfolding above the button so the
            button slides rather than jumps. */}
        <Reveal open={formError !== null}>
          {formError && (
            <div className="signin-error" role="alert" id={ids.error}>
              <p>
                {formError === 'rate_limited' && waiting
                  ? t('signin.rateLimitedIn', { seconds: retryIn })
                  : t(FAILURE_KEYS[formError])}
              </p>
              {formError === 'invalid_credentials' && (
                <p className="signin-error-help">{t('signin.invalidHelp')}</p>
              )}
            </div>
          )}
        </Reveal>

        <button
          type="submit"
          className="button is-primary signin-submit"
          disabled={busy || waiting}
          aria-busy={busy}
          aria-describedby={formError ? ids.error : undefined}
        >
          <span className="signin-submit-label">
            {waiting ? t('signin.waitLabel', { seconds: retryIn }) : submitLabel}
          </span>
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

/**
 * A row that grows from nothing to its content's height and back, so what
 * appears inside it slides the rest of the form rather than jumping it.
 * Folded, it is out of the tree for assistive technology and the tab order.
 */
function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="signin-reveal" data-open={open ? '' : undefined}>
      <div className="signin-reveal-inner" aria-hidden={!open} inert={!open}>
        {children}
      </div>
    </div>
  );
}

/** The line under a field that is wrong. Rendered only when there is one. */
function FieldError({ id, messageKey }: { id: string; messageKey?: MessageKey }) {
  const { t } = useLocale();
  return (
    <Reveal open={messageKey !== undefined}>
      {messageKey && (
        <small id={id} className="signin-field-error" role="alert">
          {t(messageKey)}
        </small>
      )}
    </Reveal>
  );
}
