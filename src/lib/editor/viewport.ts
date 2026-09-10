import type { BBox, Point } from '@/lib/domain';

/**
 * Canvas viewport.
 *
 * `x`/`y` are the screen-space offset of the canvas origin and `zoom` the scale.
 * The canvas is drawn as `translate(x, y) scale(zoom)`, so panning never touches
 * the DOM scroll position — the previous editor resized the SVG element itself
 * and leaned on container scroll, which made zoom-at-cursor impossible.
 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Screen coordinates (relative to the canvas element) to canvas coordinates. */
export function toCanvas(vp: Viewport, screen: Point): Point {
  return { x: (screen.x - vp.x) / vp.zoom, y: (screen.y - vp.y) / vp.zoom };
}

/** Canvas coordinates back to screen coordinates. */
export function toScreen(vp: Viewport, canvas: Point): Point {
  return { x: canvas.x * vp.zoom + vp.x, y: canvas.y * vp.zoom + vp.y };
}

/**
 * Zooms while keeping the canvas point under `anchor` (screen coords) fixed.
 * This is what makes wheel and pinch zoom feel anchored rather than drifting.
 */
export function zoomAt(vp: Viewport, nextZoom: number, anchor: Point): Viewport {
  const zoom = clampZoom(nextZoom);
  if (zoom === vp.zoom) return vp;
  const ratio = zoom / vp.zoom;
  return {
    zoom,
    x: anchor.x - (anchor.x - vp.x) * ratio,
    y: anchor.y - (anchor.y - vp.y) * ratio,
  };
}

/** Zooms by a multiplicative step around the centre of the viewport. */
export function zoomByAtCenter(vp: Viewport, factor: number, size: Size): Viewport {
  return zoomAt(vp, vp.zoom * factor, { x: size.width / 2, y: size.height / 2 });
}

export function pan(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, x: vp.x + dx, y: vp.y + dy };
}

export interface Size {
  width: number;
  height: number;
}

/** Edges of the viewport covered by floating panels. */
export interface Insets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * Fits a canvas-space box into the viewport, centred on the free area.
 *
 * Insets keep the content clear of the floating chrome: without them, fitting a
 * wide diagram tucks its right-hand side underneath the inspector panel.
 */
export function fitToBox(
  box: BBox,
  size: Size,
  padding = 48,
  insets: Insets = {},
  maxZoom = MAX_ZOOM,
  minZoom = MIN_ZOOM,
): Viewport {
  const left = (insets.left ?? 0) + padding;
  const right = (insets.right ?? 0) + padding;
  const top = (insets.top ?? 0) + padding;
  const bottom = (insets.bottom ?? 0) + padding;

  const availableW = Math.max(size.width - left - right, 1);
  const availableH = Math.max(size.height - top - bottom, 1);
  const zoom = Math.max(
    minZoom,
    Math.min(
      maxZoom,
      clampZoom(Math.min(availableW / Math.max(box.w, 1), availableH / Math.max(box.h, 1))),
    ),
  );

  return {
    zoom,
    x: left + availableW / 2 - (box.x + box.w / 2) * zoom,
    y: top + availableH / 2 - (box.y + box.h / 2) * zoom,
  };
}

/**
 * The camera a diagram opens with.
 *
 * Fit to the free area, but never magnified: a three-box sketch shown at 400%
 * looks broken, while a fifty-service platform shown at 100% from its top-left
 * corner shows the reader a quarter of it and a lot of empty paper — which is
 * what every diagram opened as before this existed.
 */
export function frameOnOpen(box: BBox, size: Size, insets: Insets = {}): Viewport {
  // Never so far out that the groups fold into summaries: a diagram that opens
  // as "3 services · 2 services" has hidden the very things it exists to show.
  // Below this the reader sees most of it and pans for the rest.
  return fitToBox(box, size, 48, insets, 1, OPEN_MIN_ZOOM);
}

/** The zoom at which groups start summarising; opening stays just above it. */
export const OPEN_MIN_ZOOM = 0.52;

/** The canvas-space rectangle currently visible, used to skip off-screen shapes. */
export function visibleBox(vp: Viewport, size: Size): BBox {
  const topLeft = toCanvas(vp, { x: 0, y: 0 });
  const bottomRight = toCanvas(vp, { x: size.width, y: size.height });
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: bottomRight.x - topLeft.x,
    h: bottomRight.y - topLeft.y,
  };
}

/**
 * Moves the viewport so a canvas point sits in the middle of the screen.
 *
 * The zoom is left alone: jumping somewhere on the minimap should change where
 * you are, not how close you are standing.
 */
export function centerOn(vp: Viewport, point: Point, size: Size): Viewport {
  return {
    ...vp,
    x: size.width / 2 - point.x * vp.zoom,
    y: size.height / 2 - point.y * vp.zoom,
  };
}

/** SVG transform string for the canvas root group. */
export function viewportTransform(vp: Viewport): string {
  return `translate(${vp.x} ${vp.y}) scale(${vp.zoom})`;
}

/**
 * A viewport part-way between two others.
 *
 * Zoom is interpolated on a log scale: going from 25% to 100% should feel like
 * two doublings at an even pace, not a lurch at the start and a crawl at the
 * end, which is what a straight line between the two numbers gives. The
 * offsets follow the zoom so the point being zoomed towards stays put.
 */
export function lerpViewport(from: Viewport, to: Viewport, t: number): Viewport {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * t);
  return {
    zoom,
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  };
}
