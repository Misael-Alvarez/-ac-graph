// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { DiagramModel } from '@/lib/domain';
import { SVG_SYMBOLS } from '@/components/icons/svgIconDefs';
import { darkCanvas, lightCanvas } from '@/lib/design/tokens';
import {
  addBoundary,
  addConnector,
  addDecoration,
  addGroup,
  createEmptyModel,
  routeAllConnectors,
  setRoute,
} from '@/lib/engine';
import { toDrawio } from './drawio';
import { stripMetadata } from './meta';

const FIXED = { dark: false, title: 'Payments', modified: '2026-09-14T10:00:00.000Z' };

/** Two services under a boundary, a note, and one call between them. */
function sampleModel(): DiagramModel {
  const m = createEmptyModel();
  addBoundary(m, 0, 0, 'outer').title = 'AWS';
  const a = addGroup(m, 40, 80);
  a.title = 'Frontend';
  const b = addGroup(m, 600, 80);
  b.title = 'Backend';
  const [front, back] = m.shapes.filter((s) => s.type === 'item');
  front.title = 'CloudFront';
  front.subtitle = 'CDN';
  front.icon = { kind: 'symbol', key: 'aws-cloudfront' };
  front.meta = { environment: 'prod', criticality: 'critical', owner: 'edge' };
  back.title = 'Lambda';
  back.icon = { kind: 'symbol', key: 'aws-lambda' };
  const call = addConnector(m, front.id, back.id);
  call.label = 'Pagos';
  call.meta = { protocol: 'grpc', dataClass: 'pii' };
  addDecoration(m, 'note', 0, 700, 'Remember **this**\n- one\n- two');
  return m;
}

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
}

/** The `<mxCell>` for a model id, opening tag to closing tag, so it can be read whole. */
function cellOf(xml: string, id: string): string {
  const start = xml.indexOf(`<mxCell id="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  return xml.slice(start, xml.indexOf('</mxCell>', start) + '</mxCell>'.length);
}

function styleOf(xml: string, id: string): string {
  return /style="([^"]*)"/.exec(cellOf(xml, id))![1].replace(/&quot;/g, '"');
}

describe('toDrawio', () => {
  it('writes well-formed, uncompressed mxGraph XML with one page per reading', () => {
    const xml = toDrawio(
      [
        { name: 'Payments', model: sampleModel() },
        { name: 'Security', model: sampleModel() },
      ],
      FIXED,
    );
    expect(xml.startsWith('<mxfile host="AC Graph" modified="2026-09-14T10:00:00.000Z"')).toBe(
      true,
    );
    expect(xml.trimEnd().endsWith('</mxfile>')).toBe(true);

    const doc = parse(xml);
    const pages = [...doc.getElementsByTagName('diagram')];
    expect(pages.map((p) => p.getAttribute('name'))).toEqual(['Payments', 'Security']);
    expect(pages.map((p) => p.getAttribute('id'))).toEqual(['page-1', 'page-2']);
    for (const page of pages) {
      const model = page.getElementsByTagName('mxGraphModel')[0];
      expect(model.getAttribute('page')).toBe('1');
      const root = model.getElementsByTagName('root')[0];
      const [layer, defaultParent] = [...root.children];
      expect(layer.getAttribute('id')).toBe('0');
      expect(defaultParent.getAttribute('id')).toBe('1');
      expect(defaultParent.getAttribute('parent')).toBe('0');
    }
  });

  it('names a page after the document when the view has no name of its own', () => {
    const xml = toDrawio([{ name: '', model: sampleModel() }], FIXED);
    expect(xml).toContain('<diagram id="page-1" name="Payments">');
    expect(
      toDrawio([{ name: '', model: sampleModel(), id: 'view_main' }], { ...FIXED, title: '' }),
    ).toContain('<diagram id="view_main" name="Page-1">');
  });

  it('turns every shape into a vertex and every resolvable connector into an edge', () => {
    const model = sampleModel();
    const [front] = model.shapes.filter((s) => s.type === 'item');
    // A call to a service the page does not show is pointing at nothing.
    model.connectors.push({ ...model.connectors[0], id: 'cn_dangling', targetId: 'itm_gone' });
    const doc = parse(toDrawio([{ name: 'p', model }], FIXED));

    const cells = [...doc.getElementsByTagName('mxCell')];
    const vertices = cells.filter((c) => c.getAttribute('vertex') === '1');
    const edges = cells.filter((c) => c.getAttribute('edge') === '1');
    expect(vertices).toHaveLength(model.shapes.length);
    expect(edges).toHaveLength(1);
    expect(edges[0].getAttribute('source')).toBe(front.id);
    expect(edges[0].getAttribute('target')).toBe(model.connectors[0].targetId);
    // Ids are the model's own, so the same diagram twice is the same file.
    expect(new Set(vertices.map((v) => v.getAttribute('id')))).toEqual(
      new Set(model.shapes.map((s) => s.id)),
    );
    for (const vertex of vertices) {
      const geometry = vertex.getElementsByTagName('mxGeometry')[0];
      expect(geometry.getAttribute('as')).toBe('geometry');
      expect(Number(geometry.getAttribute('width'))).toBeGreaterThan(0);
    }
  });

  it('stacks the cells in paint order: region under boundary, items over groups, notes on top', () => {
    const model = sampleModel();
    addDecoration(model, 'region', -20, -20, 'DMZ');
    addDecoration(model, 'text', 0, 900, 'Caption');
    const doc = parse(toDrawio([{ name: 'p', model }], FIXED));
    const order = [...doc.getElementsByTagName('mxCell')]
      .filter((c) => c.getAttribute('vertex') === '1')
      .map((c) => c.getAttribute('id')!.split('_')[0]);
    expect(order).toEqual(['rg', 'bd', 'grp', 'grp', 'ctr', 'ctr', 'itm', 'itm', 'nt', 'tx']);
  });

  it('embeds each service icon as a standalone SVG data URL', () => {
    const model = sampleModel();
    const [front] = model.shapes.filter((s) => s.type === 'item');
    const xml = toDrawio([{ name: 'p', model }], FIXED);
    const style = styleOf(xml, front.id);

    expect(style).toContain('shape=label');
    expect(style).toContain('imageWidth=28;imageHeight=28');
    const image = /image=data:image\/svg\+xml,([A-Za-z0-9+/=]+)/.exec(style);
    expect(image).not.toBeNull();
    const svg = Buffer.from(image![1], 'base64').toString('utf8');
    const viewBox = /viewBox="([^"]+)"/.exec(SVG_SYMBOLS['aws-cloudfront'])![1];
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="${viewBox}"`);
    expect(svg).not.toContain('<symbol');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    // The picture itself is the symbol's own markup.
    const body = SVG_SYMBOLS['aws-cloudfront'].replace(/^<symbol[^>]*>|<\/symbol>$/g, '');
    expect(svg).toContain(body.slice(0, 40));
  });

  it("embeds the author's own icons too: vectors as SVG, rasters without the ;base64 marker", () => {
    const model = sampleModel();
    const [front, back] = model.shapes.filter((s) => s.type === 'item');
    front.icon = { kind: 'symbol', key: 'custom-vault-abcde' };
    back.icon = { kind: 'symbol', key: 'custom-logo-fghij' };
    model.customIcons = [
      {
        key: 'custom-vault-abcde',
        name: 'Vault',
        svg: { viewBox: '0 0 24 24', body: '<rect width="24" height="24" fill="#111"/>' },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        key: 'custom-logo-fghij',
        name: 'Logo',
        image: 'data:image/png;base64,iVBORw0KGgo=',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const xml = toDrawio([{ name: 'p', model }], FIXED);

    const vector = /image=data:image\/svg\+xml,([A-Za-z0-9+/=]+)/.exec(styleOf(xml, front.id))!;
    expect(Buffer.from(vector[1], 'base64').toString('utf8')).toContain(
      '<rect width="24" height="24" fill="#111"/>',
    );
    // `;` separates style entries, so the marker has to go; draw.io puts it back.
    expect(styleOf(xml, back.id)).toContain('image=data:image/png,iVBORw0KGgo=');
    expect(styleOf(xml, back.id)).not.toContain(';base64');
  });

  it('draws a card without an icon as a plain rounded box rather than a label with a hole', () => {
    const model = sampleModel();
    const [front] = model.shapes.filter((s) => s.type === 'item');
    front.icon = undefined;
    const style = styleOf(toDrawio([{ name: 'p', model }], FIXED), front.id);
    expect(style).not.toContain('shape=label');
    expect(style).not.toContain('image=');
    expect(style).toContain('spacingLeft=8');
  });

  it('writes the card as a bold title, a small subtitle and, with metadata, the chips', () => {
    const model = sampleModel();
    const [front] = model.shapes.filter((s) => s.type === 'item');
    const xml = toDrawio([{ name: 'p', model }], FIXED);
    const value = /value="([^"]*)"/.exec(cellOf(xml, front.id))![1];
    expect(value).toBe(
      '&lt;b&gt;CloudFront&lt;/b&gt;&lt;br&gt;' +
        `&lt;font style=&quot;font-size:10px;color:${lightCanvas.subtitleText}&quot;&gt;CDN&lt;/font&gt;&lt;br&gt;` +
        `&lt;font style=&quot;font-size:9px;color:${lightCanvas.noteText}&quot;&gt;PROD · CRITICAL · @edge&lt;/font&gt;`,
    );
  });

  it('leaves the chips and tags off when the metadata has been stripped', () => {
    const model = sampleModel();
    const kept = toDrawio([{ name: 'p', model }], FIXED);
    const bare = toDrawio([{ name: 'p', model: stripMetadata(model) }], FIXED);
    expect(kept).toContain('PROD · CRITICAL');
    expect(kept).toContain('GRPC · PII');
    expect(bare).not.toContain('PROD');
    expect(bare).not.toContain('PII');
    expect(bare).toContain('Pagos');
  });

  it('draws a boundary as a dashed, unfilled zone with its title in the corner', () => {
    const model = sampleModel();
    const boundary = model.shapes.find((s) => s.type === 'boundary')!;
    const xml = toDrawio([{ name: 'p', model }], FIXED);
    const style = styleOf(xml, boundary.id);
    expect(style).toContain('dashed=1;dashPattern=10 6;fillColor=none');
    expect(style).toContain('align=left;verticalAlign=top');
    expect(style).toContain('fontStyle=1;fontSize=13');
    expect(cellOf(xml, boundary.id)).toContain('value="AWS"');
  });

  it('draws the container as a dashed well with no fill and no label', () => {
    const model = sampleModel();
    const container = model.shapes.find((s) => s.type === 'container')!;
    const xml = toDrawio([{ name: 'p', model }], FIXED);
    expect(styleOf(xml, container.id)).toContain('dashed=1;dashPattern=5 5;fillColor=none');
    expect(cellOf(xml, container.id)).toContain('value=""');
  });

  it('writes a note as draw.io\u2019s note shape with its markup rendered to HTML', () => {
    const model = sampleModel();
    const note = model.shapes.find((s) => s.type === 'note')!;
    const xml = toDrawio([{ name: 'p', model }], FIXED);
    const cell = cellOf(xml, note.id);
    expect(styleOf(xml, note.id)).toContain(
      `shape=note;size=14;whiteSpace=wrap;html=1;fillColor=${lightCanvas.notePaper}`,
    );
    expect(cell).toContain(
      'value="Remember &lt;b&gt;this&lt;/b&gt;&lt;br&gt;• one&lt;br&gt;• two"',
    );
  });

  it('renders italics, code, headings and blank lines in a text', () => {
    const model = createEmptyModel();
    const text = addDecoration(model, 'text', 0, 0, '# Phase 2\n\n*soon* with `k8s`');
    const xml = toDrawio([{ name: 'p', model }], FIXED);
    expect(styleOf(xml, text.id)).toMatch(/^text;html=1;strokeColor=none;fillColor=none/);
    const value = /value="([^"]*)"/.exec(cellOf(xml, text.id))![1].replace(/&quot;/g, '"');
    expect(value).toBe(
      '&lt;b style="font-size:28px"&gt;Phase 2&lt;/b&gt;&lt;br&gt;&lt;br&gt;' +
        '&lt;i&gt;soon&lt;/i&gt; with &lt;span style="font-family:monospace"&gt;k8s&lt;/span&gt;',
    );
  });

  it('writes a region as a tinted dashed wash with a small upper-case caption', () => {
    const model = createEmptyModel();
    const region = addDecoration(model, 'region', 0, 0, 'Zona segura');
    const xml = toDrawio([{ name: 'p', model }], FIXED);
    expect(styleOf(xml, region.id)).toContain(
      `dashed=1;dashPattern=7 5;fillColor=${lightCanvas.regionTint}`,
    );
    expect(styleOf(xml, region.id)).toContain('fontSize=11;fontStyle=1');
    expect(cellOf(xml, region.id)).toContain('value="ZONA SEGURA"');
  });

  it('lets draw.io route an automatic line orthogonally through the same bends', () => {
    const model = sampleModel();
    const [call] = model.connectors;
    const xml = toDrawio([{ name: 'p', model }], FIXED);
    const style = styleOf(xml, call.id);
    expect(style).toContain('edgeStyle=orthogonalEdgeStyle');
    expect(style).toContain('endArrow=block;endFill=1');
    expect(style).toContain('rounded=1');
    expect(style).toContain(`strokeColor=${lightCanvas.connector};strokeWidth=1.8`);
    // The router leaves the front card by its east face and arrives at the
    // west face of the back one; draw.io is told the same so it agrees.
    expect(style).toContain('exitX=1;exitY=0.5;exitPerimeter=0');
    expect(style).toContain('entryX=0;entryY=0.5;entryPerimeter=0');
    const cell = cellOf(xml, call.id);
    expect(cell).toContain(`source="${call.sourceId}"`);
    expect(cell).toContain(`target="${call.targetId}"`);
    expect(cell).toContain(
      'value="Pagos&lt;br&gt;&lt;font style=&quot;font-size:9px&quot;&gt;GRPC · PII&lt;/font&gt;"',
    );
  });

  it('draws a manual route point to point, with every bend and no edge style', () => {
    const model = sampleModel();
    const [call] = model.connectors;
    const [front, back] = model.shapes.filter((s) => s.type === 'item');
    setRoute(model, call, [
      { x: front.x + front.w, y: front.y + front.h / 2 },
      { x: 560, y: 40 },
      { x: 580, y: 300 },
      { x: back.x, y: back.y + back.h / 2 },
    ]);
    const xml = toDrawio([{ name: 'p', model }], FIXED);
    expect(styleOf(xml, call.id)).not.toContain('edgeStyle');
    const edge = cellOf(xml, call.id);
    expect(edge.match(/<mxPoint /g)).toHaveLength(2);
    expect(edge).toContain('<Array as="points">');
    // Moved with the page: the content's corner sits a margin in from (0, 0).
    expect(edge).toContain('<mxPoint x="608" y="88"/>');
  });

  it('pins a fixed port as an exit constraint, and a label position along the line', () => {
    const model = sampleModel();
    const [call] = model.connectors;
    call.sourcePort = 'E';
    call.targetPort = 'S';
    call.labelAt = 0.25;
    call.curve = 'orthogonal';
    call.style = 'dashed';
    call.color = '#cc4422';
    call.weight = 'bold';
    routeAllConnectors(model);
    const xml = toDrawio([{ name: 'p', model }], FIXED);
    const style = styleOf(xml, call.id);
    expect(style).toContain('exitX=1;exitY=0.5;exitPerimeter=0');
    expect(style).toContain('entryX=0.5;entryY=1;entryPerimeter=0');
    expect(style).not.toContain('rounded=1');
    expect(style).toContain('dashed=1;dashPattern=7 5');
    expect(style).toContain('strokeColor=#cc4422;strokeWidth=2.9');
    // draw.io runs an edge label from −1 at the source to 1 at the target; the
    // bends the fixed faces force are listed beside it.
    expect(cellOf(xml, call.id)).toContain(
      '<mxGeometry relative="1" as="geometry" x="-0.5" y="0"><Array as="points"><mxPoint ',
    );
  });

  it('paints on the dark palette when asked, and the two files differ', () => {
    const model = sampleModel();
    const group = model.shapes.find((s) => s.type === 'group')!;
    const light = toDrawio([{ name: 'p', model }], FIXED);
    const dark = toDrawio([{ name: 'p', model }], { ...FIXED, dark: true });
    expect(styleOf(light, group.id)).toContain(`fillColor=${lightCanvas.groupFill}`);
    expect(styleOf(dark, group.id)).toContain(`fillColor=${darkCanvas.groupFill}`);
    expect(light).toContain(`background="${lightCanvas.sheet}"`);
    expect(dark).toContain(`background="${darkCanvas.sheet}"`);
    expect(dark).not.toBe(light);
  });

  it('sizes the page to the content plus a margin and moves the content onto it', () => {
    const model = createEmptyModel();
    const group = addGroup(model, 1200, 900);
    const doc = parse(toDrawio([{ name: 'p', model }], FIXED));
    const graph = doc.getElementsByTagName('mxGraphModel')[0];
    expect(Number(graph.getAttribute('pageWidth'))).toBe(group.w + 96);
    expect(Number(graph.getAttribute('pageHeight'))).toBe(group.h + 96);
    const geometry = [...doc.getElementsByTagName('mxCell')]
      .find((c) => c.getAttribute('id') === group.id)!
      .getElementsByTagName('mxGeometry')[0];
    expect(geometry.getAttribute('x')).toBe('48');
    expect(geometry.getAttribute('y')).toBe('48');
  });

  it('escapes what XML and HTML would otherwise read as markup', () => {
    const model = sampleModel();
    const [front] = model.shapes.filter((s) => s.type === 'item');
    front.title = 'Cache <"hot" & cold>';
    model.connectors[0].label = 'a < b & "c"';
    const xml = toDrawio([{ name: 'A & B <"views">', model }], {
      ...FIXED,
      title: 'x',
    });
    parse(xml);
    expect(xml).toContain('name="A &amp; B &lt;&quot;views&quot;&gt;"');
    // HTML-escaped for the label, then XML-escaped for the attribute.
    expect(xml).toContain(
      '&lt;b&gt;Cache &amp;lt;&amp;quot;hot&amp;quot; &amp;amp; cold&amp;gt;&lt;/b&gt;',
    );
    expect(xml).toContain('value="a &amp;lt; b &amp;amp; &amp;quot;c&amp;quot;');
    expect(xml).not.toMatch(/="[^"]*<[^"]*"/);
  });

  it('writes an empty diagram as a page with nothing but its two root cells', () => {
    const doc = parse(toDrawio([{ name: 'Empty', model: createEmptyModel() }], FIXED));
    expect(doc.getElementsByTagName('mxCell')).toHaveLength(2);
    expect(
      Number(doc.getElementsByTagName('mxGraphModel')[0].getAttribute('pageWidth')),
    ).toBeGreaterThan(0);
  });
});
