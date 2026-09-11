'use client';

import { useMemo, useState } from 'react';
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_SHORT_LABELS } from '@/data/serviceIcons';
import { ServiceSprite } from '@/components/icons/ServiceSprite';
import { SERVICES_PER_CLOUD, queryCatalog } from '@/lib/editor/catalog';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import { useEditor } from '../EditorProvider';
import { useCommands } from '../hooks/useCommands';
import { useReturnFocusToCanvas } from '@/lib/editor/returnFocus';
import { CloseIcon } from '@/components/icons/ToolIcons';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { GroupHeader } from '@/components/ui/GroupHeader';
import { PanelHead } from '@/components/ui/PanelHead';
import { SearchField } from '@/components/ui/SearchField';
import { SpriteIcon, Tile } from '@/components/ui/Tile';
import type { CustomIcon } from '@/lib/domain';
import { customIconMatches } from '@/lib/icons/customIcons';
import { CustomGlyph, UploadForm, useIconLibrary, libraryCopy } from './CustomIcons';

/** Clouds in the order they are offered, with the count of services in each. */
const CLOUD_ORDER = ['aws', 'azure', 'gcp', 'oci', 'ibm', 'aion', 'generic'] as const;
/** The tab for the author's own icons; a place to add them as much as to find them. */
const MINE = 'mine';

/**
 * The service browser.
 *
 * The command palette answers "I know what I want"; this answers "show me what
 * there is". With 572 services across seven providers, one flat list is not a
 * browsable thing — so the cloud is a tab and the functional area is a section
 * inside it, which is the shape the catalogue actually has.
 */
export function ServiceBrowser() {
  const { doc, ui, dispatchUi, t } = useEditor();
  const commands = useCommands();
  useReturnFocusToCanvas();

  const [cloud, setCloud] = useState<string>('aws');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const library = useIconLibrary();
  const copy = libraryCopy(library.shared);
  // The author's icons: the library, plus what this document carries.
  const mine = useMemo(() => {
    const seen = new Set(library.icons.map((icon) => icon.key));
    return [
      ...library.icons,
      ...(doc.model.customIcons ?? []).filter((icon) => !seen.has(icon.key)),
    ];
  }, [library.icons, doc.model.customIcons]);

  const catalog = useMemo(
    () => queryCatalog({ cloud: cloud === MINE ? 'aws' : cloud, query, locale: ui.locale }),
    [cloud, query, ui.locale],
  );
  const mineMatches = catalog.searching
    ? mine.filter((icon) => customIconMatches(icon, query))
    : mine;
  const showMine = cloud === MINE || (catalog.searching && mineMatches.length > 0);
  const showCatalog = cloud !== MINE || catalog.searching;

  const toggleSection = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="side-panel is-left" aria-label={t('browser.title')} data-tooltip-side="right">
      <PanelHead
        title={t('browser.title')}
        count={t('browser.count', { count: catalog.total })}
        countClassName="browser-count"
        closeLabel={t('modal.close')}
        onClose={() => dispatchUi({ type: 'toggleBrowser' })}
      />

      <SearchField
        className="browser-search"
        inputClassName="browser-search-input"
        placeholder={t('browser.search')}
        value={query}
        onChange={setQuery}
        trailing={
          query && (
            <button
              type="button"
              className="icon-button"
              title={t('browser.clearSearch')}
              aria-label={t('browser.clearSearch')}
              onClick={() => setQuery('')}
            >
              <CloseIcon size={12} />
            </button>
          )
        }
      />

      {!catalog.searching && (
        <ChipRow className="browser-clouds" tabs label={t('browser.title')}>
          {CLOUD_ORDER.map((id) => (
            <Chip
              key={id}
              role="tab"
              className="browser-cloud"
              active={cloud === id}
              title={CATEGORY_LABELS[id]}
              color={CATEGORY_COLORS[id]}
              dotClassName="browser-cloud-dot"
              count={SERVICES_PER_CLOUD.get(id) ?? 0}
              countClassName="browser-cloud-count"
              onClick={() => setCloud(id)}
            >
              {CATEGORY_SHORT_LABELS[id] ?? CATEGORY_LABELS[id]}
            </Chip>
          ))}
          <Chip
            role="tab"
            className="browser-cloud"
            modifier="is-mine"
            active={cloud === MINE}
            title={t(copy.title)}
            dotClassName="browser-cloud-dot"
            count={mine.length}
            countClassName="browser-cloud-count"
            onClick={() => setCloud(MINE)}
          >
            {t('icons.mine')}
          </Chip>
        </ChipRow>
      )}

      <div className="browser-list">
        {uploading && (
          <UploadForm
            t={t}
            onCancel={() => setUploading(false)}
            onSaved={async (icon) => {
              const saved = await library.save(icon);
              if (saved.ok) {
                setUploading(false);
                // Straight onto the canvas: an icon uploaded from the browser is
                // an icon somebody wanted to place.
                commands.addCustomService(saved.icon);
              }
              return saved;
            }}
          />
        )}

        {!uploading && showMine && (
          <section className="browser-section is-mine">
            <GroupHeader
              className="browser-section-header"
              count={mineMatches.length}
              countClassName="browser-section-count"
            >
              {t(copy.title)}
            </GroupHeader>
            <ul className="browser-grid">
              {!catalog.searching && (
                <li>
                  <Tile
                    className="browser-tile"
                    modifier="is-upload"
                    onClick={() => setUploading(true)}
                    icon={
                      <span className="browser-tile-icon is-upload" aria-hidden="true">
                        +
                      </span>
                    }
                    label={t('icons.upload')}
                    labelClassName="browser-tile-label"
                    meta={<span className="browser-tile-cloud">{t('icons.uploadHint')}</span>}
                  />
                </li>
              )}
              {mineMatches.map((icon: CustomIcon) => (
                <li key={icon.key} className="browser-mine-row">
                  <Tile
                    className="browser-tile"
                    title={[icon.description, icon.source].filter(Boolean).join(' · ') || icon.name}
                    dragKey={icon.key}
                    onClick={() => commands.addCustomService(icon)}
                    icon={<CustomGlyph icon={icon} className="browser-tile-icon" />}
                    label={icon.name}
                    labelClassName="browser-tile-label"
                    meta={
                      <span className="browser-tile-cloud">
                        {icon.source ?? t('icons.customBadge')}
                      </span>
                    }
                  />
                  <button
                    type="button"
                    className="icon-button browser-mine-remove"
                    aria-label={`${t(copy.remove)}: ${icon.name}`}
                    title={t(copy.remove)}
                    onClick={() => void library.remove(icon.key)}
                  >
                    <CloseIcon size={11} />
                  </button>
                </li>
              ))}
            </ul>
            {!mineMatches.length && !catalog.searching && (
              <p className="library-note">{t(copy.empty)}</p>
            )}
          </section>
        )}

        {!uploading && showCatalog && catalog.sections.length === 0 && !mineMatches.length && (
          <p className="library-note">{t('browser.empty')}</p>
        )}

        {(uploading || !showCatalog ? [] : catalog.sections).map((section) => {
          // A section collapsed while browsing must not swallow search results:
          // the reader would see an empty panel and conclude there are none.
          const isCollapsed = !catalog.searching && collapsed.has(section.id);
          return (
            <section key={section.id} className="browser-section">
              <GroupHeader
                className="browser-section-header"
                open={!isCollapsed}
                onToggle={() => toggleSection(section.id)}
                count={section.services.length}
                countClassName="browser-section-count"
              >
                {section.label}
              </GroupHeader>

              {!isCollapsed && (
                <ul className="browser-grid">
                  {section.services.map((service) => (
                    <li key={service.key}>
                      <Tile
                        className="browser-tile"
                        title={serviceDescription(service, ui.locale) || service.label}
                        dragKey={service.key}
                        onClick={() => commands.addService(service)}
                        icon={<SpriteIcon serviceKey={service.key} className="browser-tile-icon" />}
                        label={service.label}
                        labelClassName="browser-tile-label"
                        meta={
                          catalog.searching && (
                            <span className="browser-tile-cloud">
                              {CATEGORY_LABELS[service.category]}
                            </span>
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* A cap that is not admitted to reads as "that is all there is". */}
      <footer className="browser-footer panel-footer">
        {cloud === MINE && !catalog.searching
          ? t('icons.count', { count: mine.length })
          : catalog.total > catalog.shown
            ? t('browser.showing', { count: catalog.shown, total: catalog.total })
            : t('browser.hint')}
      </footer>

      <ServiceSprite />
    </aside>
  );
}
