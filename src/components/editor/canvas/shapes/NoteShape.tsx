import { fontSize, isColor, mixHex, readableTextOn } from '@/lib/design/tokens';
import { RichText } from './RichText';
import { handlersFor, type ShapeRenderProps } from './shapeProps';

const PAD = 14;
/** Size of the turned-up corner. */
const FOLD = 18;

/**
 * A note: a square of paper laid over the diagram.
 *
 * Yellow unless the author picked another colour, with one corner turned up
 * so it reads as paper and not as another card; the ink is chosen against the
 * paper, so a note on dark blue paper is as legible as one on yellow. The text
 * is wrapped by `RichText` and clipped at the paper's edge — a note that has
 * more to say than fits is resized, not spilled.
 */
export function NoteShape({ shape, theme, interaction }: ShapeRenderProps) {
  const paper = isColor(shape.fill) ? shape.fill : theme.notePaper;
  const ink = readableTextOn(paper, theme);
  const fold = mixHex(paper, '#000000', 0.14);
  const { x, y, w, h } = shape;
  const outline = [
    `M${x},${y}`,
    `H${x + w}`,
    `V${y + h - FOLD}`,
    `L${x + w - FOLD},${y + h}`,
    `H${x}`,
    'Z',
  ].join(' ');

  return (
    <g>
      <path
        d={outline}
        fill={paper}
        filter="url(#card-shadow)"
        {...handlersFor(shape.id, interaction)}
      />
      {/* The flap: the corner folded back over the paper, a shade darker. */}
      <path
        d={`M${x + w - FOLD},${y + h} L${x + w},${y + h - FOLD} L${x + w - FOLD},${y + h - FOLD} Z`}
        fill={fold}
        pointerEvents="none"
      />
      <RichText
        source={shape.title ?? ''}
        x={x + PAD}
        y={y + PAD - 2}
        width={Math.max(w - PAD * 2, 20)}
        fontSize={fontSize.base}
        color={ink}
        maxHeight={Math.max(h - PAD * 2 + 2, 0)}
        clipId={`clip-note-${shape.id}`}
      />
    </g>
  );
}
