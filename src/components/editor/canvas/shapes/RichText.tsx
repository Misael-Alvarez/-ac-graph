import { fontWeight } from '@/lib/design/tokens';
import { layoutRichText, type TextLayout } from '@/lib/editor/richText';

const CODE_FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

export interface RichTextProps {
  /** The text, in the little markup `richText` reads. */
  source: string;
  /** Top-left corner of the text column. */
  x: number;
  y: number;
  width: number;
  fontSize: number;
  color: string;
  /** When set, everything past this height is clipped: the paper has an edge. */
  maxHeight?: number;
  /** Id for the clip, unique per shape; needed only with `maxHeight`. */
  clipId?: string;
}

/** The layout a renderer would draw, for a caller that has to size the paper to it. */
export function richTextLayout(source: string, width: number, fontSize: number): TextLayout {
  return layoutRichText(source, { width, fontSize });
}

/**
 * A block of wrapped, lightly styled text, as SVG.
 *
 * One `<text>` per line, one `<tspan>` per run: the layout was decided in
 * numbers by `layoutRichText`, so what the canvas draws, what the export
 * writes and what the embed serves are the same lines broken at the same
 * words. Code runs take a monospace face and sit a little smaller, the way a
 * code span does in prose.
 */
export function RichText({
  source,
  x,
  y,
  width,
  fontSize,
  color,
  maxHeight,
  clipId,
}: RichTextProps) {
  const layout = layoutRichText(source, { width, fontSize });
  if (!layout.lines.length) return null;

  const body = (
    <g pointerEvents="none">
      {layout.lines.map((line, index) => {
        const lineX = x + line.indent;
        return (
          <text
            key={index}
            x={lineX}
            y={y + line.baseline}
            fontSize={line.fontSize}
            fontWeight={line.bold ? fontWeight.semibold : fontWeight.regular}
            fill={color}
            letterSpacing={line.bold && line.fontSize > fontSize ? '-0.015em' : undefined}
          >
            {line.marker && (
              <tspan x={x + line.indent * 0.15} fontWeight={fontWeight.semibold}>
                {line.marker}
              </tspan>
            )}
            {line.runs.map((run, runIndex) => (
              <tspan
                key={runIndex}
                // After a marker the text starts at the indent, not where the
                // marker's glyph happened to end; the runs then flow, so the
                // browser's real advances join them with no seam.
                x={runIndex === 0 && line.marker ? lineX : undefined}
                fontWeight={run.bold && !line.bold ? fontWeight.semibold : undefined}
                fontStyle={run.italic ? 'italic' : undefined}
                fontFamily={run.code ? CODE_FONT : undefined}
                fontSize={run.code ? line.fontSize * 0.92 : undefined}
              >
                {run.text}
              </tspan>
            ))}
          </text>
        );
      })}
    </g>
  );

  if (maxHeight === undefined || layout.height <= maxHeight || !clipId) return body;
  return (
    <>
      <clipPath id={clipId}>
        <rect x={x - 2} y={y} width={width + 4} height={maxHeight} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>{body}</g>
    </>
  );
}
