/**
 * A minimal PDF writer for one raster page.
 *
 * The diagram is rasterised once, at a print-friendly density, and placed on a
 * page sized to fit it exactly. Writing the PDF by hand rather than through a
 * library keeps the export path free of a dependency whose whole job would be
 * this one function — and keeps the exported file to what it is: an image, its
 * page, and the seven objects a reader needs to open it.
 *
 * Pure: takes pixels, returns bytes. No DOM, so it can be tested in Node.
 */

export interface RasterPage {
  /** Pixel dimensions of the image. */
  width: number;
  height: number;
  /** RGB bytes, three per pixel, row-major. Alpha has already been composited. */
  rgb: Uint8Array;
  /** Pixels per inch the image was rendered at; sets the physical page size. */
  dpi?: number;
  title?: string;
}

const encoder = new TextEncoder();

/** Deflates with the platform's built-in stream, which both browsers and Node have. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Escapes a string for a PDF literal string `( ... )`. */
function pdfString(value: string): string {
  const safe = value.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (c) => `\\${c}`);
  return `(${safe})`;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Builds a single-page PDF holding the raster, sized to the image at `dpi`. */
export function rasterToPdf(page: RasterPage): Promise<Uint8Array> {
  return rastersToPdf([page], { title: page.title });
}

/**
 * Builds a PDF with one page per raster, each sized to its image at its `dpi`.
 *
 * Objects are numbered so that a single page comes out exactly as it always
 * did — catalog, pages, page, image, content, info — and every further page
 * adds its own page/image/content triple before the info dictionary.
 */
export async function rastersToPdf(
  pages: readonly RasterPage[],
  options: { title?: string } = {},
): Promise<Uint8Array> {
  if (!pages.length) throw new Error('A PDF needs at least one page.');
  const title = options.title ?? pages[0].title ?? 'Diagram';

  const objects: Uint8Array[] = [];
  const add = (head: string, stream?: Uint8Array) => {
    const parts: Uint8Array[] = [encoder.encode(head)];
    if (stream) {
      parts.push(encoder.encode('\nstream\n'), stream, encoder.encode('\nendstream'));
    }
    parts.push(encoder.encode('\nendobj\n'));
    objects.push(concat(parts));
  };

  // Page i (0-based) owns objects 3+3i (page), 4+3i (image) and 5+3i (content).
  const pageObject = (i: number) => 3 + 3 * i;
  const infoObject = 3 + 3 * pages.length;

  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>');
  add(
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObject(i)} 0 R`).join(' ')}] ` +
      `/Count ${pages.length} >>`,
  );

  for (const [i, page] of pages.entries()) {
    const { width, height, rgb, dpi = 144 } = page;
    if (rgb.byteLength !== width * height * 3) {
      throw new Error('The raster does not match its declared dimensions.');
    }
    // PDF points are 1/72 inch.
    const pageW = (width / dpi) * 72;
    const pageH = (height / dpi) * 72;
    // Copied into a fresh buffer: the platform stream API wants a plain
    // ArrayBuffer, and a view over a SharedArrayBuffer would not do.
    const owned = new Uint8Array(new ArrayBuffer(rgb.byteLength));
    owned.set(rgb);
    const image = await deflate(owned);
    const content = encoder.encode(
      `q ${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm /Im0 Do Q`,
    );
    const [pageId, imageId, contentId] = [pageObject(i), pageObject(i) + 1, pageObject(i) + 2];
    add(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    add(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.byteLength} >>`,
      image,
    );
    add(`${contentId} 0 obj\n<< /Length ${content.byteLength} >>`, content);
  }
  add(
    `${infoObject} 0 obj\n<< /Title ${pdfString(title)} /Producer (AC Graph) /Creator (AC Graph) >>`,
  );

  const header = encoder.encode('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offsets: number[] = [];
  let position = header.byteLength;
  for (const object of objects) {
    offsets.push(position);
    position += object.byteLength;
  }

  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObject} 0 R >>`,
    'startxref',
    String(position),
    '%%EOF',
    '',
  ].join('\n');

  return concat([header, ...objects, encoder.encode(xref)]);
}

/**
 * Drops the alpha channel from RGBA canvas pixels, compositing onto `background`.
 *
 * A PDF image has no transparency without a soft mask, and the diagram sheet is
 * opaque anyway; anti-aliased edges over the sheet composite onto its colour.
 */
export function rgbaToRgb(
  rgba: Uint8ClampedArray | Uint8Array,
  background: [number, number, number] = [255, 255, 255],
): Uint8Array {
  const pixels = rgba.byteLength / 4;
  const out = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const a = rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) {
      out[i * 3 + c] = Math.round(rgba[i * 4 + c] * a + background[c] * (1 - a));
    }
  }
  return out;
}
