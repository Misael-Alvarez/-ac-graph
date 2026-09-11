import { describe, expect, it } from 'vitest';
import { rasterToPdf, rastersToPdf, rgbaToRgb } from './pdf';

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

describe('rastersToPdf', () => {
  const page = (width: number, height: number, title?: string) => ({
    width,
    height,
    rgb: new Uint8Array(width * height * 3).fill(128),
    dpi: 72,
    title,
  });

  it('lays out one page per raster, each at its own size, and points the trailer at the info', async () => {
    const bytes = await rastersToPdf([page(4, 2), page(3, 3), page(2, 5)], { title: 'Views' });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('/Kids [3 0 R 6 0 R 9 0 R] /Count 3');
    expect(text).toContain('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 4.00 2.00]');
    expect(text).toContain('6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3.00 3.00]');
    expect(text).toContain('9 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2.00 5.00]');
    expect(text).toContain('/XObject << /Im0 7 0 R >> >> /Contents 8 0 R');
    expect(text).toContain('12 0 obj\n<< /Title (Views)');
    expect(text).toContain('/Size 13 /Root 1 0 R /Info 12 0 R');
    // Every xref entry lands on its object.
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...text.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(12);
    entries.forEach((offset, i) =>
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`),
    );
  });

  it('is exactly the single-page writer for one page', async () => {
    const single = await rasterToPdf({ ...page(4, 2), title: 'One' });
    const many = await rastersToPdf([page(4, 2)], { title: 'One' });
    expect(Buffer.from(many).equals(Buffer.from(single))).toBe(true);
  });

  it('refuses an empty document and a mismatched page', async () => {
    await expect(rastersToPdf([])).rejects.toThrow(/at least one page/);
    await expect(rastersToPdf([{ ...page(4, 2), rgb: new Uint8Array(3) }])).rejects.toThrow(
      /dimensions/,
    );
  });
});
