import { fontSize, fontWeight, isColor, isDarkCanvas, mixHex } from '@/lib/design/tokens';
import { accentForFill } from '@/lib/editor/providers';
import { handlersFor, type ShapeRenderProps } from './shapeProps';

const RADIUS = 16;

/**
 * A region: a tinted zone under the diagram, with a caption in its corner.
 *
 * Unlike a boundary it claims nothing — no provider, no membership, no place
 * in the DSL's `in:`. It is the highlighter a reader runs over the part of the
 * picture they are talking about: "this is the DMZ", "these move in phase 2".
 * So it is painted first, under everything, as a wash the cards sit on, and
 * its edge is dashed so it never reads as a wall.
 */
export function RegionShape({ shape, theme, interaction }: ShapeRenderProps) {
  const dark = isDarkCanvas(theme);
  const chosen = isColor(shape.fill) ? shape.fill : null;
  const accent = chosen ? accentForFill(chosen, theme) : theme.regionStroke;
  // A chosen colour is the wash itself on paper, where every preset is already
  // pale; on the dark sheet the same pastel would glare, so the sheet is
  // tinted towards the colour's accent instead.
  const body = chosen ? (dark ? mixHex(theme.sheet, accent, 0.18) : chosen) : theme.regionTint;
  const caption = chosen ? (dark ? mixHex(accent, '#ffffff', 0.35) : accent) : theme.subtitleText;

  return (
    <g>
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={RADIUS}
        fill={body}
        fillOpacity={chosen && !dark ? 0.6 : 1}
        stroke={accent}
        strokeOpacity={chosen ? 0.55 : 1}
        strokeWidth={1.25}
        strokeDasharray="7 5"
        {...handlersFor(shape.id, interaction)}
      />
      {shape.title && (
        <text
          x={shape.x + 16}
          y={shape.y + 24}
          fontSize={fontSize.sm}
          fontWeight={fontWeight.semibold}
          letterSpacing="0.04em"
          fill={caption}
          pointerEvents="none"
        >
          {shape.title.toUpperCase()}
        </text>
      )}
    </g>
  );
}
