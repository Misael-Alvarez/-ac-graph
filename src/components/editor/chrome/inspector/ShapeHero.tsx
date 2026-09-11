'use client';

import { CATEGORY_SHORT_LABELS } from '@/data/serviceIcons';
import type { CustomIcon, Shape } from '@/lib/domain';
import { isCustomIconKey } from '@/lib/icons/customIcons';
import type { MessageKey } from '@/lib/i18n/messages';
import { paletteFor, providerOf } from '@/lib/editor/providers';
import { firstLine } from '@/lib/editor/richText';
import {
  BoundaryIcon,
  GroupIcon,
  NoteIcon,
  RegionIcon,
  SubBoundaryIcon,
  TextIcon,
} from '@/components/icons/ToolIcons';

export function shapeTypeKey(shape: Shape): MessageKey {
  if (shape.type === 'boundary') {
    return shape.variant === 'sub' ? 'inspector.type.subboundary' : 'inspector.type.boundary';
  }
  return `inspector.type.${shape.type}` as MessageKey;
}

/** The mark in the hero when a shape has no service icon of its own. */
function TypeGlyph({ shape }: { shape: Shape }) {
  if (shape.type === 'boundary') {
    return shape.variant === 'sub' ? <SubBoundaryIcon size={22} /> : <BoundaryIcon size={22} />;
  }
  if (shape.type === 'region') return <RegionIcon size={22} />;
  if (shape.type === 'note') return <NoteIcon size={22} />;
  if (shape.type === 'text') return <TextIcon size={22} />;
  return <GroupIcon size={22} />;
}

/**
 * Whether the hero's title is the shape's name, to be typed into.
 *
 * A note or a text has no name apart from what it says, and what it says can
 * run to several lines — which a single-line field would fold into one the
 * moment it was touched. Those two show their first line here and are edited
 * in the panel's text field instead.
 */
export function heroIsEditable(shape: Shape): boolean {
  return shape.type !== 'note' && shape.type !== 'text';
}

/**
 * The top of the panel: what is selected, as the canvas draws it.
 *
 * The icon in its provider's tint, the name as an editable field that looks
 * like a title until touched, and beneath them what kind of thing it is and
 * which cloud it belongs to. A panel that opened with the word "Properties"
 * and a form told the reader nothing they could not already see.
 */
export function ShapeHero({
  shape,
  iconKey,
  typeLabel,
  titleLabel,
  customIcons,
  customBadge,
  onRename,
}: {
  shape: Shape;
  iconKey: string | undefined;
  typeLabel: string;
  titleLabel: string;
  customIcons: CustomIcon[];
  customBadge: string;
  onRename: (title: string) => void;
}) {
  const custom =
    iconKey && isCustomIconKey(iconKey) ? customIcons.find((i) => i.key === iconKey) : undefined;
  const provider = iconKey && !custom ? providerOf(iconKey) : null;
  const palette = paletteFor(custom ? undefined : iconKey);
  const providerLabel = custom
    ? (custom.source ?? customBadge)
    : provider && provider !== 'generic'
      ? (CATEGORY_SHORT_LABELS[provider] ?? provider)
      : null;
  return (
    <header
      className="inspector-hero"
      style={{ '--cloud-color': palette.border } as React.CSSProperties}
    >
      <span className="inspector-hero-icon" aria-hidden="true">
        {iconKey ? (
          <svg width={28} height={28} viewBox="0 0 28 28">
            <use href={`#i-${iconKey}`} width={28} height={28} />
          </svg>
        ) : (
          <TypeGlyph shape={shape} />
        )}
      </span>
      <div className="inspector-hero-text">
        {heroIsEditable(shape) ? (
          <input
            className="input inspector-hero-title"
            value={shape.title ?? ''}
            aria-label={titleLabel}
            placeholder={titleLabel}
            spellCheck={false}
            onChange={(e) => onRename(e.target.value)}
          />
        ) : (
          <p className="inspector-hero-title is-static">
            {firstLine(shape.title ?? '') || typeLabel}
          </p>
        )}
        <div className="inspector-hero-meta">
          <span className="inspector-type">{typeLabel}</span>
          {providerLabel && (
            <span className="inspector-provider">
              <span className="chip-dot" aria-hidden="true" />
              {providerLabel}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
