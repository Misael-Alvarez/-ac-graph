import { fontSize, isColor } from '@/lib/design/tokens';
import { RichText } from './RichText';
import { handlersFor, type ShapeRenderProps } from './shapeProps';

/**
 * A free text: words on the sheet with nothing behind them.
 *
 * A caption, a phase name, a footnote. It takes the theme's ink unless the
 * author chose one, and its box is only where it can be grabbed: the
 * rectangle is painted with no opacity at all so the sheet shows through, but
 * still answers the pointer, which a `fill="none"` never would.
 */
export function TextShape({ shape, theme, interaction }: ShapeRenderProps) {
  const ink = isColor(shape.fill) ? shape.fill : theme.titleText;
  return (
    <g>
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.w}
        height={shape.h}
        fill={theme.sheet}
        fillOpacity={0}
        {...handlersFor(shape.id, interaction)}
      />
      <RichText
        source={shape.title ?? ''}
        x={shape.x + 4}
        y={shape.y + 2}
        width={Math.max(shape.w - 8, 20)}
        fontSize={fontSize.md}
        color={ink}
        maxHeight={Math.max(shape.h - 2, 0)}
        clipId={`clip-text-shape-${shape.id}`}
      />
    </g>
  );
}
