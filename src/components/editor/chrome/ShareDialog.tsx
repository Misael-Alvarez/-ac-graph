'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { DiagramMember, DiagramModel, Role } from '@/lib/domain';
import { projectView } from '@/lib/engine/views';
import { PayloadTooLargeError } from '@/lib/share/codec';
import { buildShareLinks, type ShareLinks } from '@/lib/share/links';
import { HttpRepositoryError } from '@/lib/store/httpRepository';
import { useEditor } from '../EditorProvider';
import { CloseIcon } from '@/components/icons/ToolIcons';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';
import { useMembersApi } from '@/components/app/RepositoryProvider';
import { useUser } from '@/components/app/AuthProvider';
import { colorForUser } from '@/lib/collab/colors';

function CopyField({
  label,
  hint,
  value,
  copyLabel,
  copiedLabel,
  multiline,
}: {
  label: string;
  hint?: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <section className="share-field">
      <header className="share-field-header">
        <span className="inspector-field-label">{label}</span>
        <button
          type="button"
          className="button is-small"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? `✓ ${copiedLabel}` : copyLabel}
        </button>
      </header>
      {hint && <p className="ai-note">{hint}</p>}
      {multiline ? (
        <pre className="share-value is-block">{value}</pre>
      ) : (
        <input
          className="input share-value"
          aria-label={label}
          value={value}
          readOnly
          onFocus={(e) => e.target.select()}
        />
      )}
    </section>
  );
}

/**
 * Share links for the current diagram.
 *
 * There is no server holding diagrams yet, so the diagram travels compressed
 * inside the link. That has a size ceiling, and this says so plainly rather than
 * handing out a link that will be truncated somewhere downstream.
 */
export function ShareDialog({ accessVersion = 0 }: { accessVersion?: number }) {
  const { ui } = useEditor();
  // Unmounting resets consent to the narrower scope on every opening.
  return ui.modal === 'share' ? <ShareContents accessVersion={accessVersion} /> : null;
}

const ROLE_KEY = { owner: 'role.owner', editor: 'role.editor', viewer: 'role.viewer' } as const;

/**
 * Who can open this diagram — server mode only, where diagrams have members.
 *
 * The owner adds people by e-mail (accounts come from the identity provider,
 * so the person must have signed in once), changes roles in place and removes
 * anyone; everyone else sees the list and may leave. `accessVersion` ticks on
 * every access event in the room, so the list follows what others do.
 */
function SharePeople({ accessVersion }: { accessVersion: number }) {
  const api = useMembersApi();
  const { user } = useUser();
  const { t, dispatchUi } = useEditor();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const diagramId = params?.id ?? '';

  const [members, setMembers] = useState<DiagramMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('editor');
  const [busy, setBusy] = useState(false);
  const [inviteError, setInviteError] = useState<'unknown' | 'failed' | null>(null);

  const refresh = useCallback(() => {
    if (!api || !diagramId) return Promise.resolve();
    return api.listMembers(diagramId).then(
      (list) => {
        setMembers(list);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [api, diagramId]);

  useEffect(() => {
    void refresh();
  }, [refresh, accessVersion]);

  if (!api) return null;

  const mine = members?.find((member) => member.user.id === user.id)?.role;
  const owner = mine === 'owner';

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setInviteError(null);
    try {
      await api.setMember(diagramId, email.trim(), role);
      setEmail('');
      await refresh();
    } catch (thrown) {
      setInviteError(
        thrown instanceof HttpRepositoryError && thrown.code === 'user_not_found'
          ? 'unknown'
          : 'failed',
      );
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: DiagramMember, next: Exclude<Role, 'owner'>) => {
    setBusy(true);
    try {
      await api.setMemberRole(diagramId, member.user.id, next);
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: DiagramMember) => {
    setBusy(true);
    try {
      await api.removeMember(diagramId, member.user.id);
      if (member.user.id === user.id) {
        // Leaving: this diagram is no longer ours to look at.
        dispatchUi({ type: 'setModal', modal: null });
        router.push('/');
        return;
      }
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="share-people" aria-labelledby="share-people-title">
      <div className="share-field-header">
        <h3 id="share-people-title" className="share-field-label">
          {t('share.people')}
        </h3>
      </div>
      <p className="ai-note">{t(owner ? 'share.peopleHint' : 'share.peopleHintMember')}</p>

      {members === null && !failed && (
        <p className="library-note" role="status">
          {t('library.loading')}
        </p>
      )}
      {failed && (
        <p className="share-people-note is-error" role="alert">
          {t('status.error')}
        </p>
      )}

      {members && (
        <ul className="share-people-list">
          {members.map((member) => {
            const self = member.user.id === user.id;
            const initials = member.user.name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase() ?? '')
              .join('');
            return (
              <li key={member.user.id} className="share-person">
                <span
                  className="share-person-avatar"
                  style={{ '--user-color': colorForUser(member.user.id) } as React.CSSProperties}
                  aria-hidden="true"
                >
                  {initials}
                </span>
                <span className="share-person-text">
                  <span className="share-person-name">
                    {member.user.name}
                    {self && <small> ({t('share.you')})</small>}
                  </span>
                  {member.user.email && (
                    <span className="share-person-email">{member.user.email}</span>
                  )}
                </span>
                {owner && member.role !== 'owner' ? (
                  <select
                    className="input is-choice is-small"
                    value={member.role}
                    aria-label={t('share.roleOf', { name: member.user.name })}
                    disabled={busy}
                    onChange={(e) =>
                      void changeRole(member, e.target.value === 'viewer' ? 'viewer' : 'editor')
                    }
                  >
                    <option value="editor">{t('role.editor')}</option>
                    <option value="viewer">{t('role.viewer')}</option>
                  </select>
                ) : (
                  <span className="share-person-role">{t(ROLE_KEY[member.role])}</span>
                )}
                {member.role !== 'owner' && (owner || self) && (
                  <button
                    type="button"
                    className="button is-small"
                    disabled={busy}
                    onClick={() => void remove(member)}
                  >
                    {self ? t('share.leave') : t('share.remove')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {owner && (
        <form className="share-invite" onSubmit={(e) => void invite(e)}>
          <input
            className="input"
            type="email"
            required
            value={email}
            placeholder={t('share.invitePlaceholder')}
            aria-label={t('share.invitePlaceholder')}
            disabled={busy}
            onChange={(e) => {
              setEmail(e.target.value);
              setInviteError(null);
            }}
          />
          <select
            className="input is-choice"
            value={role}
            aria-label={t('share.scope')}
            disabled={busy}
            onChange={(e) => setRole(e.target.value === 'viewer' ? 'viewer' : 'editor')}
          >
            <option value="editor">{t('role.editor')}</option>
            <option value="viewer">{t('role.viewer')}</option>
          </select>
          <button type="submit" className="button is-primary" disabled={busy || !email.trim()}>
            {t('share.invite')}
          </button>
        </form>
      )}
      {inviteError && (
        <p className="share-people-note is-error" role="alert">
          {t(inviteError === 'unknown' ? 'share.inviteUnknown' : 'share.inviteFailed')}
        </p>
      )}
    </section>
  );
}

function ShareContents({ accessVersion }: { accessVersion: number }) {
  const liquid = useLiquidPointer();
  const { doc, ui, view, dispatchUi, t } = useEditor();
  const [scope, setScope] = useState<'view' | 'model'>('view');
  const model = useMemo(
    () => (scope === 'view' ? projectView(view) : doc.model),
    [scope, view, doc.model],
  );
  const theme = ui.dark ? 'dark' : 'light';
  const [result, setResult] = useState<{
    model: DiagramModel;
    theme: string;
    links?: ShareLinks;
    error?: 'tooLarge' | 'failed';
  } | null>(null);
  // A result belongs to exactly one payload and theme. Never offer an old,
  // broader link during an asynchronous scope change or model update.
  const ready = result?.model === model && result.theme === theme ? result : null;
  const links = ready?.links;

  useEffect(() => {
    let cancelled = false;

    // Every state update happens in a promise callback, never synchronously in
    // the effect body, so opening the dialog costs one render rather than three.
    buildShareLinks(model, window.location.origin, theme)
      .then((built) => {
        if (cancelled) return;
        setResult({ model, theme, links: built });
      })
      .catch((error) => {
        if (cancelled) return;
        setResult({
          model,
          theme,
          error: error instanceof PayloadTooLargeError ? 'tooLarge' : 'failed',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [model, theme]);

  const close = () => dispatchUi({ type: 'setModal', modal: null });

  return (
    <div className="dialog-backdrop" onPointerDown={close}>
      <div
        className="dialog is-wide"
        onPointerMove={liquid}
        role="dialog"
        aria-modal="true"
        aria-label={t('share.dialogTitle')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="dialog-header">
          <h2>{t('share.dialogTitle')}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t('modal.close')}
            onClick={close}
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="dialog-body">
          <SharePeople accessVersion={accessVersion} />
          <label className="inspector-field">
            <span className="inspector-field-label">{t('share.scope')}</span>
            <select
              className="input is-choice"
              value={scope}
              aria-describedby="share-scope-hint"
              onChange={(e) => setScope(e.target.value === 'model' ? 'model' : 'view')}
            >
              <option value="view">{t('share.currentView')}</option>
              <option value="model">{t('share.fullModel')}</option>
            </select>
          </label>
          <p id="share-scope-hint" className="ai-note">
            {t(scope === 'view' ? 'share.currentViewHint' : 'share.fullModelHint')}
          </p>
          <p className="ai-note">{t('share.portableWarning')}</p>
          {ready?.error && (
            <p className="ai-error" role="alert">
              {t(ready.error === 'tooLarge' ? 'share.tooLarge' : 'status.error')}
            </p>
          )}
          {!ready && (
            <p className="library-note" role="status">
              {t('library.loading')}
            </p>
          )}

          {links && (
            <>
              <CopyField
                label={t('share.link')}
                value={links.view}
                copyLabel={t('action.copy')}
                copiedLabel={t('share.copied')}
              />
              <CopyField
                label={t('share.readme')}
                hint={t('share.readmeHint')}
                value={links.readme}
                copyLabel={t('action.copy')}
                copiedLabel={t('share.copied')}
                multiline
              />
              <CopyField
                label={t('share.image')}
                hint={t('share.imageHint')}
                value={links.markdownImage}
                copyLabel={t('action.copy')}
                copiedLabel={t('share.copied')}
              />
              <div className="dialog-actions">
                <span className="dialog-spacer" />
                <a className="button is-primary" href={links.view} target="_blank" rel="noreferrer">
                  {t('share.open')}
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
