'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { exitProps, usePresence } from '@/lib/editor/usePresence';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_SHORT_LABELS,
  SERVICE_ICONS,
} from '@/data/serviceIcons';
import { ServiceSprite } from '@/components/icons/ServiceSprite';
import { useLiquidPointer } from '@/components/app/useLiquidPointer';
import { SERVICES_PER_CLOUD, queryCatalog } from '@/lib/editor/catalog';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import type { Locale, MessageKey } from '@/lib/i18n/messages';
import type { CustomIcon } from '@/lib/domain';
import { customIconMatches } from '@/lib/icons/customIcons';
import { removeIconFromLibrary, saveIconToLibrary } from '@/lib/icons/iconLibrary';
import { ChevronDownIcon, CloseIcon } from '@/components/icons/ToolIcons';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { GroupHeader } from '@/components/ui/GroupHeader';
import { SearchField } from '@/components/ui/SearchField';
import { SpriteIcon, Tile } from '@/components/ui/Tile';
import { CustomGlyph, MineSection, UploadForm, useIconLibrary } from './CustomIcons';

/** Clouds in the order they are offered, matching the service browser. */
const CLOUD_ORDER = ['aws', 'azure', 'gcp', 'oci', 'ibm', 'aion', 'generic'] as const;
/** The tab for the author's own icons; not a cloud, but it sits with them. */
const MINE = 'mine';

const WIDTH = 344;

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * Where the panel opens.
 *
 * Fixed rather than absolute, because the inspector is a scroll container and
 * would clip a popover of its own — and it sits against the right edge, so the
 * only room is to its left. On a phone the inspector is already a bottom sheet,
 * and the picker becomes one too.
 */
function usePlacement(open: boolean, triggerRef: React.RefObject<HTMLButtonElement | null>) {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      if (window.innerWidth <= 720) {
        setStyle({
          left: 'var(--space-2)',
          right: 'var(--space-2)',
          bottom: 'var(--space-2)',
          maxHeight: '70vh',
        });
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const height = Math.min(460, window.innerHeight - 32);
      setStyle({
        left: Math.max(16, rect.left - WIDTH - 12),
        // Anchored a little above the trigger so the list, not its top edge,
        // lands under the cursor — then clamped inside the window.
        top: Math.min(Math.max(16, rect.top - 96), window.innerHeight - height - 16),
        width: WIDTH,
        maxHeight: height,
      });
    };

    place();
    window.addEventListener('resize', place);
    // Capture: the inspector scrolls, and the trigger moves with it.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, triggerRef]);

  return style;
}

interface IconPickerProps {
  /** The icon in use, if the shape has one. */
  value?: string;
  onChange: (key: string) => void;
  /** An uploaded icon chosen: the caller embeds it in the document, then uses it. */
  onPickCustom: (icon: CustomIcon) => void;
  /** The icons this document already carries, so they show as the author's. */
  customIcons: CustomIcon[];
  t: Translate;
  /** Names the sections and the per-tile tooltips. */
  locale: Locale;
}

export function IconPicker({
  value,
  onChange,
  onPickCustom,
  customIcons,
  t,
  locale,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const current = useMemo(() => SERVICE_ICONS.find((s) => s.key === value), [value]);
  const currentCustom = useMemo(
    () => (value ? customIcons.find((icon) => icon.key === value) : undefined),
    [customIcons, value],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? (
          <>
            <svg className="icon-picker-current" viewBox="0 0 24 24" aria-hidden="true">
              <use href={`#i-${current.key}`} width={24} height={24} />
            </svg>
            <span className="icon-picker-name">{current.label}</span>
            <span
              className="icon-picker-cloud-dot"
              style={{ '--cloud-color': CATEGORY_COLORS[current.category] } as React.CSSProperties}
              aria-hidden="true"
            />
            <span className="icon-picker-cloud-name">
              {CATEGORY_SHORT_LABELS[current.category] ?? current.category}
            </span>
          </>
        ) : currentCustom ? (
          <>
            <CustomGlyph icon={currentCustom} className="icon-picker-current" />
            <span className="icon-picker-name">{currentCustom.name}</span>
            <span className="icon-picker-cloud-dot is-mine" aria-hidden="true" />
            <span className="icon-picker-cloud-name">
              {currentCustom.source ?? t('icons.customBadge')}
            </span>
          </>
        ) : (
          <span className="icon-picker-name is-empty">{t('inspector.iconNone')}</span>
        )}
        <ChevronDownIcon size={14} className="icon-picker-chevron" />
      </button>

      {/* Rendered at the body, not inside the inspector: a `position: fixed`
          popover inside a panel with a backdrop filter is positioned against
          the panel, not the window, and this one used to be pushed off screen
          the moment the inspector turned to glass. Out here it is free of the
          panel's overflow, stacking and filters alike. */}
      {presence.shown &&
        createPortal(
          <Popover
            closing={presence.closing}
            onExited={presence.onExited}
            value={value}
            startCloud={currentCustom ? MINE : (current?.category ?? 'aws')}
            triggerRef={triggerRef}
            t={t}
            locale={locale}
            customIcons={customIcons}
            onPick={(key) => {
              onChange(key);
              setOpen(false);
              triggerRef.current?.focus();
            }}
            onPickCustom={(icon) => {
              onPickCustom(icon);
              setOpen(false);
              triggerRef.current?.focus();
            }}
            onClose={() => {
              setOpen(false);
              triggerRef.current?.focus();
            }}
          />,
          document.body,
        )}
    </>
  );
}

function Popover({
  value,
  startCloud,
  triggerRef,
  t,
  locale,
  customIcons,
  onPick,
  onPickCustom,
  onClose,
  closing,
  onExited,
}: {
  value?: string;
  startCloud: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  t: Translate;
  locale: Locale;
  customIcons: CustomIcon[];
  onPick: (key: string) => void;
  onPickCustom: (icon: CustomIcon) => void;
  onClose: () => void;
  closing: boolean;
  onExited: () => void;
}) {
  const [cloud, setCloud] = useState(startCloud);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  // The browser's library plus whatever this document carries that the
  // library has since forgotten — both are the author's, so both are offered.
  const [library, setLibrary] = useIconLibrary();
  const mine = useMemo(() => {
    const seen = new Set(library.map((icon) => icon.key));
    return [...library, ...customIcons.filter((icon) => !seen.has(icon.key))];
  }, [library, customIcons]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const liquid = useLiquidPointer();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const style = usePlacement(true, triggerRef);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  /**
   * Opening on the right cloud tab is only half of it: the icon in use can be
   * four hundred pixels down its own list, and a picker that opens at
   * "Amplify" when the shape is a CloudFront looks like it lost the value.
   *
   * Deliberately not a mount effect. The panel gets its height from
   * `usePlacement`, and until that lands the list is not a scroll container at
   * all — scrolling it then is a silent no-op, which is exactly what happened.
   * So this waits for the list to actually overflow, and runs once. The wait is
   * a frame-by-frame retry rather than a single check: with several hundred
   * real vendor icons the grid can take a frame or two to lay out, and an
   * effect that looked once found a list that did not yet scroll.
   */
  const scrolledToCurrent = useRef(false);
  useEffect(() => {
    if (scrolledToCurrent.current || !value) return;
    let frame = 0;
    let attempts = 0;
    const attempt = () => {
      if (scrolledToCurrent.current) return;
      const list = listRef.current;
      const target = list?.querySelector(`[data-key="${CSS.escape(value)}"]`);
      if (list && target && list.scrollHeight > list.clientHeight) {
        scrolledToCurrent.current = true;
        target.scrollIntoView({ block: 'center' });
        return;
      }
      if (++attempts < 30) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [value, style]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    };
    // Capture, so Escape closes the picker before the canvas clears the
    // selection and takes the whole inspector away with it.
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose, triggerRef]);

  const catalog = useMemo(() => queryCatalog({ cloud, query, locale }), [cloud, query, locale]);

  const toggleSection = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div
      ref={panelRef}
      className="icon-picker"
      role="dialog"
      aria-modal="false"
      aria-label={t('inspector.iconPicker')}
      style={style}
      onPointerMove={liquid}
      inert={closing || undefined}
      {...exitProps(closing, onExited)}
    >
      <SearchField
        className="icon-picker-search"
        inputClassName="icon-picker-search-input"
        inputRef={searchRef}
        placeholder={t('browser.search')}
        value={query}
        onChange={setQuery}
        trailing={
          <button
            type="button"
            className="icon-button"
            aria-label={t('modal.close')}
            onClick={onClose}
          >
            <CloseIcon size={13} />
          </button>
        }
      />

      {!catalog.searching && (
        <ChipRow className="icon-picker-clouds" tabs label={t('inspector.cloud')}>
          {CLOUD_ORDER.map((id) => (
            <Chip
              key={id}
              role="tab"
              className="icon-picker-cloud"
              active={cloud === id}
              title={CATEGORY_LABELS[id]}
              color={CATEGORY_COLORS[id]}
              dotClassName="icon-picker-cloud-dot"
              count={SERVICES_PER_CLOUD.get(id) ?? 0}
              countClassName="icon-picker-cloud-count"
              onClick={() => {
                setCloud(id);
                setUploading(false);
              }}
            >
              {CATEGORY_SHORT_LABELS[id] ?? CATEGORY_LABELS[id]}
            </Chip>
          ))}
          <Chip
            role="tab"
            className="icon-picker-cloud"
            modifier="is-mine"
            active={cloud === MINE}
            title={t('icons.mineTitle')}
            dotClassName="icon-picker-cloud-dot"
            count={mine.length}
            countClassName="icon-picker-cloud-count"
            onClick={() => setCloud(MINE)}
          >
            {t('icons.mine')}
          </Chip>
        </ChipRow>
      )}

      <div className="icon-picker-list" ref={listRef}>
        {uploading && (
          <UploadForm
            t={t}
            onCancel={() => setUploading(false)}
            onSaved={(icon) => {
              const saved = saveIconToLibrary(window.localStorage, icon);
              if (saved.ok) setLibrary(saved.icons);
              setUploading(false);
              onPickCustom(icon);
            }}
          />
        )}

        {!uploading && (cloud === MINE && !catalog.searching ? true : catalog.searching) && (
          <MineSection
            t={t}
            icons={catalog.searching ? mine.filter((icon) => customIconMatches(icon, query)) : mine}
            value={value}
            showUpload={!catalog.searching}
            onUpload={() => setUploading(true)}
            onPick={onPickCustom}
            onRemove={(key) => setLibrary(removeIconFromLibrary(window.localStorage, key))}
          />
        )}

        {!uploading &&
          cloud !== MINE &&
          catalog.sections.length === 0 &&
          !(catalog.searching && mine.some((icon) => customIconMatches(icon, query))) && (
            <p className="icon-picker-empty">{t('browser.empty')}</p>
          )}

        {(uploading || (cloud === MINE && !catalog.searching) ? [] : catalog.sections).map(
          (section) => {
            // A section collapsed while browsing must not swallow search results:
            // the reader would see an empty panel and conclude there are none.
            const isCollapsed = !catalog.searching && collapsed.has(section.id);
            return (
              <section key={section.id} className="icon-picker-section">
                <GroupHeader
                  className="icon-picker-section-header"
                  open={!isCollapsed}
                  onToggle={() => toggleSection(section.id)}
                  count={section.services.length}
                  countClassName="icon-picker-section-count"
                >
                  {section.label}
                </GroupHeader>

                {!isCollapsed && (
                  <ul className="icon-picker-grid">
                    {section.services.map((service) => (
                      <li key={service.key}>
                        <Tile
                          className="icon-picker-tile"
                          dataKey={service.key}
                          current={service.key === value}
                          title={
                            catalog.searching
                              ? `${service.label} · ${CATEGORY_LABELS[service.category]}`
                              : serviceDescription(service, locale) || service.label
                          }
                          onClick={() => onPick(service.key)}
                          icon={
                            <SpriteIcon
                              serviceKey={service.key}
                              className="icon-picker-tile-icon"
                            />
                          }
                          marker={
                            catalog.searching && (
                              <span
                                className="icon-picker-tile-cloud"
                                style={
                                  {
                                    '--cloud-color': CATEGORY_COLORS[service.category],
                                  } as React.CSSProperties
                                }
                                aria-hidden="true"
                              />
                            )
                          }
                          label={service.label}
                          labelClassName="icon-picker-tile-label"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          },
        )}
      </div>

      {/* A cap that is not admitted to reads as "that is all there is". */}
      <footer className="icon-picker-footer panel-footer">
        {cloud === MINE && !catalog.searching
          ? t('icons.count', { count: mine.length })
          : catalog.total > catalog.shown
            ? t('browser.showing', { count: catalog.shown, total: catalog.total })
            : t('browser.count', { count: catalog.total })}
      </footer>

      <ServiceSprite />
    </div>
  );
}
