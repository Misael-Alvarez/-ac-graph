import { G } from '@/lib/engine';
import { fontSize, fontWeight, isColor, mixHex, readableTextOn } from '@/lib/design/tokens';
import { accentForFill, themedFill } from '@/lib/editor/providers';
import { handlersFor, type ShapeRenderProps } from './shapeProps';

const RADIUS = 12;

/**
 * A service group: a titled card that holds a stack of items.
 *
 * The header carries a small mark in the provider's colour — the one visual
 * that says "this is AWS, that is GCP" from across the room — and the divider
 * fades in from the mark rather than cutting the card in two. The fill is
 * adapted to the sheet, so a template's cream group is cream on paper and a
 * faintly warm dark card under the dark theme.
 */
export function GroupShape({ shape, theme, summary, interaction }: ShapeRenderProps) {
  const titleY = shape.y + G.GROUP_TITLE_DY - 8;
  const dividerY = shape.y + G.GROUP_TITLE_DY + 2;
  const background = themedFill(shape.fill, theme) ?? theme.groupFill;
  const accent = accentForFill(shape.fill, theme);
  // A template or the colour picker can set any fill, so the title colour has to
  // be derived from it rather than taken from the theme.
  const titleColor = readableTextOn(background, theme);
  const stroke = isColor(shape.fill) ? mixHex(theme.groupStroke, accent, 0.35) : theme.groupStroke;
  const gradientId = `group-divider-${shape.id}`;

  return (
    <g>
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={RADIUS}
        fill={background}
        stroke={stroke}
        strokeWidth={1}
        filter="url(#card-shadow)"
        {...handlersFor(shape.id, interaction)}
      />
      <g pointerEvents="none">
        {/* The provider mark: a rounded chip beside the title. */}
        <rect
          x={shape.x + G.GROUP_TITLE_DX - 2}
          y={titleY - 9}
          width={4}
          height={12}
          rx={2}
          fill={accent}
        />
        <text
          x={shape.x + G.GROUP_TITLE_DX + 10}
          y={titleY}
          fontSize={fontSize.sm}
          fontWeight={fontWeight.semibold}
          fill={titleColor}
          letterSpacing="-0.01em"
        >
          {shape.title}
        </text>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={accent} stopOpacity={0.55} />
            <stop offset="0.35" stopColor={theme.divider} stopOpacity={1} />
            <stop offset="1" stopColor={theme.divider} stopOpacity={0} />
          </linearGradient>
        </defs>
        <line
          x1={shape.x + 12}
          y1={dividerY}
          x2={shape.x + shape.w - 12}
          y2={dividerY}
          stroke={`url(#${gradientId})`}
          strokeWidth={1}
        />
        {summary !== undefined && (
          /* Zoomed too far out to read the services, so the card says how many
             there are instead of drawing text nobody can make out. */
          <text
            x={shape.x + G.GROUP_TITLE_DX}
            y={shape.y + shape.h / 2 + 20}
            fontSize={fontSize.lg}
            fontWeight={fontWeight.medium}
            fill={titleColor}
            opacity={0.65}
          >
            {summary}
          </text>
        )}
      </g>
    </g>
  );
}
