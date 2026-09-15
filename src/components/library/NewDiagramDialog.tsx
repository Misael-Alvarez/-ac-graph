'use client';

import { useEffect, useRef } from 'react';
import { exitProps } from '@/lib/editor/usePresence';
import type { DiagramModel } from '@/lib/domain';
import { createEmptyModel } from '@/lib/engine';
import type { MessageKey } from '@/lib/i18n/messages';
import { CloseIcon } from '@/components/icons/ToolIcons';
import { GroupHeader } from '@/components/ui/GroupHeader';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';
import {
  BlankFace,
  TemplateFace,
  ownTemplateHint,
  stagger,
  type OwnTemplatePreview,
  type TemplatePreview,
} from './TemplateGallery';

interface NewDiagramDialogProps {
  /** The built-in templates, drawn small in the current language and theme. */
  previews: TemplatePreview[];
  /** The reader's own starting points, drawn the same way. */
  yours?: OwnTemplatePreview[];
  onPick: (title: string, model: DiagramModel) => void;
  onClose: () => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  closing?: boolean;
  onExited?: () => void;
}

/**
 * Choosing what a new diagram starts from.
 *
 * The same starting points as the gallery on the home, on the same cards —
 * a real drawing of each, its name, a line about it and how much is in it —
 * so a template looks the same wherever it is offered. A blank sheet first;
 * when the reader has templates of their own it shares their grid, under
 * their heading — a row is never left two-thirds empty — and the house's
 * follow under a heading of their own, as the editor's own dialog lists them.
 */
export function NewDiagramDialog({
  previews,
  yours = [],
  onPick,
  onClose,
  t,
  closing = false,
  onExited = () => {},
}: NewDiagramDialogProps) {
  const liquid = useLiquidPointer();
  const first = useRef<HTMLButtonElement>(null);

  // The keyboard lands on the first choice, not on the frame around them.
  useEffect(() => {
    first.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const blank = (
    <button
      ref={first}
      type="button"
      className="template-card is-blank is-rich"
      style={stagger(0)}
      onClick={() => onPick(t('app.untitled'), createEmptyModel())}
    >
      <BlankFace t={t} />
    </button>
  );

  const builtIn = previews.map(({ template, model, src }, index) => (
    <button
      key={template.id}
      type="button"
      className="template-card is-rich"
      style={stagger(yours.length + 1 + index)}
      onClick={() => onPick(t(template.nameKey), model)}
    >
      <TemplateFace
        t={t}
        src={src}
        title={t(template.nameKey)}
        hint={t(template.descriptionKey)}
        model={model}
      />
    </button>
  ));

  return (
    <div className="dialog-backdrop" onPointerDown={onClose} {...exitProps(closing, onExited)}>
      <div
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
          {yours.length === 0 ? (
            <div className="library-templates is-rich">
              {blank}
              {builtIn}
            </div>
          ) : (
            <>
              <GroupHeader as="h3" className="template-group-title" count={yours.length}>
                {t('modal.templates.yours')}
              </GroupHeader>
              <div className="library-templates is-rich">
                {blank}
                {yours.map(({ meta, model, src }, index) => (
                  <button
                    key={meta.id}
                    type="button"
                    className="template-card is-rich is-yours"
                    style={stagger(index + 1)}
                    onClick={() => onPick(meta.title, structuredClone(model))}
                  >
                    <TemplateFace
                      t={t}
                      src={src}
                      title={meta.title}
                      hint={ownTemplateHint(t, meta)}
                      model={model}
                    />
                  </button>
                ))}
              </div>
              <GroupHeader as="h3" className="template-group-title" count={previews.length}>
                {t('modal.templates.builtIn')}
              </GroupHeader>
              <div className="library-templates is-rich">{builtIn}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
