'use client';

import { useCallback } from 'react';
import type { DiagramModel } from '@/lib/domain';
import { TEMPLATES } from '@/lib/editor/templates';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import type { MessageKey } from '@/lib/i18n/messages';
import { PlusIcon } from '@/components/icons/ToolIcons';
import { Kbd } from '@/components/ui/Kbd';
import { CountUp } from './CountUp';
import type { TemplatePreview } from './TemplateGallery';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

const SERVICE_COUNT = SERVICE_ICONS.length;
/** The public clouds in the catalogue; AION and the generic set are not clouds. */
const CLOUD_COUNT = new Set(
  SERVICE_ICONS.map((s) => s.category).filter((c) => c !== 'aion' && c !== 'generic'),
).size;

/**
 * The one place in the app with room to say what it is: the words on the left,
 * a real diagram on the right that opens when pressed, and the numbers of the
 * workspace beneath.
 */
export function LibraryHero({
  t,
  diagramCount,
  showcase,
  onNew,
  onBrowseTemplates,
  onPick,
}: {
  t: Translate;
  diagramCount: number;
  /** The template drawn large on the right; opens as a new diagram when pressed. */
  showcase: TemplatePreview | undefined;
  onNew: () => void;
  onBrowseTemplates: () => void;
  onPick: (title: string, model: DiagramModel) => void;
}) {
  // The showcase leans towards the hand, a few degrees, and settles back when
  // it leaves: the one gesture that says "this is a thing, not a picture".
  const tilt = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty('--tilt-x', `${(x * 10).toFixed(2)}deg`);
    el.style.setProperty('--tilt-y', `${(-y * 8).toFixed(2)}deg`);
  }, []);
  const settle = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.currentTarget.style.removeProperty('--tilt-x');
    event.currentTarget.style.removeProperty('--tilt-y');
  }, []);

  return (
    <section className="library-hero">
      <div className="library-hero-aurora" aria-hidden="true" />
      <div className="library-hero-grid" aria-hidden="true" />
      <div className="library-hero-inner is-split">
        <div className="library-hero-copy">
          <p className="library-hero-eyebrow">
            <span className="library-hero-pulse" aria-hidden="true" />
            {t('library.eyebrow')}
          </p>
          <h1 className="library-hero-title">{t('library.heroTitle')}</h1>
          <p className="library-hero-subtitle">{t('library.heroLede')}</p>
          <div className="library-hero-actions">
            <button type="button" className="button is-primary is-large" onClick={onNew}>
              <PlusIcon size={16} />
              {t('library.heroCta')}
            </button>
            <button type="button" className="button is-large is-ghost" onClick={onBrowseTemplates}>
              {t('library.browseTemplates')}
            </button>
          </div>
          <ul className="library-hero-points">
            <li>
              <Kbd>⌘K</Kbd>
              {t('library.pointSearch')}
            </li>
            <li>
              <span className="library-point-mark" aria-hidden="true">
                YAML
              </span>
              {t('library.pointCode')}
            </li>
            <li>
              <span className="library-point-mark" aria-hidden="true">
                PDF
              </span>
              {t('library.pointShare')}
            </li>
          </ul>
        </div>
        {showcase && (
          <button
            type="button"
            className="library-showcase"
            aria-label={`${t('library.showcaseLabel')}: ${t(showcase.template.nameKey)}`}
            onPointerMove={tilt}
            onPointerLeave={settle}
            onClick={() => onPick(t(showcase.template.nameKey), showcase.model)}
          >
            <span className="library-showcase-bar" aria-hidden="true">
              <i />
              <i />
              <i />
              <span>{t(showcase.template.nameKey)}</span>
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
            <img className="library-showcase-image" src={showcase.src} alt="" />
            <span className="library-showcase-caption">
              <span className="library-showcase-label">{t('library.showcaseLabel')}</span>
              <span>
                {t('status.shapes', {
                  count: showcase.model.shapes.filter((s) => s.type === 'item').length,
                })}
                {' · '}
                {t('status.connectors', { count: showcase.model.connectors.length })}
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="library-hero-inner">
        <ul className="library-stats" aria-label={t('library.statsLabel')}>
          <li className="library-stat">
            <CountUp className="tabular" value={diagramCount} />
            <span>{diagramCount === 1 ? t('library.statDiagram') : t('library.statDiagrams')}</span>
          </li>
          <li className="library-stat">
            <CountUp className="tabular" value={SERVICE_COUNT} />
            <span>{t('library.statServices')}</span>
          </li>
          <li className="library-stat">
            <CountUp className="tabular" value={CLOUD_COUNT} />
            <span>{t('library.statClouds')}</span>
          </li>
          <li className="library-stat">
            <CountUp className="tabular" value={TEMPLATES.length + 1} />
            <span>{t('library.statTemplates')}</span>
          </li>
        </ul>
      </div>
    </section>
  );
}
