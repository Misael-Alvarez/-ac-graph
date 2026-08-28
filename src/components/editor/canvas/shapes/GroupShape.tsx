import { G } from '@/lib/engine';
import { fontSize, fontWeight, isColor, readableTextOn } from '@/lib/design/tokens';
import { handlersFor, type ShapeRenderProps } from './shapeProps';

/** A service group: a titled card that holds a stack of items. */
export function GroupShape({ shape, theme, summary, interaction }: ShapeRenderProps) {
  const titleY = shape.y + G.GROUP_TITLE_DY - 8;
  const dividerY = shape.y + G.GROUP_TITLE_DY + 2;
  const background = isColor(shape.fill) ? shape.fill : theme.groupFill;
  // A template or the colour picker can set any fill, so the title colour has to
  // be derived from it rather than taken from the theme.
  const titleColor = readableTextOn(background, theme);

  return (
    <g>
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        rx={10}
        fill={background}
        stroke={theme.groupStroke}
        strokeWidth={1}
        filter="url(#card-shadow)"
        {...handlersFor(shape.id, interaction)}
      />
      <g pointerEvents="none">
        <text
          x={shape.x + G.GROUP_TITLE_DX}
          y={titleY}
          fontSize={fontSize.sm}
          fontWeight={fontWeight.semibold}
          fill={titleColor}
        >
          {shape.title}
        </text>
        <line
          x1={shape.x + 12}
          y1={dividerY}
          x2={shape.x + shape.w - 12}
          y2={dividerY}
          stroke={theme.divider}
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
