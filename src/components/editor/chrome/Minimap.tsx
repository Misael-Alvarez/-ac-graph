'use client';

import { useMemo, useRef } from 'react';
import { contentBBox } from '@/lib/engine';
import { canvasTheme, providerColors } from '@/lib/design/tokens';
import { providerOf } from '@/lib/editor/providers';
import { centerOn, visibleBox } from '@/lib/editor/viewport';
import { useEditor } from '../EditorProvider';
import { CloseIcon } from '@/components/icons/ToolIcons';

const WIDTH = 190;
const HEIGHT = 128;

export function Minimap({ size }: { size: { width: number; height: number } }) {
  const { ui, view: model, dispatchUi, t } = useEditor();
  const theme = canvasTheme(ui.dark);
  const svgRef = useRef<SVGSVGElement>(null);

  const box = useMemo(() => contentBBox(model), [model]);
  const view = size.width ? visibleBox(ui.viewport, size) : null;
  /* The map shows the content and the camera, whichever is larger. Fixed to
     the content alone, zooming out pushed the camera rectangle past the edges
     where it was clipped into a border, and the map looked frozen. Framed on
     both, the rectangle grows as you zoom out and shrinks as you zoom in,
     which is the one thing a map of where-you-are has to do. */
  const viewBox = useMemo(() => {
    const pad = Math.max(box.w, box.h) * 0.06 + 40;
    let x = box.x - pad;
    let y = box.y - pad;
    let right = box.x + box.w + pad;
    let bottom = box.y + box.h + pad;
    if (view) {
      x = Math.min(x, view.x);
      y = Math.min(y, view.y);
      right = Math.max(right, view.x + view.w);
      bottom = Math.max(bottom, view.y + view.h);
    }
    return { x, y, w: right - x, h: bottom - y };
  }, [box, view]);

  if (!ui.minimapOpen || !model.shapes.length) return null;

  const strokeScale = viewBox.w / WIDTH;

  /**
   * Where a pointer is, in canvas coordinates.
   *
   * The map's aspect ratio is not the diagram's, so the SVG letterboxes the
   * content ("meet"): the drawing is centred inside the box and the margins are
   * not part of it. Dividing by the element's size instead of by the scale that
   * actually applied is what makes a minimap jump to the wrong place near its
   * edges.
   */
  const pointToCanvas = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / viewBox.w, rect.height / viewBox.h);
    return {
      x: viewBox.x + (event.clientX - rect.left - (rect.width - viewBox.w * scale) / 2) / scale,
      y: viewBox.y + (event.clientY - rect.top - (rect.height - viewBox.h * scale) / 2) / scale,
    };
  };

  const goTo = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!size.width) return;
    dispatchUi({
      type: 'setViewport',
      viewport: centerOn(ui.viewport, pointToCanvas(event), size),
    });
  };

  return (
    <div className="minimap" aria-label={t('action.toggleMinimap')}>
      <div className="minimap-header">
        <span>{t('action.toggleMinimap')}</span>
        <button
          type="button"
          className="minimap-close"
          aria-label={t('modal.close')}
          onClick={() => dispatchUi({ type: 'toggleMinimap' })}
        >
          <CloseIcon size={12} />
        </button>
      </div>
      {/* A map you can only look at is half a map: clicking or dragging moves
          the canvas, which is the whole reason to know where you are. */}
      <svg
        ref={svgRef}
        className="minimap-surface"
        width={WIDTH}
        height={HEIGHT}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          goTo(e);
        }}
        onPointerMove={(e) => {
          // The primary button is still down: `buttons`, not a piece of state,
          // because pointer capture already guarantees the moves arrive here.
          if (e.buttons & 1) goTo(e);
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      >
        <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill={theme.sheet} />
        {model.shapes
          .filter((s) => s.type === 'region')
          .map((s) => (
            <rect
              key={s.id}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx={8}
              fill={theme.regionTint}
              stroke={theme.regionStroke}
              strokeWidth={strokeScale}
            />
          ))}
        {model.shapes
          .filter((s) => s.type === 'boundary')
          .map((s) => (
            <rect
              key={s.id}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx={6}
              fill={theme.groupFill}
              stroke={theme.groupStroke}
              strokeWidth={strokeScale}
            />
          ))}
        {model.shapes
          .filter((s) => s.type === 'group')
          .map((s) => (
            <rect
              key={s.id}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx={4}
              fill={theme.itemFill}
              stroke={theme.itemStroke}
              strokeWidth={strokeScale}
            />
          ))}
        {model.shapes
          .filter((s) => s.type === 'item')
          .map((s) => (
            <rect
              key={s.id}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx={3}
              // The provider's own colour, as the library thumbnails use: every
              // service was drawn in the brand purple, so a map of an AWS
              // diagram looked like a map of some other diagram entirely.
              fill={
                providerColors[providerOf(s.icon?.key) as keyof typeof providerColors] ??
                providerColors.generic
              }
              opacity={0.7}
            />
          ))}
        {model.shapes
          .filter((s) => s.type === 'note')
          .map((s) => (
            <rect
              key={s.id}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx={2}
              fill={theme.notePaper}
              opacity={0.85}
            />
          ))}
        {view && (
          // Where the user currently is, in canvas coordinates.
          <rect
            x={view.x}
            y={view.y}
            width={view.w}
            height={view.h}
            fill="none"
            stroke="var(--selection)"
            strokeWidth={strokeScale * 2}
          />
        )}
      </svg>
    </div>
  );
}
