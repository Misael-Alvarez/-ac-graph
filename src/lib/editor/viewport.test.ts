import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEWPORT,
  centerOn,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitToBox,
  frameOnOpen,
  lerpViewport,
  pan,
  toCanvas,
  toScreen,
  viewportTransform,
  visibleBox,
  zoomAt,
  zoomByAtCenter,
} from './viewport';

const size = { width: 1000, height: 600 };

describe('coordinate conversion', () => {
  it('round-trips through screen space', () => {
    const vp = { x: 120, y: -40, zoom: 1.75 };
    const point = { x: 321, y: 654 };
    const back = toCanvas(vp, toScreen(vp, point));
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it('is the identity at the default viewport', () => {
    expect(toCanvas(DEFAULT_VIEWPORT, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });

  it('accounts for pan and zoom', () => {
    expect(toCanvas({ x: 100, y: 50, zoom: 2 }, { x: 300, y: 150 })).toEqual({ x: 100, y: 50 });
  });
});

describe('zoomAt', () => {
  it('keeps the anchored canvas point under the cursor', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const anchor = { x: 400, y: 300 };
    const canvasUnderCursor = toCanvas(vp, anchor);

    const zoomed = zoomAt(vp, 2.5, anchor);

    const after = toScreen(zoomed, canvasUnderCursor);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });

  it('stays anchored when zooming out from an offset viewport', () => {
    const vp = { x: -250, y: 90, zoom: 2 };
    const anchor = { x: 133, y: 466 };
    const canvasUnderCursor = toCanvas(vp, anchor);

    const after = toScreen(zoomAt(vp, 0.5, anchor), canvasUnderCursor);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });

  it('clamps to the zoom limits', () => {
    expect(zoomAt(DEFAULT_VIEWPORT, 99, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(DEFAULT_VIEWPORT, 0.0001, { x: 0, y: 0 }).zoom).toBe(MIN_ZOOM);
    expect(clampZoom(0.5)).toBe(0.5);
  });

  it('returns the same object when the zoom does not change', () => {
    const vp = { x: 5, y: 5, zoom: MAX_ZOOM };
    expect(zoomAt(vp, 10, { x: 0, y: 0 })).toBe(vp);
  });

  it('zooms around the viewport centre', () => {
    const zoomed = zoomByAtCenter(DEFAULT_VIEWPORT, 2, size);
    expect(zoomed.zoom).toBe(2);
    // The centre point must not move.
    expect(toScreen(zoomed, toCanvas(DEFAULT_VIEWPORT, { x: 500, y: 300 }))).toEqual({
      x: 500,
      y: 300,
    });
  });
});

describe('pan', () => {
  it('shifts the offset without touching zoom', () => {
    expect(pan({ x: 10, y: 20, zoom: 1.5 }, 5, -5)).toEqual({ x: 15, y: 15, zoom: 1.5 });
  });
});

describe('fitToBox', () => {
  it('centres the box in the viewport', () => {
    const box = { x: 0, y: 0, w: 500, h: 300 };
    const vp = fitToBox(box, size);
    const centre = toScreen(vp, { x: 250, y: 150 });
    expect(centre.x).toBeCloseTo(500);
    expect(centre.y).toBeCloseTo(300);
  });

  it('scales so the box fits inside the padding', () => {
    const box = { x: 0, y: 0, w: 5000, h: 3000 };
    const vp = fitToBox(box, size, 50);
    const topLeft = toScreen(vp, { x: box.x, y: box.y });
    const bottomRight = toScreen(vp, { x: box.x + box.w, y: box.y + box.h });
    expect(topLeft.x).toBeGreaterThanOrEqual(49);
    expect(bottomRight.x).toBeLessThanOrEqual(size.width - 49);
  });

  it('never exceeds the maximum zoom for a tiny box', () => {
    expect(fitToBox({ x: 0, y: 0, w: 1, h: 1 }, size).zoom).toBe(MAX_ZOOM);
  });

  it('handles a zero-sized box without dividing by zero', () => {
    const vp = fitToBox({ x: 10, y: 10, w: 0, h: 0 }, size);
    expect(Number.isFinite(vp.x)).toBe(true);
    expect(Number.isFinite(vp.zoom)).toBe(true);
  });
});

describe('frameOnOpen', () => {
  it('fits a large diagram so all of it is on screen', () => {
    // 1600×800 fits a 1000×600 viewport at about 0.56: above the collapse
    // floor, so the whole of it lands inside the padding.
    const box = { x: 0, y: 0, w: 1600, h: 800 };
    const vp = frameOnOpen(box, size);
    const topLeft = toScreen(vp, { x: 0, y: 0 });
    const bottomRight = toScreen(vp, { x: 1600, y: 800 });
    expect(topLeft.x).toBeGreaterThanOrEqual(47);
    expect(bottomRight.x).toBeLessThanOrEqual(size.width - 47);
    expect(bottomRight.y).toBeLessThanOrEqual(size.height - 47);
  });

  it('never magnifies a small diagram, only centres it', () => {
    const box = { x: 100, y: 100, w: 300, h: 200 };
    const vp = frameOnOpen(box, size);
    expect(vp.zoom).toBe(1);
    const centre = toScreen(vp, { x: 250, y: 200 });
    expect(centre.x).toBeCloseTo(500);
    expect(centre.y).toBeCloseTo(300);
  });

  it('never opens so far out that groups would collapse into summaries', () => {
    const vast = { x: 0, y: 0, w: 6000, h: 4000 };
    expect(frameOnOpen(vast, size).zoom).toBeCloseTo(0.52);
  });

  it('keeps clear of floating chrome on the left', () => {
    const box = { x: 0, y: 0, w: 300, h: 200 };
    const vp = frameOnOpen(box, size, { left: 100 });
    const centre = toScreen(vp, { x: 150, y: 100 });
    expect(centre.x).toBeCloseTo(550);
  });
});

describe('lerpViewport', () => {
  const from = { x: 0, y: 0, zoom: 0.25 };
  const to = { x: 100, y: -50, zoom: 1 };

  it('returns the ends exactly', () => {
    expect(lerpViewport(from, to, 0)).toBe(from);
    expect(lerpViewport(from, to, 1)).toBe(to);
  });

  it('halves the zoom distance on a log scale', () => {
    // Two doublings from 25% to 100%: half way is one doubling, 50%.
    expect(lerpViewport(from, to, 0.5).zoom).toBeCloseTo(0.5);
    expect(lerpViewport(from, to, 0.5).x).toBeCloseTo(50);
    expect(lerpViewport(from, to, 0.5).y).toBeCloseTo(-25);
  });
});

describe('visibleBox', () => {
  it('describes the canvas area on screen', () => {
    expect(visibleBox({ x: 0, y: 0, zoom: 1 }, size)).toEqual({ x: 0, y: 0, w: 1000, h: 600 });
  });

  it('shrinks as the zoom increases', () => {
    const zoomedIn = visibleBox({ x: 0, y: 0, zoom: 2 }, size);
    expect(zoomedIn.w).toBe(500);
    expect(zoomedIn.h).toBe(300);
  });

  it('follows the pan offset', () => {
    expect(visibleBox({ x: -200, y: -100, zoom: 1 }, size)).toMatchObject({ x: 200, y: 100 });
  });
});

describe('viewportTransform', () => {
  it('emits an SVG transform', () => {
    expect(viewportTransform({ x: 12, y: -3, zoom: 1.5 })).toBe('translate(12 -3) scale(1.5)');
  });
});

describe('fitToBox with insets', () => {
  it('centres on the free area, not the whole viewport', () => {
    const box = { x: 0, y: 0, w: 400, h: 200 };
    const withPanel = fitToBox(box, size, 48, { right: 300 });
    const centre = toScreen(withPanel, { x: 200, y: 100 });
    // Free area is 0..700, so the content centres at 350, clear of the panel.
    expect(centre.x).toBeCloseTo(350);
  });

  it('keeps the content clear of an inset edge', () => {
    const box = { x: 0, y: 0, w: 4000, h: 400 };
    const vp = fitToBox(box, size, 20, { right: 300 });
    const rightEdge = toScreen(vp, { x: box.w, y: 0 }).x;
    expect(rightEdge).toBeLessThanOrEqual(size.width - 300 - 20 + 0.5);
  });

  it('matches the plain call when no insets are given', () => {
    const box = { x: 10, y: 10, w: 500, h: 300 };
    expect(fitToBox(box, size, 48, {})).toEqual(fitToBox(box, size, 48));
  });
});

describe('centerOn', () => {
  it('puts the point in the middle of the screen', () => {
    const vp = centerOn({ x: 0, y: 0, zoom: 1.5 }, { x: 320, y: 180 }, size);
    const centre = toScreen(vp, { x: 320, y: 180 });
    expect(centre.x).toBeCloseTo(size.width / 2);
    expect(centre.y).toBeCloseTo(size.height / 2);
  });

  it('moves without zooming: jumping on the map changes where, not how close', () => {
    const before = { x: 12, y: -40, zoom: 0.4 };
    expect(centerOn(before, { x: 900, y: 900 }, size).zoom).toBe(before.zoom);
  });

  it('centres the visible box on the point at any zoom', () => {
    for (const zoom of [0.25, 1, 3]) {
      const vp = centerOn({ x: 0, y: 0, zoom }, { x: -150, y: 240 }, size);
      const box = visibleBox(vp, size);
      expect(box.x + box.w / 2).toBeCloseTo(-150);
      expect(box.y + box.h / 2).toBeCloseTo(240);
    }
  });
});
