'use client';

import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { yaml } from '@codemirror/lang-yaml';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { lintKeymap, lintGutter } from '@codemirror/lint';
import type { CloudPrefix, Diagnostic } from '@/lib/dsl';
import type { Locale } from '@/lib/i18n/messages';
import {
  autocompletion,
  dslHighlight,
  dslLinter,
  editorTheme,
  serviceCompletion,
} from './codemirrorSetup';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onFocusChange: (focused: boolean) => void;
  diagnostics: Diagnostic[];
  cloud?: CloudPrefix;
  /** Names the completions' descriptions. */
  locale: Locale;
  /** The text can be read, selected and copied, never changed. */
  readOnly?: boolean;
}

/**
 * CodeMirror wrapper.
 *
 * The view is created once and fed new documents through transactions. Rebuilding
 * it on every render would lose the cursor, the selection and the undo stack on
 * each keystroke.
 */
export function CodeEditor({
  value,
  onChange,
  onFocusChange,
  diagnostics,
  cloud,
  locale,
  readOnly = false,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Reconfigured in place when the role changes, keeping cursor and history.
  const editable = useRef(new Compartment());

  // Read through refs so the extensions never need rebuilding.
  const latest = useRef({ onChange, onFocusChange, diagnostics, cloud, locale });
  useEffect(() => {
    latest.current = { onChange, onFocusChange, diagnostics, cloud, locale };
  });

  useEffect(() => {
    if (!host.current) return;

    const extensions: Extension[] = [
      lineNumbers(),
      lintGutter(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      syntaxHighlighting(dslHighlight, { fallback: true }),
      yaml(),
      autocompletion({
        override: [
          serviceCompletion(
            () => latest.current.cloud,
            () => latest.current.locale,
          ),
        ],
      }),
      dslLinter(() => latest.current.diagnostics),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      EditorView.lineWrapping,
      editorTheme,
      editable.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current.onChange(update.state.doc.toString());
        if (update.focusChanged) latest.current.onFocusChange(update.view.hasFocus);
      }),
    ];

    const editor = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host.current,
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Created once on mount; `value` is synchronised by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Push external changes in without disturbing a user who is typing. */
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === value) return;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      // Keep the cursor in range rather than jumping to the end.
      selection: { anchor: Math.min(editor.state.selection.main.anchor, value.length) },
    });
  }, [value]);

  /* Re-run the linter when diagnostics change; the extension reads them by ref. */
  useEffect(() => {
    view.current?.dispatch({});
  }, [diagnostics]);

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  return <div ref={host} className="code-editor" />;
}
