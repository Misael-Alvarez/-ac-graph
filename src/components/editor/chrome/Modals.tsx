'use client';

import { useEffect, useRef, useState } from 'react';
import { safeParseDiagramModel } from '@/lib/domain';
import { TEMPLATES } from '@/lib/editor/templates';
import { markdownToDiagram } from '@/lib/editor/markdownImport';
import { CLOUD_TARGETS } from '@/data/cloudEquivalents';
import { CATEGORY_SHORT_LABELS } from '@/data/serviceIcons';
import { providerColors } from '@/lib/design/tokens';
import { useEditor } from '../EditorProvider';
import { SHORTCUT_GROUPS } from '../hooks/useKeyboard';
import { CloseIcon } from '@/components/icons/ToolIcons';
import { Glyph } from '@/components/icons/Glyph';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';
import { modKey } from '@/lib/editor/platform';

function Dialog({
  title,
  children,
  onClose,
  closeLabel,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const liquid = useLiquidPointer();
  useEffect(() => ref.current?.focus(), []);

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`dialog${wide ? ' is-wide' : ''}`}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={liquid}
      >
        <header className="dialog-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label={closeLabel} onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

export function Modals() {
  const { ui, dispatch, dispatchUi, t } = useEditor();
  const close = () => dispatchUi({ type: 'setModal', modal: null });

  if (ui.modal === 'templates') {
    return (
      <Dialog title={t('modal.templates.title')} onClose={close} closeLabel={t('modal.close')}>
        <p className="dialog-subtitle">{t('modal.templates.subtitle')}</p>
        <div className="template-grid">
          {TEMPLATES.map((template, index) => (
            <button
              key={template.id}
              type="button"
              className="template-card"
              style={{ '--i': index } as React.CSSProperties}
              onClick={() => {
                dispatch({ type: 'load', model: template.build(ui.locale) });
                dispatchUi({ type: 'clearSelection' });
                close();
              }}
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
      </Dialog>
    );
  }

  if (ui.modal === 'markdown') return <MarkdownDialog onClose={close} />;

  if (ui.modal === 'switchCloud') {
    return (
      <Dialog title={t('action.switchCloud')} onClose={close} closeLabel={t('modal.close')}>
        <div className="cloud-grid">
          {/* Read from the equivalence table rather than listed here: it has
              known five clouds since the catalogue grew, and this dialog went
              on offering three. */}
          {CLOUD_TARGETS.map((target) => (
            <button
              key={target}
              type="button"
              className="cloud-card"
              style={{ '--chip-color': providerColors[target] } as React.CSSProperties}
              onClick={() => {
                dispatch({ type: 'switchCloud', target, locale: ui.locale });
                close();
              }}
            >
              {CATEGORY_SHORT_LABELS[target] ?? target.toUpperCase()}
            </button>
          ))}
        </div>
      </Dialog>
    );
  }

  if (ui.modal === 'shortcuts') {
    return (
      <Dialog title={t('modal.shortcuts.title')} onClose={close} closeLabel={t('modal.close')} wide>
        <div className="shortcut-groups">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.titleKey}>
              <h3 className="shortcut-group-title group-header">
                {t(group.titleKey)}
                <span className="group-count">{group.items.length}</span>
              </h3>
              {group.items.map(([keys, key]) => (
                <div key={keys} className="shortcut-row">
                  {/* `Mod` is spelled for the platform the reader is on. */}
                  <kbd>{keys.replace('Mod+', modKey())}</kbd>
                  <span>{t(key)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Dialog>
    );
  }

  return null;
}

function MarkdownDialog({ onClose }: { onClose: () => void }) {
  const { ui, dispatch, dispatchUi, t } = useEditor();
  const [text, setText] = useState('');

  const example = `# Architecture

- CloudFront
- API Gateway
- Lambda
- DynamoDB

CloudFront -> API Gateway : HTTPS
API Gateway -> Lambda : invoke
Lambda -> DynamoDB : R/W`;

  return (
    <Dialog title={t('modal.markdown.title')} onClose={onClose} closeLabel={t('modal.close')} wide>
      <p className="dialog-subtitle">{t('modal.markdown.subtitle')}</p>
      <pre className="dialog-example">{example}</pre>
      <textarea
        className="dialog-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={example}
        rows={10}
      />
      <div className="dialog-actions">
        <label className="button">
          {t('modal.markdown.chooseFile')}
          <input
            type="file"
            accept=".md,.txt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setText(String(reader.result));
              reader.readAsText(file);
              e.target.value = '';
            }}
          />
        </label>
        <span className="dialog-spacer" />
        <button type="button" className="button" onClick={onClose}>
          {t('modal.cancel')}
        </button>
        <button
          type="button"
          className="button is-primary"
          disabled={!text.trim()}
          onClick={() => {
            const model = markdownToDiagram(text, ui.locale);
            const parsed = safeParseDiagramModel(model);
            if (!parsed.success) {
              dispatchUi({ type: 'toast', message: t('toast.invalidFile') });
              return;
            }
            dispatch({ type: 'load', model: parsed.data });
            dispatchUi({ type: 'clearSelection' });
            onClose();
          }}
        >
          {t('modal.markdown.import')}
        </button>
      </div>
    </Dialog>
  );
}
