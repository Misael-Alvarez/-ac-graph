'use client';

import { useEffect, useRef } from 'react';
import { exitProps } from '@/lib/editor/usePresence';
import type { MessageKey } from '@/lib/i18n/messages';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';

/**
 * A confirmation that belongs to the app.
 *
 * Deleting a diagram asked through `window.confirm`: the one place the product
 * handed the question to the browser, in the browser's typography, at the top
 * of the screen, with a title bar naming localhost. It also blocks the whole
 * page, which is why it could not be styled or dismissed by clicking away.
 */
export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  t,
  closing = false,
  onExited = () => {},
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  closing?: boolean;
  onExited?: () => void;
}) {
  const liquid = useLiquidPointer();
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus lands on the destructive button, but the dialog opens with Cancel as
  // the click target under the pointer, so Enter and a stray click disagree on
  // purpose: the keyboard user has already read the question.
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" onPointerDown={onCancel} {...exitProps(closing, onExited)}>
      <div
        className="dialog is-narrow"
        onPointerMove={liquid}
        role="alertdialog"
        aria-modal="true"
        aria-label={confirmLabel}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-body">
          <p className="dialog-question">{message}</p>
          <div className="dialog-actions">
            <span className="dialog-spacer" />
            <button type="button" className="button" onClick={onCancel}>
              {t('modal.cancel')}
            </button>
            <button ref={confirmRef} type="button" className="button is-danger" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
