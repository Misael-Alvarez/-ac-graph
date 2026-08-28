'use client';

import { useMemo, useState } from 'react';
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_SHORT_LABELS } from '@/data/serviceIcons';
import { ServiceSprite } from '@/components/icons/ServiceSprite';
import { SERVICES_PER_CLOUD, queryCatalog } from '@/lib/editor/catalog';
import { serviceDescription } from '@/lib/i18n/serviceCopy';
import { useEditor } from '../EditorProvider';
import { useCommands } from '../hooks/useCommands';
import { useReturnFocusToCanvas } from '@/lib/editor/returnFocus';
import { CloseIcon, SearchIcon } from '@/components/icons/ToolIcons';

/** Clouds in the order they are offered, with the count of services in each. */
const CLOUD_ORDER = ['aws', 'azure', 'gcp', 'oci', 'ibm', 'aion', 'generic'] as const;

/**
 * The service browser.
 *
 * The command palette answers "I know what I want"; this answers "show me what
 * there is". With 572 services across seven providers, one flat list is not a
 * browsable thing — so the cloud is a tab and the functional area is a section
 * inside it, which is the shape the catalogue actually has.
 */
export function ServiceBrowser() {
  const { ui, dispatchUi, t } = useEditor();
  const commands = useCommands();
  useReturnFocusToCanvas();

  const [cloud, setCloud] = useState<string>('aws');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const catalog = useMemo(
    () => queryCatalog({ cloud, query, locale: ui.locale }),
    [cloud, query, ui.locale],
  );

  const toggleSection = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="side-panel is-left" aria-label={t('browser.title')}>
      <header className="code-panel-header">
        <strong className="side-panel-title">{t('browser.title')}</strong>
        <span className="code-panel-spacer" />
        <span className="browser-count result-count">
          {t('browser.count', { count: catalog.total })}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={t('modal.close')}
          onClick={() => dispatchUi({ type: 'toggleBrowser' })}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="browser-search filter-field">
        <SearchIcon size={14} />
        <input
          className="browser-search-input filter-input"
          placeholder={t('browser.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            title={t('browser.clearSearch')}
            aria-label={t('browser.clearSearch')}
            onClick={() => setQuery('')}
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>

      {!catalog.searching && (
        <div className="browser-clouds chip-row" role="tablist" aria-label={t('browser.title')}>
          {CLOUD_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={cloud === id}
              className={`browser-cloud chip${cloud === id ? ' is-active' : ''}`}
              title={CATEGORY_LABELS[id]}
              style={{ '--cloud-color': CATEGORY_COLORS[id] } as React.CSSProperties}
              onClick={() => setCloud(id)}
            >
              <span className="browser-cloud-dot chip-dot" />
              {CATEGORY_SHORT_LABELS[id] ?? CATEGORY_LABELS[id]}
              <span className="browser-cloud-count chip-count">
                {SERVICES_PER_CLOUD.get(id) ?? 0}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="browser-list">
        {catalog.sections.length === 0 && <p className="library-note">{t('browser.empty')}</p>}

        {catalog.sections.map((section) => {
          // A section collapsed while browsing must not swallow search results:
          // the reader would see an empty panel and conclude there are none.
          const isCollapsed = !catalog.searching && collapsed.has(section.id);
          return (
            <section key={section.id} className="browser-section">
              <button
                type="button"
                className="browser-section-header group-header"
                aria-expanded={!isCollapsed}
                onClick={() => toggleSection(section.id)}
              >
                <span
                  className={`inspector-chevron${isCollapsed ? '' : ' is-open'}`}
                  aria-hidden="true"
                />
                {section.label}
                <span className="browser-section-count group-count">{section.services.length}</span>
              </button>

              {!isCollapsed && (
                <ul className="browser-grid">
                  {section.services.map((service) => (
                    <li key={service.key}>
                      <button
                        type="button"
                        className="browser-tile"
                        title={serviceDescription(service, ui.locale) || service.label}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', service.key);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => commands.addService(service)}
                      >
                        <svg className="browser-tile-icon" viewBox="0 0 24 24" aria-hidden="true">
                          <use href={`#i-${service.key}`} width={24} height={24} />
                        </svg>
                        <span className="browser-tile-label">{service.label}</span>
                        {catalog.searching && (
                          <span className="browser-tile-cloud">
                            {CATEGORY_LABELS[service.category]}
                          </span>
                        )}
                      </button>
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
        {catalog.total > catalog.shown
          ? t('browser.showing', { count: catalog.shown, total: catalog.total })
          : t('browser.hint')}
      </footer>

      <ServiceSprite />
    </aside>
  );
}
