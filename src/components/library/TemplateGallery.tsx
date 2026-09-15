'use client';

import type { CSSProperties } from 'react';
import type { DiagramMeta, DiagramModel } from '@/lib/domain';
import type { Template } from '@/lib/editor/templates';
import type { MessageKey } from '@/lib/i18n/messages';
import { relativeDay } from '@/lib/i18n/relativeDay';
import { PencilIcon, PlusIcon, TrashIcon } from '@/components/icons/ToolIcons';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** A template drawn for real, small, in the current language and theme. */
export interface TemplatePreview {
  template: Template;
  model: DiagramModel;
  /** The preview as an SVG data URL. */
  src: string;
}

/** One of the reader's own starting points, drawn the same way. */
export interface OwnTemplatePreview {
  meta: DiagramMeta;
  model: DiagramModel;
  src: string;
}

/** How much a starting point holds, in the two numbers that say it. */
function TemplateMeta({ t, model }: { t: Translate; model: DiagramModel }) {
  return (
    <span className="template-meta">
      {t('status.shapes', { count: model.shapes.filter((s) => s.type === 'item').length })}
      {' · '}
      {t('status.connectors', { count: model.connectors.length })}
    </span>
  );
}

const stagger = (index: number) => ({ '--i': index }) as CSSProperties;

/**
 * Starting points, always: a real drawing of each, not an icon. A blank sheet
 * first, then the reader's own templates — theirs come before the house's —
 * then every built-in template with what it produces and how much is in it.
 * Same card as a diagram's, so the page has one kind of card.
 */
export function TemplateGallery({
  t,
  previews,
  yours = [],
  entering = false,
  onPick,
  onEdit,
  onRemove,
}: {
  t: Translate;
  previews: TemplatePreview[];
  yours?: OwnTemplatePreview[];
  /** True for the first paint, when the cards rise into place once. */
  entering?: boolean;
  onPick: (title: string, model?: DiagramModel) => void;
  /** Open one of the reader's templates to change it. */
  onEdit?: (meta: DiagramMeta) => void;
  /** Delete one of the reader's templates — or leave a shared one. The card only asks. */
  onRemove?: (meta: DiagramMeta) => void;
}) {
  return (
    <section className="library-start" id="library-start">
      <div className="library-section-head">
        <h2>{t('library.startPoints')}</h2>
        <p>{t('library.startPointsHint')}</p>
      </div>
      <div className={`library-templates is-rich${entering ? ' is-entering' : ''}`}>
        <button
          type="button"
          className="template-card is-blank is-rich"
          style={stagger(0)}
          onClick={() => onPick(t('app.untitled'))}
        >
          <span className="template-thumb is-blank">
            <PlusIcon size={20} />
          </span>
          <span className="template-text">
            <b>{t('library.blank')}</b>
            <small>{t('library.blankHint')}</small>
          </span>
        </button>
        {yours.map(({ meta, model, src }, index) => {
          const shared = meta.role !== undefined && meta.role !== 'owner';
          return (
            /* Not a button itself: the actions in its corner are buttons, and a
               button holds no other. The face is the button, and fills it. */
            <div
              key={meta.id}
              className="template-card is-rich is-yours"
              style={stagger(index + 1)}
            >
              <button
                type="button"
                className="template-open"
                onClick={() => onPick(meta.title, structuredClone(model))}
              >
                <span className="template-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
                  <img src={src} alt="" />
                </span>
                <span className="template-text">
                  <b>{meta.title}</b>
                  <small>
                    {t(shared ? 'library.templateShared' : 'library.templateYours', {
                      when: relativeDay(meta.updatedAt, t),
                    })}
                  </small>
                  <TemplateMeta t={t} model={model} />
                </span>
              </button>
              <div className="template-actions">
                {onEdit && !(shared && meta.role === 'viewer') && (
                  <button
                    type="button"
                    className="icon-button"
                    title={t('library.editTemplate')}
                    aria-label={`${t('library.editTemplate')}: ${meta.title}`}
                    onClick={() => onEdit(meta)}
                  >
                    <PencilIcon size={14} />
                  </button>
                )}
                {onRemove && (
                  <button
                    type="button"
                    className={`icon-button${shared ? '' : ' is-danger'}`}
                    title={t(shared ? 'share.leave' : 'action.delete')}
                    aria-label={`${t(shared ? 'share.leave' : 'action.delete')}: ${meta.title}`}
                    onClick={() => onRemove(meta)}
                  >
                    <TrashIcon size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {previews.map(({ template, model, src }, index) => (
          <button
            key={template.id}
            type="button"
            className="template-card is-rich"
            style={stagger(yours.length + 1 + index)}
            onClick={() => onPick(t(template.nameKey), model)}
          >
            <span className="template-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
              <img src={src} alt="" />
            </span>
            <span className="template-text">
              <b>{t(template.nameKey)}</b>
              <small>{t(template.descriptionKey)}</small>
              <TemplateMeta t={t} model={model} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
