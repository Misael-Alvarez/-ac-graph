import { isColor, isDarkCanvas } from '@/lib/design/tokens';
import { handlersFor, type ShapeRenderProps } from './shapeProps';

/**
 * The dashed well inside a group that the item stack sits in.
 *
 * Its colour is the provider's, but held back: the well frames the cards, it
 * does not compete with them. On the dark sheet a full-strength orange dash
 * was the loudest thing on screen, so it fades further there.
 */
export function ContainerShape({ shape, theme, interaction }: ShapeRenderProps) {
  const stroke = isColor(shape.fill) ? shape.fill : theme.containerStroke;
  const dark = isDarkCanvas(theme);
  return (
    <rect
      x={shape.x}
      y={shape.y}
      width={shape.w}
      height={shape.h}
      rx={10}
      fill={stroke}
      fillOpacity={dark ? 0.05 : 0.06}
      stroke={stroke}
      strokeOpacity={dark ? 0.5 : 0.8}
      strokeWidth={1.2}
      strokeDasharray="5 5"
      {...handlersFor(shape.id, interaction)}
    />
  );
}
