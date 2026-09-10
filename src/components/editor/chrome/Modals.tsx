'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { safeParseDiagramModel } from '@/lib/domain';
import { TEMPLATES } from '@/lib/editor/templates';
import { markdownToDiagram } from '@/lib/editor/markdownImport';
import { ImportError, detectFormat, importArchitecture } from '@/lib/import';
import { compile } from '@/lib/dsl';
import type { MessageKey } from '@/lib/i18n/messages';
import { CLOUD_TARGETS } from '@/data/cloudEquivalents';
import { CATEGORY_SHORT_LABELS } from '@/data/serviceIcons';
import { providerColors } from '@/lib/design/tokens';
import { useEditor } from '../EditorProvider';
import { SHORTCUT_GROUPS } from '../hooks/useKeyboard';
import { CloseIcon } from '@/components/icons/ToolIcons';
import { GroupHeader } from '@/components/ui/GroupHeader';
import { Kbd } from '@/components/ui/Kbd';
import { Glyph } from '@/components/icons/Glyph';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';
import { spellChord } from '@/lib/editor/platform';
import { exitProps, usePresence, type Presence } from '@/lib/editor/usePresence';
import { MineSection, UploadForm, useIconLibrary } from './CustomIcons';
import { removeIconFromLibrary, saveIconToLibrary } from '@/lib/icons/iconLibrary';
import { useCommands } from '../hooks/useCommands';

/** What a dialog needs to leave the way it came: see `usePresence`. */
export type ExitProps = Pick<Presence<unknown>, 'closing' | 'onExited'>;

function Dialog({
  title,
  children,
  onClose,
  closeLabel,
  wide,
  closing = false,
  onExited = () => {},
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeLabel: string;
  wide?: boolean;
} & Partial<ExitProps>) {
  const ref = useRef<HTMLDivElement>(null);
  const liquid = useLiquidPointer();
  useEffect(() => {
    const trigger = document.activeElement;
    ref.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onPointerDown={onClose} {...exitProps(closing, onExited)}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`dialog${wide ? ' is-wide' : ''}`}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={liquid}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (!first || !last) {
            event.preventDefault();
          } else if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === ref.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
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

/** The modals this component owns; the share and AI dialogs are their own components. */
const OWNED = new Set(['templates', 'markdown', 'switchCloud', 'icons', 'shortcuts']);

export function Modals() {
  const { ui, dispatch, dispatchUi, t } = useEditor();
  const close = () => dispatchUi({ type: 'setModal', modal: null });
  // The last open modal stays for its exit; `modal` is what to draw, not what is set.
  const presence = usePresence(ui.modal && OWNED.has(ui.modal) ? ui.modal : null);
  const modal = presence.shown;
  // `key` makes a reopening start afresh even while the last one is leaving.
  const exit = { key: presence.key, closing: presence.closing, onExited: presence.onExited };

  if (modal === 'templates') {
    return (
      <Dialog
        title={t('modal.templates.title')}
        onClose={close}
        closeLabel={t('modal.close')}
        {...exit}
      >
        <p className="dialog-subtitle">{t('modal.templates.subtitle')}</p>
        <div className="template-grid">
          {TEMPLATES.map((template, index) => (
            <button
              key={template.id}
              type="button"
              className="template-card"
              style={{ '--i': index } as React.CSSProperties}
              onClick={() => {
                dispatch({ type: 'replaceModel', model: template.build(ui.locale) });
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

  if (modal === 'markdown') return <MarkdownDialog onClose={close} {...exit} />;

  if (modal === 'switchCloud') {
    return (
      <Dialog
        title={t('action.switchCloud')}
        onClose={close}
        closeLabel={t('modal.close')}
        {...exit}
      >
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

  if (modal === 'icons') {
    return (
      <Dialog
        title={t('icons.mineTitle')}
        onClose={close}
        closeLabel={t('modal.close')}
        wide
        {...exit}
      >
        <p className="dialog-subtitle">{t('icons.dialogSubtitle')}</p>
        <IconLibraryManager />
      </Dialog>
    );
  }

  if (modal === 'shortcuts') {
    return (
      <Dialog
        title={t('modal.shortcuts.title')}
        onClose={close}
        closeLabel={t('modal.close')}
        wide
        {...exit}
      >
        <p className="dialog-subtitle">{t('modal.shortcuts.subtitle')}</p>
        <div className="shortcut-groups">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.titleKey} className="shortcut-group">
              <GroupHeader as="h3" className="shortcut-group-title" count={group.items.length}>
                {t(group.titleKey)}
              </GroupHeader>
              {group.items.map((item) => (
                <div key={item.id} className="shortcut-row">
                  {/* Spelled for the platform the reader is on: ⌘⇧S or Ctrl+Shift+S. */}
                  <Kbd>{spellChord(item.keys)}</Kbd>
                  <span>{t(item.labelKey)}</span>
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

function MarkdownDialog({ onClose, ...exit }: { onClose: () => void } & ExitProps) {
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

  /**
   * What this is, worked out as it is typed.
   *
   * One box rather than four tabs: nobody arrives here unsure what they are
   * holding, so asking them to classify it first is asking them to do the
   * computer's job. Markdown is the fallback because it is the only one of the
   * four with nothing to announce itself by — an outline is just prose.
   */
  const read = useMemo(() => {
    if (!text.trim()) return null;
    const format = detectFormat(text);
    if (!format) {
      return { format: 'markdown' as const, model: markdownToDiagram(text, ui.locale) };
    }
    try {
      const result = importArchitecture(text, format, ui.locale);
      const compiled = compile(result.document, ui.locale);
      return { format, model: compiled.model, warnings: result.warnings };
    } catch (caught) {
      const code = caught instanceof ImportError ? caught.code : 'unrecognised';
      return { format, error: `import.${code}` as MessageKey };
    }
  }, [text, ui.locale]);

  const nodes = read?.model?.shapes.filter((s) => s.type === 'group').length ?? 0;

  return (
    <Dialog
      title={t('import.title')}
      onClose={onClose}
      closeLabel={t('modal.close')}
      wide
      {...exit}
    >
      <p className="dialog-subtitle">{t('import.subtitle')}</p>
      <textarea
        className="dialog-textarea"
        aria-label={t('import.title')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={example}
        rows={12}
      />

      {/* What it made of the paste, before the reader commits to replacing their
          diagram with it. */}
      <div className="import-read">
        {!read && <span className="import-hint">{t('import.detecting')}</span>}
        {read && (
          <>
            <span className="chip is-active">
              {t(`import.detected.${read.format}` as MessageKey)}
            </span>
            {read.error ? (
              <span className="import-error">{t(read.error)}</span>
            ) : (
              <span className="import-hint">
                {t('import.found', { nodes, edges: read.model?.connectors.length ?? 0 })}
              </span>
            )}
          </>
        )}
      </div>

      {read?.warnings?.length ? (
        <details className="import-warnings">
          <summary>
            {t('import.warnings')} ({read.warnings.length})
          </summary>
          <ul>
            {read.warnings.map((warning, i) => (
              <li key={`${warning.kind}-${i}`}>
                {t(`import.warn.${warning.kind}` as MessageKey, warning.values)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="dialog-actions">
        <label className="button">
          {t('modal.markdown.chooseFile')}
          <input
            type="file"
            accept=".md,.txt,.tf,.tfplan,.json,.yaml,.yml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              const failed = () => dispatchUi({ type: 'toast', message: t('toast.invalidFile') });
              reader.onload = () => setText(String(reader.result));
              reader.onerror = failed;
              reader.onabort = failed;
              try {
                reader.readAsText(file);
              } catch {
                failed();
              }
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
          disabled={!read?.model || nodes === 0}
          onClick={() => {
            const parsed = safeParseDiagramModel(read?.model);
            if (!parsed.success) {
              dispatchUi({ type: 'toast', message: t('toast.invalidFile') });
              return;
            }
            dispatch({ type: 'replaceModel', model: parsed.data });
            dispatchUi({ type: 'clearSelection' });
            onClose();
          }}
        >
          {t('import.action')}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * The author's icons, as a place of their own.
 *
 * The picker and the browser offer them where they are needed; this is where
 * they are looked after — uploaded, looked over, removed — without a shape
 * having to be selected first. Choosing one here places it on the canvas.
 */
function IconLibraryManager() {
  const { doc, t } = useEditor();
  const commands = useCommands();
  const [library, setLibrary] = useIconLibrary();
  const [uploading, setUploading] = useState(false);
  const mine = useMemo(() => {
    const seen = new Set(library.map((icon) => icon.key));
    return [...library, ...(doc.model.customIcons ?? []).filter((icon) => !seen.has(icon.key))];
  }, [library, doc.model.customIcons]);

  if (uploading) {
    return (
      <div className="icon-manager">
        <UploadForm
          t={t}
          onCancel={() => setUploading(false)}
          onSaved={(icon) => {
            const saved = saveIconToLibrary(window.localStorage, icon);
            if (saved.ok) setLibrary(saved.icons);
            setUploading(false);
          }}
        />
      </div>
    );
  }
  return (
    <div className="icon-manager">
      <MineSection
        t={t}
        icons={mine}
        showUpload
        onUpload={() => setUploading(true)}
        onPick={(icon) => commands.addCustomService(icon)}
        onRemove={(key) => setLibrary(removeIconFromLibrary(window.localStorage, key))}
      />
    </div>
  );
}
