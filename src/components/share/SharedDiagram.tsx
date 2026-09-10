'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { DiagramModel } from '@/lib/domain';
import { iconKeysIn, contentBBox, routeAllConnectors } from '@/lib/engine';
import { canvasTheme } from '@/lib/design/tokens';
import { fitToBox, pan, viewportTransform, zoomAt, type Viewport } from '@/lib/editor/viewport';
import { safeDecodeDiagram } from '@/lib/share/codec';
import { themeFromSearch } from '@/lib/share/links';
import { useLocale } from '@/lib/i18n/useLocale';
import { Defs } from '@/components/editor/canvas/Defs';
import { DiagramScene } from '@/components/editor/canvas/DiagramScene';
import { FitIcon, ZoomInIcon, ZoomOutIcon } from '@/components/icons/ToolIcons';

/**
 * The public read-only view.
 *
 * Renders the same scene component as the editor, without any interaction props,
 * so a viewer gets exactly the picture the author saw and nothing they can edit.
 */
export function SharedDiagram() {
  const params = useSearchParams();
  const { t } = useLocale();
  const [model, setModel] = useState<DiagramModel | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'broken'>('loading');
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const surface = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ x: number; y: number; viewport: Viewport } | null>(null);

  const dark = themeFromSearch(params?.toString() ?? '');
  const theme = canvasTheme(dark === 'dark');
  const payload = params?.get('d') ?? null;

  useEffect(() => {
    let cancelled = false;
    // Resolving through a promise keeps the "no payload" case off the
    // synchronous path too, so the effect never sets state during its own run.
    Promise.resolve(payload ? safeDecodeDiagram(payload) : null).then((decoded) => {
      if (cancelled) return;
      if (!decoded) {
        setState('broken');
        return;
      }
      // The payload omits waypoints; the router rebuilds them.
      routeAllConnectors(decoded);
      setModel(decoded);
      setState('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [state]);

  const box = useMemo(() => (model ? contentBBox(model) : null), [model]);

  // Frame the diagram once the element has been measured.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !box || !size.width || !size.height) return;
    framed.current = true;
    setViewport(fitToBox(box, size, 40));
  }, [box, size]);

  const toLocal = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = surface.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setViewport((current) =>
          zoomAt(current, current.zoom * Math.exp(-e.deltaY / 240), toLocal(e)),
        );
      } else {
        setViewport((current) => pan(current, -e.deltaX, -e.deltaY));
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [toLocal, state]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const start = dragging.current;
      if (!start) return;
      setViewport(pan(start.viewport, e.clientX - start.x, e.clientY - start.y));
    };
    const onUp = () => {
      dragging.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  if (state === 'loading') {
    return <div className="page-note">{t('library.loading')}</div>;
  }

  if (state === 'broken' || !model) {
    return (
      <div className="page-note">
        <p>{t('share.broken')}</p>
      </div>
    );
  }

  return (
    <div className="shared-root" style={{ background: theme.sheet }}>
      <svg
        ref={surface}
        className="shared-surface"
        role="img"
        aria-label={t('share.title')}
        onPointerDown={(e) => {
          // Primary button only, and the pointer is captured: a drag that ends
          // outside the window used to leave the surface following the cursor
          // for good, and a right-click panned the diagram behind its own menu.
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = { x: e.clientX, y: e.clientY, viewport };
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
      >
        <Defs theme={theme} iconKeys={iconKeysIn(model)} customIcons={model.customIcons} />
        <g transform={viewportTransform(viewport)}>
          <DiagramScene model={model} theme={theme} />
        </g>
      </svg>

      <div className="zoom-controls shared-zoom">
        <button
          type="button"
          className="icon-button"
          aria-label={t('action.zoomOut')}
          onClick={() =>
            setViewport((v) => zoomAt(v, v.zoom / 1.2, { x: size.width / 2, y: size.height / 2 }))
          }
        >
          <ZoomOutIcon size={16} />
        </button>
        <span className="zoom-value">{Math.round(viewport.zoom * 100)}%</span>
        <button
          type="button"
          className="icon-button"
          aria-label={t('action.zoomIn')}
          onClick={() =>
            setViewport((v) => zoomAt(v, v.zoom * 1.2, { x: size.width / 2, y: size.height / 2 }))
          }
        >
          <ZoomInIcon size={16} />
        </button>
        <span className="zoom-divider" />
        <button
          type="button"
          className="icon-button"
          aria-label={t('action.zoomFit')}
          onClick={() => box && setViewport(fitToBox(box, size, 40))}
        >
          <FitIcon size={16} />
        </button>
      </div>

      <Link className="shared-credit" href="/">
        {t('share.madeWith')}
      </Link>
    </div>
  );
}
