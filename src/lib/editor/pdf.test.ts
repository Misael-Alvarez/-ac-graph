import { describe, expect, it } from 'vitest';
import { rasterToPdf, rgbaToRgb } from './pdf';

const decoder = new TextDecoder('latin1');

describe('rasterToPdf', () => {
  it('writes a well-formed single-page PDF sized to the image', async () => {
    const width = 4;
    const height = 2;
    const rgb = new Uint8Array(width * height * 3).fill(200);
    const bytes = await rasterToPdf({ width, height, rgb, dpi: 72, title: 'Test (1)' });
    const text = decoder.decode(bytes);

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // 72 dpi: one pixel is one point, so the page is 4x2 points.
    expect(text).toContain('/MediaBox [0 0 4.00 2.00]');
    expect(text).toContain('/Width 4 /Height 2');
    expect(text).toContain('/Filter /FlateDecode');
    expect(text).toContain('/Title (Test \\(1\\))');
    expect(text).toContain('/Count 1');
  });

  it('points the cross-reference table at the real object offsets', async () => {
    const bytes = await rasterToPdf({ width: 1, height: 1, rgb: new Uint8Array([1, 2, 3]) });
    const text = decoder.decode(bytes);
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');

    const entries = [...text.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(6);
    entries.forEach((offset, index) => {
      expect(text.slice(offset, offset + 8)).toBe(`${index + 1} 0 obj\n`.slice(0, 8));
    });
  });

  it('rejects a raster that does not match its dimensions', async () => {
    await expect(rasterToPdf({ width: 2, height: 2, rgb: new Uint8Array(5) })).rejects.toThrow(
      /dimensions/,
    );
  });
});

describe('rgbaToRgb', () => {
  it('drops alpha and composites onto the background', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 128]);
    const rgb = rgbaToRgb(rgba, [255, 255, 255]);
    expect([...rgb.slice(0, 3)]).toEqual([255, 0, 0]);
    // Fully transparent shows the background.
    expect([...rgb.slice(3, 6)]).toEqual([255, 255, 255]);
    // Half-transparent black over white is mid grey.
    expect([...rgb.slice(6, 9)]).toEqual([127, 127, 127]);
  });
});
