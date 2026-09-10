'use client';

import { contentBBox } from '@/lib/engine';
import { DEFAULT_VIEWPORT, fitToBox, zoomByAtCenter } from '@/lib/editor/viewport';
import { useEditor } from '../EditorProvider';
import { FitIcon, ZoomInIcon, ZoomOutIcon } from '@/components/icons/ToolIcons';

export function ZoomControls({ size }: { size: { width: number; height: number } }) {
  const { view, ui, dispatchUi, t } = useEditor();
  const percent = Math.round(ui.viewport.zoom * 100);

  // Every control here is a command, so every move it makes glides.
  const setViewport = (viewport: typeof ui.viewport) =>
    dispatchUi({ type: 'setViewport', viewport, smooth: true });

  return (
    /* The group is the zoom cluster, not the fit button inside it: a screen
       reader announced every control in here as part of "Fit to view". */
    <div className="zoom-controls" role="group" aria-label="Zoom">
      <button
        type="button"
        className="icon-button"
        title={t('action.zoomOut')}
        aria-label={t('action.zoomOut')}
        onClick={() => setViewport(zoomByAtCenter(ui.viewport, 1 / 1.2, size))}
      >
        <ZoomOutIcon size={16} />
      </button>
      <button
        type="button"
        className="zoom-value"
        title={t('action.zoomReset')}
        aria-label={t('action.zoomReset')}
        onClick={() => setViewport(DEFAULT_VIEWPORT)}
      >
        {/* Keyed by the value: a fresh node each step, which is what gives the
            readout its own little kick when the zoom changes. */}
        <span key={percent} className="zoom-number tabular">
          {percent}%
        </span>
      </button>
      <button
        type="button"
        className="icon-button"
        title={t('action.zoomIn')}
        aria-label={t('action.zoomIn')}
        onClick={() => setViewport(zoomByAtCenter(ui.viewport, 1.2, size))}
      >
        <ZoomInIcon size={16} />
      </button>
      <span className="zoom-divider" />
      <button
        type="button"
        className="icon-button"
        title={t('action.zoomFit')}
        aria-label={t('action.zoomFit')}
        onClick={() => {
          const inspector = document.querySelector('.inspector')?.getBoundingClientRect();
          const dock = document.querySelector('.tool-dock')?.getBoundingClientRect();
          setViewport(
            fitToBox(contentBBox(view), size, 48, {
              right: inspector ? inspector.width + 32 : 0,
              left: dock ? dock.width + 32 : 0,
            }),
          );
        }}
      >
        <FitIcon size={16} />
      </button>
    </div>
  );
}
