'use client';

import type { DiagramModel } from '@/lib/domain';
import type { Template } from '@/lib/editor/templates';
import type { MessageKey } from '@/lib/i18n/messages';
import { PlusIcon } from '@/components/icons/ToolIcons';
import { Glyph } from '@/components/icons/Glyph';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** A template drawn for real, small, in the current language and theme. */
export interface TemplatePreview {
  template: Template;
  model: DiagramModel;
  /** The preview as an SVG data URL. */
  src: string;
}

/**
 * Starting points, always: a real drawing of each, not an icon. A blank sheet
 * first, then every template with what it produces and how much is in it.
 */
export function TemplateGallery({
  t,
  previews,
  onPick,
}: {
  t: Translate;
  previews: TemplatePreview[];
  onPick: (title: string, model?: DiagramModel) => void;
}) {
  return (
    <section className="library-start" id="library-start">
      <div className="library-section-head">
        <h2>{t('library.startPoints')}</h2>
        <p>{t('library.startPointsHint')}</p>
      </div>
      <div className="library-templates is-rich">
        <button
          type="button"
          className="template-card is-blank is-rich"
          onClick={() => onPick(t('app.untitled'))}
        >
          <span className="template-thumb is-blank">
            <PlusIcon size={22} />
          </span>
          <span className="template-text">
            <b>{t('library.blank')}</b>
            <small>{t('library.blankHint')}</small>
          </span>
        </button>
        {previews.map(({ template, model, src }) => (
          <button
            key={template.id}
            type="button"
            className="template-card is-rich"
            onClick={() => onPick(t(template.nameKey), model)}
          >
            <span className="template-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
              <img src={src} alt="" />
              <span className="template-glyph">
                <Glyph name={template.icon} size={14} />
              </span>
            </span>
            <span className="template-text">
              <b>{t(template.nameKey)}</b>
              <small>{t(template.descriptionKey)}</small>
              <span className="template-meta">
                <span>
                  {t('status.shapes', {
                    count: model.shapes.filter((s) => s.type === 'item').length,
                  })}
                </span>
                <span>·</span>
                <span>{t('status.connectors', { count: model.connectors.length })}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
