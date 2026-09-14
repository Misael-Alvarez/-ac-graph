'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramMeta, DiagramModel } from '@/lib/domain';
import { safeParseDiagramModel } from '@/lib/domain';
import { useRepository } from '@/components/app/RepositoryProvider';
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
import { relativeDay } from '@/lib/i18n/relativeDay';
import { exitProps, usePresence, type Presence } from '@/lib/editor/usePresence';
import {
  MineSection,
  UploadForm,
  libraryCopy,
  useIconLibrary,
  type IconLibrary,
} from './CustomIcons';
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

/**
 * The templates: the reader's own first, when there are any, then the house's.
 *
 * The reader's are read from the repository when the dialog opens — they are
 * diagrams marked as starting points — and drawn as the built-in ones are,
 * icon and name; a template of one's own has no glyph of its own, so it wears
 * the templates' mark. Without any, the dialog is exactly what it was.
 */
function TemplatesDialog({ onClose, ...exit }: { onClose: () => void } & ExitProps) {
  const { ui, dispatch, dispatchUi, t } = useEditor();
  const repository = useRepository();
  const [yours, setYours] = useState<DiagramMeta[]>([]);
  useEffect(() => {
    let cancelled = false;
    void repository
      .list()
      .then((items) => {
        if (!cancelled) setYours(items.filter((item) => item.template));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const load = (model: DiagramModel) => {
    dispatch({ type: 'replaceModel', model });
    dispatchUi({ type: 'clearSelection' });
    onClose();
  };

  return (
    <Dialog
      title={t('modal.templates.title')}
      onClose={onClose}
      closeLabel={t('modal.close')}
      {...exit}
    >
      <p className="dialog-subtitle">{t('modal.templates.subtitle')}</p>
      {yours.length > 0 && (
        <>
          <GroupHeader as="h3" className="template-group-title" count={yours.length}>
            {t('modal.templates.yours')}
          </GroupHeader>
          <div className="template-grid">
            {yours.map((meta, index) => (
              <button
                key={meta.id}
                type="button"
                className="template-card is-yours"
                style={{ '--i': index } as React.CSSProperties}
                onClick={() => {
                  void repository.get(meta.id).then((record) => {
                    if (record) load(structuredClone(record.model));
                  });
                }}
              >
                <span className="template-icon">
                  <Glyph name="templates" size={20} />
                </span>
                <span>
                  <b>{meta.title}</b>
                  <small>
                    {t('library.templateYours', { when: relativeDay(meta.updatedAt, t) })}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <GroupHeader as="h3" className="template-group-title" count={TEMPLATES.length}>
            {t('modal.templates.builtIn')}
          </GroupHeader>
        </>
      )}
      <div className="template-grid">
        {TEMPLATES.map((template, index) => (
          <button
            key={template.id}
            type="button"
            className="template-card"
            style={{ '--i': index } as React.CSSProperties}
            onClick={() => load(template.build(ui.locale))}
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

export function Modals() {
  const { ui, dispatch, dispatchUi, t } = useEditor();
  const close = () => dispatchUi({ type: 'setModal', modal: null });
  // The last open modal stays for its exit; `modal` is what to draw, not what is set.
  const presence = usePresence(ui.modal && OWNED.has(ui.modal) ? ui.modal : null);
  const modal = presence.shown;
  // `key` makes a reopening start afresh even while the last one is leaving.
  const exit = { key: presence.key, closing: presence.closing, onExited: presence.onExited };

  if (modal === 'templates') {
    return <TemplatesDialog onClose={close} {...exit} />;
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
    return <IconsDialog onClose={close} {...exit} />;
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
   * One box rather than a tab per format: nobody arrives here unsure what they
   * are holding, so asking them to classify it first is asking them to do the
   * computer's job. Terraform, CloudFormation, Kubernetes, Compose, Pulumi and
   * OpenAPI each announce themselves; Markdown is the fallback because it is
   * the only one with nothing to announce itself by — an outline is just prose.
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
/** The library, in a dialog: its name says whose it is. */
function IconsDialog({ onClose, ...exit }: { onClose: () => void } & ExitProps) {
  const { t } = useEditor();
  const library = useIconLibrary();
  const copy = libraryCopy(library.shared);
  return (
    <Dialog title={t(copy.title)} onClose={onClose} closeLabel={t('modal.close')} wide {...exit}>
      <p className="dialog-subtitle">{t(copy.subtitle)}</p>
      <IconLibraryManager library={library} />
    </Dialog>
  );
}

function IconLibraryManager({ library }: { library: IconLibrary }) {
  const { doc, t } = useEditor();
  const commands = useCommands();
  const [uploading, setUploading] = useState(false);
  const mine = useMemo(() => {
    const seen = new Set(library.icons.map((icon) => icon.key));
    return [
      ...library.icons,
      ...(doc.model.customIcons ?? []).filter((icon) => !seen.has(icon.key)),
    ];
  }, [library.icons, doc.model.customIcons]);

  if (uploading) {
    return (
      <div className="icon-manager">
        <UploadForm
          t={t}
          onCancel={() => setUploading(false)}
          onSaved={async (icon) => {
            const saved = await library.save(icon);
            if (saved.ok) setUploading(false);
            return saved;
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
        shared={library.shared}
        onUpload={() => setUploading(true)}
        onPick={(icon) => commands.addCustomService(icon)}
        onRemove={(key) => void library.remove(key)}
      />
    </div>
  );
}
