import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { HighlightStyle } from '@codemirror/language';
import { linter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { serviceCompletions, type CloudPrefix, type Diagnostic } from '@/lib/dsl';
import type { Locale } from '@/lib/i18n/messages';

/**
 * Autocomplete over the service catalogue.
 *
 * Only fires where a service can legally appear — after `service:` or as the
 * value of a node shorthand — so typing a label does not pop a list of 189
 * services in the user's face.
 */
export function serviceCompletion(
  getCloud: () => CloudPrefix | undefined,
  getLocale: () => Locale,
) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);

    // Matches `  service: lam` and the `  fn: lam` shorthand.
    const match = before.match(/(?:^\s{2,}[\w-]+|service):\s*([\w-]*)$/);
    if (!match && !context.explicit) return null;

    const typed = match?.[1] ?? '';

    return {
      from: context.pos - typed.length,
      options: serviceCompletions(getCloud(), getLocale()).map((service) => ({
        label: service.label,
        detail: service.detail,
        info: service.info,
        type: 'class',
      })),
      validFor: /^[\w-]*$/,
    };
  };
}

/** Bridges DSL diagnostics into CodeMirror's lint gutter. */
export function dslLinter(getDiagnostics: () => Diagnostic[]) {
  return linter((view): CmDiagnostic[] => {
    const length = view.state.doc.length;
    return getDiagnostics().map((diagnostic) => {
      // A diagnostic with no known range still has to appear somewhere sensible.
      const from = Math.min(Math.max(diagnostic.from, 0), length);
      const to = Math.min(Math.max(diagnostic.to, from), length);
      return {
        from,
        to: to > from ? to : Math.min(from + 1, length),
        severity: diagnostic.severity,
        message: diagnostic.message,
      };
    });
  });
}

/** Editor chrome wired to the app's design tokens so both themes match. */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--text-sm)',
    backgroundColor: 'var(--surface-raised)',
    color: 'var(--text-primary)',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: '1.6',
  },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-raised)',
    color: 'var(--text-tertiary)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'var(--surface-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-hover)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-subtle)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-raised)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--elevation-2)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--accent-subtle)',
    color: 'var(--text-primary)',
  },
  '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: '2px dotted var(--danger)' },
  '.cm-lintRange-warning': { backgroundImage: 'none', borderBottom: '2px dotted var(--warning)' },
});

export { autocompletion };

/**
 * Syntax colours, as theme tokens.
 *
 * CodeMirror ships a light palette baked into its default highlight style. On
 * the dark canvas that left every YAML key — the most structural token in the
 * document — a dark navy on near-black, effectively invisible, while the values
 * beside it were legible. Naming CSS variables here puts the code panel on the
 * same switch as the rest of the app, and keeps one style rather than two.
 */
export const dslHighlight = HighlightStyle.define([
  {
    tag: [tags.propertyName, tags.definition(tags.propertyName), tags.attributeName],
    color: 'var(--code-key)',
  },
  { tag: [tags.string, tags.attributeValue, tags.content], color: 'var(--code-string)' },
  { tag: tags.number, color: 'var(--code-number)' },
  { tag: [tags.keyword, tags.bool, tags.null, tags.atom], color: 'var(--code-keyword)' },
  { tag: [tags.comment, tags.lineComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: 'var(--code-punct)' },
]);
