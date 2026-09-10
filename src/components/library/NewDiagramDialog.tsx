'use client';

import { useEffect, useRef } from 'react';
import { exitProps } from '@/lib/editor/usePresence';
import type { DiagramModel } from '@/lib/domain';
import { createEmptyModel } from '@/lib/engine';
import { TEMPLATES } from '@/lib/editor/templates';
import type { MessageKey } from '@/lib/i18n/messages';
import { CloseIcon, PlusIcon } from '@/components/icons/ToolIcons';
import { Glyph } from '@/components/icons/Glyph';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';
import { useLocale } from '@/lib/i18n/useLocale';

interface NewDiagramDialogProps {
  onPick: (title: string, model: DiagramModel) => void;
  onClose: () => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  closing?: boolean;
  onExited?: () => void;
}

/**
 * Choosing what a new diagram starts from.
 *
 * The empty-library screen offers the same choices inline, but that screen
 * disappears the moment there is one diagram — which left starting from a
 * template unreachable for everyone but a brand new user.
 */
export function NewDiagramDialog({
  onPick,
  onClose,
  t,
  closing = false,
  onExited = () => {},
}: NewDiagramDialogProps) {
  const { locale } = useLocale();
  const liquid = useLiquidPointer();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onPointerDown={onClose} {...exitProps(closing, onExited)}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('library.new')}
        className="dialog is-wide"
        onPointerMove={liquid}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="dialog-header">
          <h2>{t('library.new')}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t('modal.close')}
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </header>
        <div className="dialog-body">
          <div className="library-templates">
            <button
              type="button"
              className="template-card is-blank"
              onClick={() => onPick(t('app.untitled'), createEmptyModel())}
            >
              <span className="template-icon">
                <PlusIcon size={20} />
              </span>
              <span>
                <b>{t('library.blank')}</b>
                <small>{t('library.blankHint')}</small>
              </span>
            </button>
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="template-card"
                onClick={() => onPick(t(template.nameKey), template.build(locale))}
              >
                <span className="template-icon">
                  <Glyph name={template.icon} size={20} />
                </span>
                <span>
                  <b>{t(template.nameKey)}</b>
                  <small>{t(template.descriptionKey)}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
