'use client';

import type { DiagramModel } from '@/lib/domain';
import type { MessageKey } from '@/lib/i18n/messages';
import { ArrowRightIcon, PlusIcon } from '@/components/icons/ToolIcons';
import type { TemplatePreview } from './TemplateGallery';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * The one place in the app with room to say what it is: the words on the
 * left, and on the right the proof — a real template, really drawn, that
 * opens as a new diagram when pressed.
 */
export function LibraryHero({
  t,
  showcase,
  onNew,
  onBrowseTemplates,
  onPick,
}: {
  t: Translate;
  /** The template drawn large on the right; opens as a new diagram when pressed. */
  showcase: TemplatePreview | undefined;
  onNew: () => void;
  onBrowseTemplates: () => void;
  onPick: (title: string, model: DiagramModel) => void;
}) {
  return (
    <section className="library-hero">
      <div className="library-hero-inner is-split">
        <div className="library-hero-copy">
          <h1 className="library-hero-title">{t('library.heroTitle')}</h1>
          <p className="library-hero-lede">{t('library.heroLede')}</p>
          <div className="library-hero-actions">
            <button type="button" className="button is-primary" onClick={onNew}>
              <PlusIcon size={15} />
              {t('library.heroCta')}
            </button>
            <button type="button" className="button is-ghost" onClick={onBrowseTemplates}>
              {t('library.browseTemplates')}
            </button>
          </div>
        </div>
        {showcase && (
          <button
            type="button"
            className="library-showcase"
            aria-label={`${t('library.open')}: ${t(showcase.template.nameKey)}`}
            onClick={() => onPick(t(showcase.template.nameKey), showcase.model)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
            <img className="library-showcase-image" src={showcase.src} alt="" />
            <span className="library-showcase-caption">
              <span className="library-showcase-name">{t(showcase.template.nameKey)}</span>
              <span className="library-showcase-hint">
                {t('library.open')}
                <ArrowRightIcon size={13} />
              </span>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
