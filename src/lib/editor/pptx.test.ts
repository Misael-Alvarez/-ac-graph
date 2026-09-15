// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { darkCanvas, lightCanvas } from '@/lib/design/tokens';
import { CONTENT_BOX, MARGIN, SLIDE_H, SLIDE_W, fitPicture, toPptx } from './pptx';
import { zipEntries } from './zip';

/** A 1×1 transparent PNG: the smallest picture the encoder ever produces. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const FIXED = new Date('2026-09-14T10:20:30Z');
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const decoder = new TextDecoder();

function deck(titles: string[], options: Partial<{ title: string; dark: boolean }> = {}) {
  const bytes = toPptx(
    titles.map((title, i) => ({ title, png: PNG, width: 1600 + i * 100, height: 900 })),
    { title: 'Payments', dark: false, created: FIXED, ...options },
  );
  const records = zipEntries(bytes);
  const text = (name: string) => {
    const record = records.find((r) => r.name === name);
    expect(record, name).toBeDefined();
    return decoder.decode(record!.data);
  };
  return { bytes, records, text };
}

function parse(source: string): Document {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
}

/** Follows a `.rels` part's Targets from the part's own folder. */
function targets(rels: string, folder: string): { id: string; type: string; target: string }[] {
  return [...parse(rels).getElementsByTagName('Relationship')].map((rel) => {
    const target = rel.getAttribute('Target')!;
    const path = target.startsWith('../')
      ? folder.replace(/[^/]+\/$/, '') + target.slice(3)
      : folder + target;
    return { id: rel.getAttribute('Id')!, type: rel.getAttribute('Type')!, target: path };
  });
}

describe('fitPicture', () => {
  it('fills the width of the content box with a wide picture, centred vertically', () => {
    // The box is about 2.2:1, so a 4:1 picture runs out of width first.
    const box = fitPicture(3200, 800);
    expect(box.w).toBe(CONTENT_BOX.w);
    expect(box.h).toBe(Math.round(CONTENT_BOX.w / 4));
    expect(box.x).toBe(CONTENT_BOX.x);
    expect(box.y).toBe(CONTENT_BOX.y + Math.round((CONTENT_BOX.h - box.h) / 2));
  });

  it('fills the height with a tall picture, centred horizontally', () => {
    const box = fitPicture(500, 1000);
    expect(box.h).toBe(CONTENT_BOX.h);
    expect(box.w).toBe(Math.round(CONTENT_BOX.h / 2));
    expect(box.y).toBe(CONTENT_BOX.y);
    expect(box.x).toBe(CONTENT_BOX.x + Math.round((CONTENT_BOX.w - box.w) / 2));
  });

  it('gives a degenerate picture the whole box rather than dividing by zero', () => {
    expect(fitPicture(0, 0)).toEqual(CONTENT_BOX);
  });
});

describe('toPptx', () => {
  it('writes a ZIP whose every XML part is well-formed', () => {
    const { bytes, records } = deck(['Overview', 'Security']);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(records[0].name).toBe('[Content_Types].xml');
    const parts = records.filter((r) => /\.(xml|rels)$/.test(r.name));
    expect(parts.length).toBeGreaterThan(14);
    for (const part of parts) parse(decoder.decode(part.data));
  });

  it('declares a content type for every part in the package', () => {
    const { records, text } = deck(['Overview', 'Security']);
    const types = parse(text('[Content_Types].xml'));
    const defaults = new Set(
      [...types.getElementsByTagName('Default')].map((d) => d.getAttribute('Extension')),
    );
    const overrides = new Set(
      [...types.getElementsByTagName('Override')].map((o) => o.getAttribute('PartName')),
    );
    for (const record of records) {
      if (record.name === '[Content_Types].xml') continue;
      const extension = record.name.split('.').pop()!;
      expect(overrides.has(`/${record.name}`) || defaults.has(extension), record.name).toBe(true);
    }
    // And nothing is declared that is not there.
    const names = new Set(records.map((r) => `/${r.name}`));
    for (const part of overrides) expect(names.has(part!), part!).toBe(true);
  });

  it('lists one slide per view in the presentation, with relationships that resolve', () => {
    const { records, text } = deck(['Overview', 'Security', 'Data']);
    const names = new Set(records.map((r) => r.name));
    const presentation = parse(text('ppt/presentation.xml'));
    const rels = targets(text('ppt/_rels/presentation.xml.rels'), 'ppt/');
    for (const rel of rels) expect(names.has(rel.target), rel.target).toBe(true);

    expect(presentation.getElementsByTagName('p:sldId')).toHaveLength(3);
    // Read from the text: happy-dom folds `r:id` onto `id`, the same local name.
    const source = text('ppt/presentation.xml');
    const slideIds = [...source.matchAll(/<p:sldId id="(\d+)" r:id="(rId\d+)"\/>/g)];
    expect(slideIds).toHaveLength(3);
    slideIds.forEach(([, id, rId], i) => {
      expect(id).toBe(String(256 + i));
      const rel = rels.find((r) => r.id === rId);
      expect(rel?.type).toBe(`${R}/slide`);
      expect(rel?.target).toBe(`ppt/slides/slide${i + 1}.xml`);
    });
    const master = /<p:sldMasterId id="(\d+)" r:id="(rId\d+)"\/>/.exec(source)!;
    expect(master[1]).toBe('2147483648');
    expect(rels.find((r) => r.id === master[2])?.target).toBe('ppt/slideMasters/slideMaster1.xml');
    const size = presentation.getElementsByTagName('p:sldSz')[0];
    expect([size.getAttribute('cx'), size.getAttribute('cy')]).toEqual(['12192000', '6858000']);
    expect(presentation.getElementsByTagName('p:notesSz')).toHaveLength(1);
    // The master reaches its layout and theme, the layout its master.
    expect(
      targets(text('ppt/slideMasters/_rels/slideMaster1.xml.rels'), 'ppt/slideMasters/').map(
        (r) => r.target,
      ),
    ).toEqual(['ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml']);
    expect(
      targets(text('ppt/slideLayouts/_rels/slideLayout1.xml.rels'), 'ppt/slideLayouts/')[0].target,
    ).toBe('ppt/slideMasters/slideMaster1.xml');
  });

  it('gives every slide its layout and its own picture, and the picture its blip', () => {
    const { records, text } = deck(['Overview', 'Security']);
    const names = new Set(records.map((r) => r.name));
    for (const n of [1, 2]) {
      const rels = targets(text(`ppt/slides/_rels/slide${n}.xml.rels`), 'ppt/slides/');
      expect(rels.map((r) => r.target)).toEqual([
        'ppt/slideLayouts/slideLayout1.xml',
        `ppt/media/image${n}.png`,
      ]);
      for (const rel of rels) expect(names.has(rel.target)).toBe(true);
      const slide = parse(text(`ppt/slides/slide${n}.xml`));
      const blip = slide.getElementsByTagName('a:blip')[0];
      const image = rels.find((r) => r.type === `${R}/image`)!;
      expect(blip.getAttribute('r:embed')).toBe(image.id);
      expect(Array.from(records.find((r) => r.name === image.target)!.data)).toEqual(
        Array.from(PNG),
      );
      // The tree opens with the group every reader insists on.
      const tree = slide.getElementsByTagName('p:spTree')[0];
      expect(tree.children[0].localName).toBe('nvGrpSpPr');
      expect(tree.children[1].localName).toBe('grpSpPr');
    }
  });

  it('heads each slide with its view name, at 20pt in the theme text colour', () => {
    const { text } = deck(['Overview', 'Security & <Compliance> "PCI"']);
    const first = parse(text('ppt/slides/slide1.xml'));
    expect(first.getElementsByTagName('a:t')[0].textContent).toBe('Overview');
    const second = parse(text('ppt/slides/slide2.xml'));
    expect(second.getElementsByTagName('a:t')[0].textContent).toBe('Security & <Compliance> "PCI"');
    const run = second.getElementsByTagName('a:rPr')[0];
    expect(run.getAttribute('sz')).toBe('2000');
    expect(run.getElementsByTagName('a:schemeClr')[0].getAttribute('val')).toBe('tx1');
    // Escaped on the way in: the raw part never carries a bare angle bracket.
    expect(text('ppt/slides/slide2.xml')).toContain(
      '<a:t>Security &amp; &lt;Compliance&gt; &quot;PCI&quot;</a:t>',
    );
  });

  it('sizes the picture to the PNG’s proportions and keeps it inside the slide', () => {
    const bytes = toPptx(
      [
        { title: 'Wide', png: PNG, width: 3200, height: 1000 },
        { title: 'Tall', png: PNG, width: 700, height: 2100 },
      ],
      { title: 'x', dark: false, created: FIXED },
    );
    const records = zipEntries(bytes);
    const slideOf = (n: number) =>
      parse(decoder.decode(records.find((r) => r.name === `ppt/slides/slide${n}.xml`)!.data));
    for (const [n, ratio] of [
      [1, 3.2],
      [2, 1 / 3],
    ] as const) {
      const pic = slideOf(n).getElementsByTagName('p:pic')[0];
      const xfrm = pic.getElementsByTagName('a:xfrm')[0];
      const off = xfrm.getElementsByTagName('a:off')[0];
      const ext = xfrm.getElementsByTagName('a:ext')[0];
      const [x, y, w, h] = [
        off.getAttribute('x'),
        off.getAttribute('y'),
        ext.getAttribute('cx'),
        ext.getAttribute('cy'),
      ].map(Number);
      expect(w / h).toBeCloseTo(ratio, 3);
      expect(x).toBeGreaterThanOrEqual(MARGIN);
      expect(y).toBeGreaterThanOrEqual(CONTENT_BOX.y);
      expect(x + w).toBeLessThanOrEqual(SLIDE_W - MARGIN);
      expect(y + h).toBeLessThanOrEqual(SLIDE_H - MARGIN);
      // Centred in the room left over.
      expect(x - CONTENT_BOX.x).toBeCloseTo(CONTENT_BOX.x + CONTENT_BOX.w - (x + w), -1);
      expect(y - CONTENT_BOX.y).toBeCloseTo(CONTENT_BOX.y + CONTENT_BOX.h - (y + h), -1);
      expect(pic.getElementsByTagName('a:fillRect')).toHaveLength(1);
    }
  });

  it('paints the master in the export theme’s sheet colour and maps the text to suit', () => {
    const light = deck(['Overview']).text('ppt/slideMasters/slideMaster1.xml');
    const dark = deck(['Overview'], { dark: true }).text('ppt/slideMasters/slideMaster1.xml');
    expect(light).toContain(`<a:srgbClr val="${lightCanvas.sheet.slice(1).toUpperCase()}"/>`);
    expect(light).toContain('bg1="lt1" tx1="dk1"');
    expect(dark).toContain(`<a:srgbClr val="${darkCanvas.sheet.slice(1).toUpperCase()}"/>`);
    expect(dark).toContain('bg1="dk1" tx1="lt1"');
  });

  it('carries the document title, the maker and the date in the core properties', () => {
    const { text } = deck(['Overview'], { title: 'Pagos & <Cobros>' });
    const core = parse(text('docProps/core.xml'));
    expect(core.getElementsByTagName('dc:title')[0].textContent).toBe('Pagos & <Cobros>');
    expect(core.getElementsByTagName('dc:creator')[0].textContent).toBe('AC Graph');
    expect(text('docProps/core.xml')).toContain(
      '<dcterms:created xsi:type="dcterms:W3CDTF">2026-09-14T10:20:30Z</dcterms:created>',
    );
    expect(text('docProps/app.xml')).toContain('<Slides>1</Slides>');
  });

  it('writes a valid theme: twelve colours, two fonts and three of each format', () => {
    const theme = parse(deck(['Overview']).text('ppt/theme/theme1.xml'));
    expect(theme.getElementsByTagName('a:clrScheme')[0].children).toHaveLength(12);
    expect(theme.getElementsByTagName('a:majorFont')[0].children[0].getAttribute('typeface')).toBe(
      'Geist',
    );
    expect(theme.getElementsByTagName('a:minorFont')[0].children[0].getAttribute('typeface')).toBe(
      'Calibri',
    );
    for (const list of ['fillStyleLst', 'lnStyleLst', 'effectStyleLst', 'bgFillStyleLst']) {
      expect(theme.getElementsByTagName(`a:${list}`)[0].children, list).toHaveLength(3);
    }
  });

  it('is the same bytes for the same input and date', () => {
    const a = deck(['Overview', 'Security']).bytes;
    const b = deck(['Overview', 'Security']).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('refuses to write a deck with no slides', () => {
    expect(() => toPptx([], { title: 'x', dark: false })).toThrow(/at least one slide/);
  });
});
