'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Shape } from '@/lib/domain';
import { bbox } from '@/lib/engine';
import { centerOn } from '@/lib/editor/viewport';
import { useEditor } from '../EditorProvider';
import { ChevronDownIcon, CloseIcon, SearchIcon } from '@/components/icons/ToolIcons';

/** What a shape can be found by: everything a person might remember about it. */
function haystack(shape: Shape): string {
  const meta = shape.meta;
  return [
    shape.title,
    shape.subtitle,
    shape.note,
    shape.icon?.key,
    meta?.technology,
    meta?.owner,
    meta?.repository,
    meta?.environment,
    meta?.criticality,
    meta?.lifecycle,
    ...(meta?.tags ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Find on the canvas (⌘F).
 *
 * A diagram of forty services is too big to read for one name. Typing here
 * narrows to the shapes that mention the text — in their title, subtitle, note
 * or any of their facts — selects the first, and glides the camera to it;
 * Enter walks to the next, Shift+Enter back, Escape puts things down. The
 * browser's own find is replaced only while the editor is open: what it would
 * find is SVG text, which it cannot scroll to.
 */
export function FindBar() {
  const { ui, view, dispatchUi, t } = useEditor();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matchesFor = (text: string) => {
    const needle = text.trim().toLowerCase();
    if (!needle) return [];
    // Containers are frames, never things a person looks for by name.
    return view.shapes.filter((s) => s.type !== 'container' && haystack(s).includes(needle));
  };
  const matches = useMemo(() => matchesFor(query), [view.shapes, query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const goTo = (list: Shape[], i: number) => {
    if (!list.length) return;
    const wrapped = ((i % list.length) + list.length) % list.length;
    setIndex(wrapped);
    const shape = list[wrapped];
    const box = bbox(shape);
    const el = document.querySelector('.canvas-surface');
    const rect = el?.getBoundingClientRect();
    dispatchUi({ type: 'select', ids: [shape.id] });
    dispatchUi({
      type: 'setViewport',
      viewport: centerOn(
        ui.viewport,
        { x: box.x + box.w / 2, y: box.y + box.h / 2 },
        { width: rect?.width ?? 1200, height: rect?.height ?? 800 },
      ),
      smooth: true,
    });
  };

  // The first match is shown as soon as there is one; the rest wait for Enter.
  const search = (text: string) => {
    setQuery(text);
    setIndex(0);
    goTo(matchesFor(text), 0);
  };

  const close = () => {
    dispatchUi({ type: 'setFindOpen', open: false });
    document.querySelector<SVGSVGElement>('.canvas-surface')?.focus?.();
  };

  return (
    <div className="find-bar" role="search" aria-label={t('action.find')}>
      <SearchIcon size={14} />
      <input
        ref={inputRef}
        className="find-bar-input"
        value={query}
        placeholder={t('find.placeholder')}
        spellCheck={false}
        aria-label={t('action.find')}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            goTo(matches, index + (e.shiftKey ? -1 : 1));
          }
        }}
      />
      <span className="find-bar-count" aria-live="polite">
        {query.trim()
          ? matches.length
            ? t('find.count', { index: index + 1, total: matches.length })
            : t('find.none')
          : ''}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={t('find.previous')}
        disabled={matches.length < 2}
        onClick={() => goTo(matches, index - 1)}
      >
        <ChevronDownIcon size={13} className="is-up" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={t('find.next')}
        disabled={matches.length < 2}
        onClick={() => goTo(matches, index + 1)}
      >
        <ChevronDownIcon size={13} />
      </button>
      <button type="button" className="icon-button" aria-label={t('modal.close')} onClick={close}>
        <CloseIcon size={13} />
      </button>
    </div>
  );
}
