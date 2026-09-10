'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CLOUD_PREFIXES,
  parseDsl,
  serializeDsl,
  toMermaid,
  type CloudPrefix,
  type Diagnostic,
} from '@/lib/dsl';
import { useEditor } from '../EditorProvider';
import { PanelHead } from '@/components/ui/PanelHead';
import { CodeEditor } from './CodeEditor';
import { useReturnFocusToCanvas } from '@/lib/editor/returnFocus';

/** How long to wait after the last keystroke before compiling. */
const COMPILE_DEBOUNCE_MS = 350;

/** Stable empty array so the editor does not re-lint on every render. */
const EMPTY_DIAGNOSTICS: Diagnostic[] = [];

type Format = 'dsl' | 'mermaid';

/**
 * The code half of the split view.
 *
 * Which side is authoritative follows the focus: while the editor has focus the
 * text drives the diagram, and the moment it does not, the diagram drives the
 * text. The one exception is text that fails to compile — that is left exactly
 * as typed, because regenerating it from the model would silently throw the
 * user's work away.
 */
export function CodePanel() {
  useReturnFocusToCanvas();
  const { doc, ui, dispatch, dispatchUi, readOnly, t } = useEditor();
  const [source, setSource] = useState(() => serializeDsl(doc.model));
  const [focused, setFocused] = useState(false);
  const [format, setFormat] = useState<Format>('dsl');
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [copied, setCopied] = useState(false);
  const [syncedModel, setSyncedModel] = useState(doc.model);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  /*
   * Diagram to text.
   *
   * Adjusted during render rather than in an effect: this is state derived from
   * a prop that the user can also edit, so it cannot be a pure computation, and
   * doing it in an effect would render the stale text for one frame first.
   */
  if (doc.model !== syncedModel) {
    setSyncedModel(doc.model);
    // Never clobber text the user is still holding focus on or still fixing.
    if (!focused && !hasErrors) {
      const next = serializeDsl(doc.model);
      if (next !== source) setSource(next);
    }
  }

  // Mermaid is a generated view, never compiled back, so it is pure derivation.
  const mermaid = useMemo(
    () => (format === 'mermaid' ? toMermaid(doc.model) : ''),
    [format, doc.model],
  );
  const displayed = format === 'mermaid' ? mermaid : source;

  /* Text to diagram, debounced, only while the editor holds focus. */
  const compile = useCallback(
    (text: string) => {
      const result = parseDsl(text, ui.locale);
      setDiagnostics(result.diagnostics);
      if (result.model) dispatch({ type: 'replaceModel', model: result.model });
    },
    [dispatch, ui.locale],
  );

  const onChange = useCallback(
    (text: string) => {
      // The Mermaid view is read-only; edits there are not compiled back.
      if (format !== 'dsl') return;
      setSource(text);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => compile(text), COMPILE_DEBOUNCE_MS);
    },
    [compile, format],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /** The document's default cloud, which is what completion offers first. */
  const cloud = useMemo(() => {
    const match = source.match(new RegExp(`^cloud:\\s*(${CLOUD_PREFIXES.join('|')})\\s*$`, 'm'));
    return (match?.[1] as CloudPrefix | undefined) ?? undefined;
  }, [source]);

  const diagnosticsForView = format === 'dsl' ? diagnostics : EMPTY_DIAGNOSTICS;

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;

  return (
    <aside className="code-panel" aria-label={t('code.title')}>
      <PanelHead
        title={
          <div className="segmented is-compact">
            {(['dsl', 'mermaid'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`segmented-option${format === option ? ' is-active' : ''}`}
                onClick={() => setFormat(option)}
              >
                {option === 'dsl' ? 'YAML' : 'Mermaid'}
              </button>
            ))}
          </div>
        }
        actions={
          <>
            {(format === 'mermaid' || readOnly) && (
              <span className="code-badge is-muted">{t('code.readOnly')}</span>
            )}
            {format === 'dsl' && errorCount > 0 && (
              <span className="code-badge is-error">{errorCount}</span>
            )}
            {format === 'dsl' && warningCount > 0 && (
              <span className="code-badge is-warning">{warningCount}</span>
            )}
            <button
              type="button"
              className="button is-small"
              onClick={() => {
                void navigator.clipboard?.writeText(displayed).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? '✓' : t('action.copy')}
            </button>
          </>
        }
        closeLabel={t('modal.close')}
        onClose={() => dispatchUi({ type: 'toggleCode' })}
      />

      <div className="code-panel-body">
        <CodeEditor
          value={displayed}
          onChange={onChange}
          onFocusChange={setFocused}
          diagnostics={diagnosticsForView}
          cloud={cloud}
          locale={ui.locale}
          readOnly={readOnly}
        />
      </div>

      {hasErrors && format === 'dsl' && (
        <footer className="code-panel-footer panel-footer" role="status">
          {diagnostics.find((d) => d.severity === 'error')?.message}
        </footer>
      )}
    </aside>
  );
}
