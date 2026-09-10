import {
  fontSize,
  fontWeight,
  isColor,
  isDarkCanvas,
  mixHex,
  readableTextOn,
} from '@/lib/design/tokens';
import { paletteFor } from '@/lib/editor/providers';
import { handlersFor, type ShapeRenderProps } from './shapeProps';

const HEADER_H = 34;
const RADIUS = 14;

/**
 * A cloud boundary or a sub-boundary zone, drawn as a titled panel.
 *
 * The body is a wash of the provider's colour over the sheet — pale on paper,
 * a deep tint on the dark canvas — so the zone reads as territory rather than
 * as another card. The header keeps the provider's full colour: it is the one
 * place the brand is allowed to be loud.
 */
export function BoundaryShape({ shape, theme, interaction }: ShapeRenderProps) {
  const palette = paletteFor(shape.icon?.key);
  const isSub = shape.variant === 'sub';
  const dark = isDarkCanvas(theme);
  // A zone's colours come from the provider it carries, unless the reader has
  // chosen one: then that colour is the accent, and the body is the same hue
  // held far enough back that the shapes inside stay readable on it.
  const accent = isColor(shape.fill) ? shape.fill : null;
  const headerFill = accent ?? (isSub ? palette.subHeader : palette.header);
  const body = accent
    ? mixHex(theme.sheet, accent, dark ? 0.12 : 0.1)
    : dark
      ? mixHex(theme.sheet, palette.border, isSub ? 0.05 : 0.08)
      : palette.body;
  const clipId = `clip-header-${shape.id}`;

  return (
    <g>
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={RADIUS}
        fill={body}
        fillOpacity={dark || accent ? 1 : 0.55}
        stroke={accent ?? palette.border}
        strokeOpacity={dark ? 0.55 : 1}
        strokeWidth={1.25}
        {...handlersFor(shape.id, interaction)}
      />
      {/* Round only the top corners of the header by clipping it to the panel. */}
      <clipPath id={clipId}>
        <rect x={shape.x} y={shape.y} width={shape.w} height={HEADER_H} rx={RADIUS} />
        <rect x={shape.x} y={shape.y + RADIUS} width={shape.w} height={HEADER_H - RADIUS} />
      </clipPath>
      <g clipPath={`url(#${clipId})`} pointerEvents="none">
        <rect x={shape.x} y={shape.y} width={shape.w} height={HEADER_H} fill={headerFill} />
        {/* A sliver of light along the header's top edge, the way a raised panel catches it. */}
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={1}
          fill="#ffffff"
          fillOpacity={0.22}
        />
        {shape.icon && (
          <use
            href={`#i-${shape.icon.key}`}
            x={shape.x + 9}
            y={shape.y + 6}
            width={22}
            height={22}
          />
        )}
        <text
          x={shape.x + (shape.icon ? 38 : 12)}
          y={shape.y + HEADER_H / 2 + 4}
          fontSize={fontSize.sm}
          fontWeight={fontWeight.semibold}
          letterSpacing="-0.01em"
          fill={accent ? readableTextOn(accent, theme) : palette.headerText}
        >
          {shape.title}
        </text>
      </g>
    </g>
  );
}
