import {
  fontSize,
  fontWeight,
  isColor,
  isDarkCanvas,
  mixHex,
  readableTextOn,
} from '@/lib/design/tokens';
import { paletteFor, themedFill } from '@/lib/editor/providers';
import {
  REPO_GLYPH_W,
  badgeWidth,
  fitBadges,
  itemBadges,
  lifecycleStyle,
  toneColors,
  type Badge,
} from '@/lib/editor/meta';
import { handlersFor, type ShapeRenderProps } from './shapeProps';

const PAD = 10;
const ICON = 26;
const WELL = 38;
const GAP = 10;
/** The chips along the bottom edge: small caps, one line, whole chips only. */
const CHIP_H = 15;
const CHIP_FONT = 8.5;
const CHIP_GAP = 4;

/**
 * A service card.
 *
 * The icon sits in a soft well tinted by its provider, which gives every card
 * the same left edge whatever the icon's own shape, and text is clipped
 * geometrically rather than truncated by character count: the old renderer
 * guessed a character width (`title.slice(0, width / 7)`), which cut correct
 * labels short and left wrong ones overflowing.
 */
export function ItemShape({ shape, theme, lookup, interaction }: ShapeRenderProps) {
  const container = shape.parentId ? lookup(shape.parentId) : undefined;
  const group = container?.parentId ? lookup(container.parentId) : undefined;
  const palette = paletteFor(shape.icon?.key ?? group?.icon?.key ?? container?.icon?.key);
  const dark = isDarkCanvas(theme);

  // A card the reader has coloured itself carries its own text colours: the
  // theme's near-black title on a navy card is not readable, and the theme has
  // no way to know what colour the card is.
  const tinted = isColor(shape.fill);
  const background =
    (tinted ? themedFill(shape.fill, theme, theme.itemFill) : null) ?? theme.itemFill;
  const titleColor = tinted ? readableTextOn(background, theme) : theme.titleText;
  const stroke = dark ? mixHex(theme.itemStroke, palette.border, 0.45) : palette.border;
  const well = mixHex(background, palette.border, dark ? 0.16 : 0.1);

  const textX = shape.x + PAD + WELL + GAP;
  const textWidth = Math.max(shape.w - (PAD + WELL + GAP) - PAD, 0);
  const clipId = `clip-text-${shape.id}`;

  // What the service says about itself, as chips along the bottom. They take
  // their row from the text block, which moves up to make room, so a card with
  // an inventory and one without keep the same height and the same left edge.
  const fitted = fitBadges(itemBadges(shape), textWidth, CHIP_FONT, CHIP_GAP);
  // What did not fit is still counted, so the card admits what it is not saying.
  const badges: Badge[] = fitted.hidden
    ? [...fitted.kept, { text: `+${fitted.hidden}`, tone: 'neutral', kind: 'tag' }]
    : fitted.kept;
  const chipRow = badges.length ? CHIP_H + 6 : 0;
  const lifecycle = lifecycleStyle(shape);

  // Vertically centre the whole text block, whatever number of lines it has.
  const lines = 1 + (shape.subtitle ? 1 : 0) + (shape.note ? 1 : 0);
  const blockHeight = fontSize.xs * 1.35 + (lines - 1) * fontSize.sm * 1.25;
  let cursorY = shape.y + (shape.h - chipRow) / 2 - blockHeight / 2 + fontSize.xs;

  const titleY = cursorY;
  cursorY += shape.subtitle ? fontSize.sm * 1.25 : 0;
  const subtitleY = cursorY;
  cursorY += shape.note ? fontSize.sm * 1.15 : 0;
  const noteY = cursorY;

  const wellX = shape.x + PAD;
  const wellY = shape.y + (shape.h - WELL) / 2;

  const chipY = shape.y + shape.h - PAD - CHIP_H + 2;
  const placedChips = badges.reduce<{ badge: (typeof badges)[number]; x: number; w: number }[]>(
    (placed, badge) => {
      const previous = placed.at(-1);
      const x = previous ? previous.x + previous.w + CHIP_GAP : textX;
      return [...placed, { badge, x, w: badgeWidth(badge.text, CHIP_FONT, badge.kind) }];
    },
    [],
  );

  return (
    <g opacity={lifecycle.opacity === 1 ? undefined : lifecycle.opacity}>
      <clipPath id={clipId}>
        <rect x={textX} y={shape.y} width={textWidth} height={shape.h} />
      </clipPath>
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={10}
        fill={background}
        stroke={stroke}
        strokeWidth={lifecycle.dashed ? 1.2 : 1}
        strokeDasharray={lifecycle.dashed ? '6 4' : undefined}
        filter="url(#card-shadow)"
        {...handlersFor(shape.id, interaction)}
      />
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={10}
        fill="url(#card-gloss)"
        pointerEvents="none"
      />
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={10}
        fill="url(#card-shade)"
        pointerEvents="none"
      />
      {shape.icon && (
        <g pointerEvents="none">
          <rect x={wellX} y={wellY} width={WELL} height={WELL} rx={9} fill={well} />
          <use
            href={`#i-${shape.icon.key}`}
            x={wellX + (WELL - ICON) / 2}
            y={wellY + (WELL - ICON) / 2}
            width={ICON}
            height={ICON}
          />
        </g>
      )}
      <g clipPath={`url(#${clipId})`} pointerEvents="none">
        <text
          x={textX}
          y={titleY}
          fontSize={fontSize.xs}
          fontWeight={fontWeight.semibold}
          fill={titleColor}
          letterSpacing="-0.005em"
        >
          {shape.title}
        </text>
        {shape.subtitle && (
          <text
            x={textX}
            y={subtitleY}
            fontSize={fontSize.xs - 1}
            fill={tinted ? titleColor : theme.subtitleText}
            fillOpacity={tinted ? 0.75 : 1}
          >
            {shape.subtitle}
          </text>
        )}
        {shape.note && (
          <text
            x={textX}
            y={noteY}
            fontSize={fontSize.xs - 2}
            fill={tinted ? titleColor : theme.noteText}
            fillOpacity={tinted ? 0.6 : 1}
          >
            {shape.note}
          </text>
        )}
        {placedChips.map(({ badge, x, w }, index) => {
          const colors = toneColors(badge.tone, background, theme);
          const repo = badge.kind === 'repository';
          // Names keep their case — a handle, a repository, a tag are spelled,
          // not shouted; states are set in small caps like the labels they are.
          const spelled = repo || badge.kind === 'tag' || badge.kind === 'owner';
          // A tiny branch mark before a repository name, so the chip is read as
          // "where the code is" before the word is.
          const glyphX = x + 7;
          const glyphY = chipY + CHIP_H / 2;
          return (
            <g key={`${badge.kind}-${index}`} data-badge={badge.kind}>
              <rect
                x={x}
                y={chipY}
                width={w}
                height={CHIP_H}
                rx={CHIP_H / 2}
                fill={colors.fill}
                stroke={colors.stroke}
                strokeWidth={0.75}
              />
              {repo && (
                <g fill="none" stroke={colors.text} strokeWidth={1.1} strokeLinecap="round">
                  <circle cx={glyphX} cy={glyphY - 3.2} r={1.3} />
                  <circle cx={glyphX} cy={glyphY + 3.2} r={1.3} />
                  <circle cx={glyphX + 4.6} cy={glyphY - 1.6} r={1.3} />
                  <path d={`M${glyphX},${glyphY - 1.9} V${glyphY + 1.9}`} />
                  <path
                    d={`M${glyphX + 4.6},${glyphY - 0.3} Q${glyphX + 4.4},${glyphY + 2} ${glyphX + 1.4},${glyphY + 2.4}`}
                  />
                </g>
              )}
              <text
                x={x + w / 2 + (repo ? REPO_GLYPH_W / 2 : 0)}
                y={chipY + CHIP_H / 2 + CHIP_FONT * 0.36}
                fontSize={CHIP_FONT}
                fontWeight={fontWeight.semibold}
                fill={colors.text}
                textAnchor="middle"
                letterSpacing={spelled ? '0.02em' : '0.06em'}
              >
                {spelled ? badge.text : badge.text.toUpperCase()}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
}
