'use client';

import type { DiagramMeta, DiagramModel } from '@/lib/domain';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import type { MessageKey } from '@/lib/i18n/messages';
import { shortcut } from '@/lib/editor/platform';
import { thumbnailDataUrl } from '@/lib/store/thumbnail';
import { ArrowRightIcon, PlusIcon } from '@/components/icons/ToolIcons';
import type { TemplatePreview } from './TemplateGallery';
import type { DiagramPreview } from './useDiagramPreviews';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** The diagram the reader touched last, drawn large; the stored thumbnail stands in until then. */
export interface RecentDiagram {
  meta: DiagramMeta;
  preview: DiagramPreview | undefined;
}

/** How much a drawing holds, in the two numbers that say it. */
function sizeOf(t: Translate, model: DiagramModel): string {
  const shapes = model.shapes.filter((s) => s.type === 'item').length;
  return `${t('status.shapes', { count: shapes })} · ${t('status.connectors', { count: model.connectors.length })}`;
}

/**
 * The one place in the app with room to say what it is: the words on the
 * left — what this is, what it does, three things worth knowing — and on the
 * right the proof, a window onto a real drawing. On a first visit the window
 * shows a template, which opens as a new diagram when pressed; once there is
 * work here it shows the diagram touched last, which opens itself.
 */
export function LibraryHero({
  t,
  loading = false,
  showcase,
  recent,
  onNew,
  onBrowseTemplates,
  onPick,
  onOpen,
}: {
  t: Translate;
  /** The list is still being read, so what the window shows is not yet known. */
  loading?: boolean;
  /** The template shown on a first visit; opens as a new diagram when pressed. */
  showcase: TemplatePreview | undefined;
  /** The diagram last worked on; when present, the window shows it instead. */
  recent?: RecentDiagram;
  onNew: () => void;
  onBrowseTemplates: () => void;
  onPick: (title: string, model: DiagramModel) => void;
  onOpen: (meta: DiagramMeta) => void;
}) {
  // What the window shows: the last diagram, or the template as a stand-in.
  const pane = recent
    ? {
        kind: 'recent' as const,
        title: recent.meta.title,
        src:
          recent.preview?.src ??
          (recent.meta.thumbnail ? thumbnailDataUrl(recent.meta.thumbnail) : null),
        model: recent.preview?.model,
        open: () => onOpen(recent.meta),
      }
    : showcase
      ? {
          kind: 'template' as const,
          title: t(showcase.template.nameKey),
          src: showcase.src,
          model: showcase.model,
          open: () => onPick(t(showcase.template.nameKey), showcase.model),
        }
      : null;

  return (
    <section className={`library-hero${loading ? ' is-loading' : ''}`} aria-busy={loading}>
      <div className="library-hero-inner is-split">
        <div className="library-hero-copy">
          <p className="library-hero-eyebrow">
            <span className="library-hero-eyebrow-dot" aria-hidden="true" />
            {t('library.eyebrow')}
          </p>
          <h1 className="library-hero-title">
            {t('library.heroTitleLead')}{' '}
            <span className="library-hero-title-accent">{t('library.heroTitleTail')}</span>
          </h1>
          <p className="library-hero-lede">{t('library.heroLede')}</p>
          <div className="library-hero-actions">
            <button type="button" className="button is-primary is-large" onClick={onNew}>
              <PlusIcon size={16} />
              {t('library.heroCta')}
            </button>
            <button type="button" className="button is-ghost is-large" onClick={onBrowseTemplates}>
              {t('library.browseTemplates')}
            </button>
          </div>
          <ul className="library-hero-points">
            <li className="library-point">
              <span className="library-point-tag is-neutral">{shortcut('K')}</span>
              {t('library.pointSearch', { count: SERVICE_ICONS.length })}
            </li>
            <li className="library-point">
              <span className="library-point-tag is-accent">YAML</span>
              {t('library.pointCode')}
            </li>
            <li className="library-point">
              <span className="library-point-tag is-warning">PDF</span>
              {t('library.pointShare')}
            </li>
          </ul>
        </div>
        {pane && (
          <button
            type="button"
            className="library-showcase"
            data-kind={pane.kind}
            aria-label={`${t('library.open')}: ${pane.title}`}
            onClick={pane.open}
          >
            <span className="library-showcase-bar">
              <span className="library-showcase-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="library-showcase-name">{pane.title}</span>
              <span className="library-showcase-live">
                <i aria-hidden="true" />
                {t('library.showcaseLive')}
              </span>
            </span>
            {pane.src ? (
              // eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL
              <img className="library-showcase-image" src={pane.src} alt="" />
            ) : (
              <span className="library-showcase-image is-empty" />
            )}
            <span className="library-showcase-caption">
              <span className="library-showcase-label">{t('library.showcaseLabel')}</span>
              {pane.model && <span className="library-showcase-meta">{sizeOf(t, pane.model)}</span>}
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
