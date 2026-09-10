'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SERVICE_ICONS, CATEGORY_LABELS } from '@/data/serviceIcons';
import { ServiceSprite } from '@/components/icons/ServiceSprite';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';
import { scoreMatch } from '@/lib/editor/search';
import { useEditor } from '../EditorProvider';
import { serviceDescription, serviceDescriptions } from '@/lib/i18n/serviceCopy';
import { useCommands, type Command } from '../hooks/useCommands';
import { SearchIcon } from '@/components/icons/ToolIcons';
import { PanelHead } from '@/components/ui/PanelHead';
import { Glyph } from '@/components/icons/Glyph';

type Row =
  | { kind: 'command'; command: Command }
  | { kind: 'service'; key: string; label: string; description?: string; category: string };

const MAX_SERVICES = 40;

/**
 * Command palette.
 *
 * Searches commands and the 189-service catalogue in one field, which is what
 * lets the permanent sidebar go away and give the canvas its width back.
 */
/** Mounts the palette only while it is open, so each open starts blank. */
export function CommandPalette() {
  const { ui } = useEditor();
  if (!ui.paletteOpen) return null;
  return <PaletteContents />;
}

function PaletteContents() {
  const { ui, dispatchUi, t } = useEditor();
  const commands = useCommands();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The palette is remounted on each open (see the `key` in PaletteHost), so
    // the only thing left to do here is take focus.
    inputRef.current?.focus();
  }, []);

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();

    const matchedCommands = commands
      .filter((c) => c.enabled !== false)
      .map((c) => ({ command: c, rank: scoreMatch(c.label, needle) }))
      .filter((r) => r.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .map<Row>((r) => ({ kind: 'command', command: r.command }));

    const matchedServices = SERVICE_ICONS.map((s) => ({
      service: s,
      rank: Math.max(
        scoreMatch(s.label, needle),
        scoreMatch(s.key, needle),
        // Both languages, so the palette answers to whichever the reader
        // happens to type — see serviceCopy's note on ranking.
        ...serviceDescriptions(s).map((text) => scoreMatch(text, needle) * 0.5),
      ),
    }))
      .filter((r) => r.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, needle ? MAX_SERVICES : 12)
      .map<Row>((r) => ({
        kind: 'service',
        key: r.service.key,
        label: r.service.label,
        description: serviceDescription(r.service, ui.locale),
        category: r.service.category,
      }));

    return [...matchedCommands, ...matchedServices];
  }, [commands, query, ui.locale]);

  // Clamped during render: a shrinking result list must never point past the end.
  const active = Math.min(activeIndex, Math.max(rows.length - 1, 0));

  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !row) return;
    row.scrollIntoView({ block: 'nearest' });
    // The highlight is one element that travels between rows. Arrowing through
    // a list of things that blink on and off is a slideshow; arrowing through
    // one that slides is a place you are moving inside.
    list.style.setProperty('--row-y', `${row.offsetTop}px`);
    list.style.setProperty('--row-h', `${row.offsetHeight}px`);
  }, [active, rows.length]);

  const close = () => dispatchUi({ type: 'setPaletteOpen', open: false });

  const run = (row: Row) => {
    if (row.kind === 'command') row.command.run();
    else {
      const service = SERVICE_ICONS.find((s) => s.key === row.key);
      if (service) commands.addService(service);
    }
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(rows.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + rows.length) % Math.max(rows.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) run(row);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const firstServiceIndex = rows.findIndex((r) => r.kind === 'service');
  const commandCount = firstServiceIndex === -1 ? rows.length : firstServiceIndex;
  const liquid = useLiquidPointer();

  return (
    <div className="palette-backdrop" onPointerDown={close}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.placeholder')}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={liquid}
      >
        {/* The same head as every panel: what this is, how much is in it, the
            way out. The search used to be the only thing at the top, which made
            the palette the one surface that did not say its name. */}
        <PanelHead
          title={t('palette.title')}
          count={t('palette.count', { count: rows.length })}
          countClassName="panel-head-count"
          closeLabel={t('modal.close')}
          onClose={close}
        />
        <div className="palette-search">
          <SearchIcon size={16} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={`palette-row-${active}`}
          />
        </div>

        <div
          className="palette-list"
          id="palette-list"
          role="listbox"
          ref={listRef}
          data-has-rows={rows.length > 0}
        >
          {rows.length === 0 && <p className="palette-empty">{t('palette.empty')}</p>}
          {rows.map((row, index) => (
            <div key={row.kind === 'command' ? row.command.id : row.key}>
              {index === 0 && row.kind === 'command' && (
                <p className="palette-group group-header">
                  {t('palette.commands')}
                  <span className="group-count">{commandCount}</span>
                </p>
              )}
              {index === firstServiceIndex && (
                <p className="palette-group group-header">
                  {t('palette.services')}
                  <span className="group-count">{rows.length - commandCount}</span>
                </p>
              )}
              <button
                type="button"
                id={`palette-row-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === active}
                className={`palette-row${index === active ? ' is-active' : ''}`}
                style={{ '--i': index } as React.CSSProperties}
                // pointermove, not pointerenter: a stationary cursor that the
                // list happens to open under would otherwise steal the selection,
                // so a blind Enter could fire whatever sat beneath it.
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => run(row)}
              >
                {row.kind === 'service' ? (
                  <>
                    <svg className="palette-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <use href={`#i-${row.key}`} width={24} height={24} />
                    </svg>
                    <span className="palette-label">{row.label}</span>
                    <span className="palette-meta">
                      {CATEGORY_LABELS[row.category as keyof typeof CATEGORY_LABELS] ??
                        row.category}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="palette-icon" aria-hidden="true">
                      <Glyph name={row.command.icon} size={17} />
                    </span>
                    <span className="palette-label">{row.command.label}</span>
                    {row.command.shortcut && (
                      <kbd className="palette-meta">{row.command.shortcut}</kbd>
                    )}
                  </>
                )}
              </button>
            </div>
          ))}
        </div>

        {/* The list has always answered to these keys; nothing said so. */}
        <footer className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            {t('palette.hintMove')}
          </span>
          <span>
            <kbd>↵</kbd>
            {t('palette.hintRun')}
          </span>
          <span>
            <kbd>esc</kbd>
            {t('palette.hintClose')}
          </span>
          <span className="palette-footer-count">{t('palette.count', { count: rows.length })}</span>
        </footer>
      </div>
      <ServiceSprite />
    </div>
  );
}
