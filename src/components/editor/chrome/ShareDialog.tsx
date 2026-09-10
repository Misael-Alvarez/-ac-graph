'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DiagramModel } from '@/lib/domain';
import { projectView } from '@/lib/engine/views';
import { PayloadTooLargeError } from '@/lib/share/codec';
import { buildShareLinks, type ShareLinks } from '@/lib/share/links';
import { useEditor } from '../EditorProvider';
import { CloseIcon } from '@/components/icons/ToolIcons';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';

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
export function ShareDialog() {
  const { ui } = useEditor();
  // Unmounting resets consent to the narrower scope on every opening.
  return ui.modal === 'share' ? <ShareContents /> : null;
}

function ShareContents() {
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
