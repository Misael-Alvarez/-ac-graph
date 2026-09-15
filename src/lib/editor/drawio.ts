/**
 * A draw.io (diagrams.net) file writer.
 *
 * The image exports are for reading; this one is for handing over. A `.drawio`
 * is what an architect who does not use this editor opens, moves a box in and
 * sends back — so every shape becomes a real, editable cell with the colours
 * the canvas painted it in, every connector stays a connector between its two
 * services, and the service icons ride inside the file as data URLs, because
 * a file that fetches its icons from somewhere else is a file with holes in it
 * the day that somewhere is down.
 *
 * Written by hand, uncompressed, one `<diagram>` per page. draw.io reads the
 * plain `<mxGraphModel>` as happily as its deflated form, and plain XML is
 * something a colleague can diff. Ids are the model's own, so the same diagram
 * exported twice gives the same file and a page's cells can be traced back.
 *
 * Pure: takes models, returns a string. No DOM, so it can be tested in Node.
 */

import type { Connector, CustomIcon, DiagramModel, Point, Port, Shape } from '@/lib/domain';
import { CURRENT_SCHEMA_VERSION } from '@/lib/domain';
import { SVG_SYMBOLS } from '@/components/icons/svgIconDefs';
import {
  canvasTheme,
  fontSize,
  isColor,
  isDarkCanvas,
  mixHex,
  readableTextOn,
  type CanvasTheme,
} from '@/lib/design/tokens';
import { contentBBox, getShape, ports } from '@/lib/engine';
import { accentForFill, paletteFor, providerOf, themedFill } from './providers';
import {
  connectorLabel,
  connectorTags,
  itemBadges,
  lifecycleStyle,
  strokeFor,
  type Badge,
} from './meta';
import { parseRichText, type Inline } from './richText';

export interface DrawioPage {
  /** The tab's name in draw.io: the view's, or the document's for the main view. */
  name: string;
  model: DiagramModel;
  /** The `<diagram id>`; defaults to the page's position, which is as stable as the order of views. */
  id?: string;
}

export interface DrawioOptions {
  /** Paint on the dark palette rather than paper. */
  dark: boolean;
  /** The document's title, which names a page that has no name of its own. */
  title: string;
  /** The `modified` stamp; now unless a test wants a fixed one. */
  modified?: string;
}

/** Room left around the content on its page, matching the image exports' padding. */
const MARGIN = 48;

/**
 * Paint order: a region is a wash under everything; boundaries sit behind
 * groups, which sit behind their items; notes and texts are written on top.
 * draw.io stacks cells in document order, so the order here is the z-order.
 */
const PAINT_ORDER: Shape['type'][] = [
  'region',
  'boundary',
  'group',
  'container',
  'item',
  'note',
  'text',
];

/** Where each face sits on a shape, in draw.io's relative coordinates. */
const FACE: Record<Port, [number, number]> = {
  N: [0.5, 0],
  S: [0.5, 1],
  E: [1, 0.5],
  W: [0, 0.5],
};

const HEADING_SCALE: Record<1 | 2, number> = { 1: 1.85, 2: 1.35 };

/* ── encoding ───────────────────────────────────────────── */

/** Escapes text for an XML attribute, dropping the control characters XML 1.0 forbids. */
function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escapes the reader's words for the HTML draw.io renders inside a label.
 *
 * Labels are HTML (`html=1`), so a service called `<Gateway>` has to be text
 * and not a tag. The whole label is then XML-escaped again on its way into the
 * attribute, which is how draw.io stores rich labels itself.
 */
function html(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Base64 of the UTF-8 bytes of a string; the browser has no direct way, Node's `Buffer` is not the browser's. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // In slices: `fromCharCode` takes its arguments on the stack, and an icon can
  // run to tens of thousands of bytes.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** A coordinate as draw.io writes it: at most two decimals, no trailing noise. */
const num = (n: number) => String(Math.round(n * 100) / 100);

/** Joins style entries the way draw.io reads them: `key=value` pairs separated by `;`. */
function styleOf(leading: string[], entries: Record<string, string | number | undefined>): string {
  const parts = [...leading];
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) parts.push(`${key}=${value}`);
  }
  return parts.join(';');
}

/* ── icons ──────────────────────────────────────────────── */

/** A self-contained `<svg>` around a symbol's markup, with the namespaces its `<use>` and `xlink:href` need. */
function standaloneSvg(viewBox: string, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="${xml(viewBox)}">${body}</svg>`
  );
}

/** The sprite's `<symbol>` as a document of its own: same viewBox, same drawing, no wrapper. */
function symbolToSvg(symbol: string): string | null {
  const open = /^\s*<symbol\b[^>]*\bviewBox="([^"]*)"[^>]*>/.exec(symbol);
  const close = symbol.lastIndexOf('</symbol>');
  if (!open || close < open[0].length) return null;
  return standaloneSvg(open[1], symbol.slice(open[0].length, close));
}

/**
 * A raster data URL as a draw.io style value.
 *
 * `;` separates style entries, so `data:image/png;base64,` cannot appear in
 * one. draw.io's own convention is `data:image/png,<base64>` — it puts the
 * marker back when it reads the style — and that is what is written here.
 */
function rasterImage(dataUrl: string): string | undefined {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  return match ? `data:${match[1]},${match[2].replace(/\s+/g, '')}` : undefined;
}

/** The `image=` value for a service icon: the catalogue's symbol, or one of the author's own. */
function iconImage(
  key: string,
  customIcons: readonly CustomIcon[] | undefined,
): string | undefined {
  const symbol = SVG_SYMBOLS[key];
  if (symbol) {
    const svg = symbolToSvg(symbol);
    return svg ? `data:image/svg+xml,${base64(svg)}` : undefined;
  }
  const own = customIcons?.find((icon) => icon.key === key);
  if (own?.svg) return `data:image/svg+xml,${base64(standaloneSvg(own.svg.viewBox, own.svg.body))}`;
  if (own?.image) return rasterImage(own.image);
  return undefined;
}

/* ── rich text ──────────────────────────────────────────── */

function inlineHtml(runs: Inline[]): string {
  return runs
    .map((run) => {
      let text = html(run.text);
      if (run.code) text = `<span style="font-family:monospace">${text}</span>`;
      if (run.bold) text = `<b>${text}</b>`;
      if (run.italic) text = `<i>${text}</i>`;
      return text;
    })
    .join('');
}

/**
 * A note's markup as the HTML draw.io shows: bold, italic and code as their
 * tags, a bullet as its dot, a heading bold and larger, a blank line as one.
 */
function richHtml(source: string, size: number): string {
  const lines: string[] = [];
  for (const block of parseRichText(source)) {
    if (block.kind === 'gap') {
      lines.push('');
      continue;
    }
    const body = inlineHtml(block.runs);
    if (block.kind === 'heading') {
      lines.push(
        `<b style="font-size:${Math.round(size * HEADING_SCALE[block.level])}px">${body}</b>`,
      );
    } else if (block.kind === 'bullet') {
      lines.push(`• ${body}`);
    } else {
      lines.push(body);
    }
  }
  return lines.join('<br>');
}

/* ── cells ──────────────────────────────────────────────── */

interface Frame {
  /** The page's origin in model coordinates; every cell is placed relative to it. */
  x: number;
  y: number;
}

interface Cell {
  value: string;
  style: string;
}

function vertexCell(shape: Shape, cell: Cell, frame: Frame): string {
  return (
    `<mxCell id="${xml(shape.id)}" value="${xml(cell.value)}" style="${xml(cell.style)}" vertex="1" parent="1">` +
    `<mxGeometry x="${num(shape.x - frame.x)}" y="${num(shape.y - frame.y)}" ` +
    `width="${num(shape.w)}" height="${num(shape.h)}" as="geometry"/></mxCell>`
  );
}

function regionCell(shape: Shape, theme: CanvasTheme): Cell {
  const dark = isDarkCanvas(theme);
  const chosen = isColor(shape.fill) ? shape.fill : null;
  const accent = chosen ? accentForFill(chosen, theme) : theme.regionStroke;
  // The canvas paints a chosen colour at 60% on paper and a whisper of its
  // accent on the dark sheet; both are baked into one opaque colour here.
  const body = chosen
    ? dark
      ? mixHex(theme.sheet, accent, 0.18)
      : mixHex(theme.sheet, chosen, 0.6)
    : theme.regionTint;
  const caption = chosen ? (dark ? mixHex(accent, '#ffffff', 0.35) : accent) : theme.subtitleText;
  return {
    value: html((shape.title ?? '').toUpperCase()),
    style: styleOf(['rounded=1', 'absoluteArcSize=1', 'arcSize=32', 'whiteSpace=wrap', 'html=1'], {
      dashed: 1,
      dashPattern: '7 5',
      fillColor: body,
      strokeColor: chosen ? mixHex(theme.sheet, accent, 0.55) : accent,
      strokeWidth: 1.25,
      fontColor: caption,
      align: 'left',
      verticalAlign: 'top',
      spacingLeft: 12,
      spacingTop: 8,
      fontSize: fontSize.xs,
      fontStyle: 1,
    }),
  };
}

function boundaryCell(shape: Shape, theme: CanvasTheme): Cell {
  const palette = paletteFor(shape.icon?.key);
  const accent = isColor(shape.fill) ? shape.fill : null;
  const stroke = accent ?? palette.border;
  // Without the header bar the title takes the brand's colour itself; the
  // generic palette's header is too pale for that, so it keeps the theme's ink.
  const ink = accent ?? (providerOf(shape.icon?.key) === 'generic' ? theme.titleText : stroke);
  return {
    value: html(shape.title ?? ''),
    style: styleOf(['rounded=1', 'absoluteArcSize=1', 'arcSize=28', 'whiteSpace=wrap', 'html=1'], {
      dashed: 1,
      dashPattern: '10 6',
      fillColor: 'none',
      strokeColor: stroke,
      strokeWidth: 1.25,
      fontColor: ink,
      align: 'left',
      verticalAlign: 'top',
      spacingLeft: 12,
      spacingTop: 6,
      fontStyle: 1,
      fontSize: fontSize.base,
    }),
  };
}

function groupCell(shape: Shape, theme: CanvasTheme): Cell {
  const background = themedFill(shape.fill, theme) ?? theme.groupFill;
  const accent = accentForFill(shape.fill, theme);
  const stroke = isColor(shape.fill) ? mixHex(theme.groupStroke, accent, 0.35) : theme.groupStroke;
  return {
    value: html(shape.title ?? ''),
    style: styleOf(['rounded=1', 'absoluteArcSize=1', 'arcSize=24', 'whiteSpace=wrap', 'html=1'], {
      fillColor: background,
      strokeColor: stroke,
      fontColor: readableTextOn(background, theme),
      align: 'left',
      verticalAlign: 'top',
      spacingLeft: 26,
      spacingTop: 12,
      fontStyle: 1,
      fontSize: fontSize.sm,
    }),
  };
}

function containerCell(shape: Shape, theme: CanvasTheme): Cell {
  const stroke = isColor(shape.fill) ? shape.fill : theme.containerStroke;
  return {
    value: '',
    style: styleOf(['rounded=1', 'absoluteArcSize=1', 'arcSize=20'], {
      dashed: 1,
      dashPattern: '5 5',
      fillColor: 'none',
      // The canvas fades the well's dashes; here the fade is mixed into the colour.
      strokeColor: mixHex(theme.groupFill, stroke, isDarkCanvas(theme) ? 0.5 : 0.8),
      strokeWidth: 1.2,
    }),
  };
}

/** The words on a card's chips, as the canvas sets them: states in capitals, names as spelled. */
function badgeText(badge: Badge): string {
  const spelled = badge.kind === 'repository' || badge.kind === 'tag' || badge.kind === 'owner';
  return spelled ? badge.text : badge.text.toUpperCase();
}

function itemCell(shape: Shape, model: DiagramModel, theme: CanvasTheme): Cell {
  const container = shape.parentId ? getShape(model, shape.parentId) : undefined;
  const group = container?.parentId ? getShape(model, container.parentId) : undefined;
  const palette = paletteFor(shape.icon?.key ?? group?.icon?.key ?? container?.icon?.key);
  const dark = isDarkCanvas(theme);
  const tinted = isColor(shape.fill);
  const background =
    (tinted ? themedFill(shape.fill, theme, theme.itemFill) : null) ?? theme.itemFill;
  const titleColor = tinted ? readableTextOn(background, theme) : theme.titleText;
  const subtitleColor = tinted ? titleColor : theme.subtitleText;
  const image = shape.icon ? iconImage(shape.icon.key, model.customIcons) : undefined;
  const lifecycle = lifecycleStyle(shape);

  const lines = [`<b>${html(shape.title ?? '')}</b>`];
  if (shape.subtitle) {
    lines.push(
      `<font style="font-size:10px;color:${subtitleColor}">${html(shape.subtitle)}</font>`,
    );
  }
  const badges = itemBadges(shape);
  if (badges.length) {
    const chips = badges.map((badge) => html(badgeText(badge))).join(' · ');
    lines.push(
      `<font style="font-size:9px;color:${tinted ? titleColor : theme.noteText}">${chips}</font>`,
    );
  }

  return {
    value: lines.join('<br>'),
    style: styleOf(
      image
        ? [
            'shape=label',
            'html=1',
            'rounded=1',
            'absoluteArcSize=1',
            'arcSize=20',
            'whiteSpace=wrap',
          ]
        : ['rounded=1', 'absoluteArcSize=1', 'arcSize=20', 'html=1', 'whiteSpace=wrap'],
      {
        fillColor: background,
        strokeColor: dark ? mixHex(theme.itemStroke, palette.border, 0.45) : palette.border,
        fontColor: titleColor,
        fontSize: fontSize.xs,
        align: 'left',
        verticalAlign: 'middle',
        // The text starts past the icon well the canvas draws, image or not.
        spacingLeft: image ? 38 : 8,
        imageAlign: image ? 'left' : undefined,
        imageVerticalAlign: image ? 'middle' : undefined,
        imageWidth: image ? 28 : undefined,
        imageHeight: image ? 28 : undefined,
        spacing: 8,
        dashed: lifecycle.dashed ? 1 : undefined,
        dashPattern: lifecycle.dashed ? '6 4' : undefined,
        opacity: lifecycle.opacity === 1 ? undefined : Math.round(lifecycle.opacity * 100),
        // Last: the value is long, and a reader of the file finds the colours first.
        image,
      },
    ),
  };
}

function noteCell(shape: Shape, theme: CanvasTheme): Cell {
  const paper = isColor(shape.fill) ? shape.fill : theme.notePaper;
  return {
    value: richHtml(shape.title ?? '', fontSize.base),
    style: styleOf(['shape=note', 'size=14', 'whiteSpace=wrap', 'html=1'], {
      fillColor: paper,
      strokeColor: mixHex(paper, '#000000', 0.14),
      // The fold, shaded the way the canvas shades it.
      darkOpacity: 0.14,
      fontColor: readableTextOn(paper, theme),
      align: 'left',
      verticalAlign: 'top',
      spacing: 10,
      fontSize: fontSize.base,
    }),
  };
}

function textCell(shape: Shape, theme: CanvasTheme): Cell {
  return {
    value: richHtml(shape.title ?? '', fontSize.md),
    style: styleOf(['text', 'html=1'], {
      strokeColor: 'none',
      fillColor: 'none',
      align: 'left',
      verticalAlign: 'top',
      whiteSpace: 'wrap',
      fontColor: isColor(shape.fill) ? shape.fill : theme.titleText,
      fontSize: fontSize.md,
      spacing: 2,
    }),
  };
}

function shapeCell(shape: Shape, model: DiagramModel, theme: CanvasTheme): Cell {
  switch (shape.type) {
    case 'region':
      return regionCell(shape, theme);
    case 'boundary':
      return boundaryCell(shape, theme);
    case 'group':
      return groupCell(shape, theme);
    case 'container':
      return containerCell(shape, theme);
    case 'item':
      return itemCell(shape, model, theme);
    case 'note':
      return noteCell(shape, theme);
    case 'text':
      return textCell(shape, theme);
  }
}

/* ── edges ──────────────────────────────────────────────── */

/**
 * The face a line leaves a shape by: the one the author fixed, or the one the
 * route already starts on. The router always anchors a route's ends at the
 * centre of a face, so the face can be read back from the end and draw.io
 * told to leave from the same place — otherwise it would pick its own.
 */
function faceOf(shape: Shape, fixed: Port | undefined, end: Point | undefined): Port | undefined {
  if (fixed) return fixed;
  if (!end) return undefined;
  const faces = ports(shape);
  return (Object.keys(faces) as Port[]).find(
    (face) => Math.abs(faces[face].x - end.x) <= 0.5 && Math.abs(faces[face].y - end.y) <= 0.5,
  );
}

function edgeCell(
  connector: Connector,
  model: DiagramModel,
  theme: CanvasTheme,
  frame: Frame,
): string | null {
  const source = getShape(model, connector.sourceId);
  const target = getShape(model, connector.targetId);
  if (!source || !target) return null;

  const stroke = strokeFor(connector);
  const entries: Record<string, string | number | undefined> = {
    endArrow: 'block',
    endFill: 1,
    strokeColor: isColor(connector.color) ? connector.color : theme.connector,
    strokeWidth: num(stroke.width),
    fontColor: theme.connectorLabelText,
    fontSize: fontSize.xs,
    labelBackgroundColor: theme.connectorLabelFill,
    labelBorderColor: theme.connectorLabelStroke,
  };
  // The router's lines are orthogonal, and draw.io's orthogonal style draws
  // through the same bends; the author's line is drawn point to point exactly
  // as it was laid, whatever its angles.
  if (!connector.manual) entries.edgeStyle = 'orthogonalEdgeStyle';
  if (connector.curve !== 'orthogonal') {
    entries.rounded = 1;
    entries.arcSize = 28;
  }
  if (stroke.dasharray) {
    entries.dashed = 1;
    entries.dashPattern = stroke.dasharray;
  }
  const exit = faceOf(source, connector.sourcePort, connector.waypoints[0]);
  if (exit) {
    [entries.exitX, entries.exitY] = FACE[exit];
    entries.exitPerimeter = 0;
  }
  const entry = faceOf(target, connector.targetPort, connector.waypoints.at(-1));
  if (entry) {
    [entries.entryX, entries.entryY] = FACE[entry];
    entries.entryPerimeter = 0;
  }

  const label = html(connectorLabel(connector));
  const tags = connectorTags(connector)
    .map((tag) => html(tag.text.toUpperCase()))
    .join(' · ');
  const value = [label, tags && `<font style="font-size:9px">${tags}</font>`]
    .filter(Boolean)
    .join('<br>');

  // draw.io places an edge's label from −1 at the source to 1 at the target.
  const at = connector.labelAt === undefined ? '' : ` x="${num(connector.labelAt * 2 - 1)}" y="0"`;
  const bends = connector.waypoints
    .slice(1, -1)
    .map((p) => `<mxPoint x="${num(p.x - frame.x)}" y="${num(p.y - frame.y)}"/>`)
    .join('');
  const geometry = bends
    ? `<mxGeometry relative="1" as="geometry"${at}><Array as="points">${bends}</Array></mxGeometry>`
    : `<mxGeometry relative="1" as="geometry"${at}/>`;

  return (
    `<mxCell id="${xml(connector.id)}" value="${xml(value)}" style="${xml(styleOf(['html=1'], entries))}" ` +
    `edge="1" parent="1" source="${xml(connector.sourceId)}" target="${xml(connector.targetId)}">` +
    `${geometry}</mxCell>`
  );
}

/* ── pages ──────────────────────────────────────────────── */

function pageXml(page: DrawioPage, index: number, options: DrawioOptions): string {
  const { model } = page;
  const theme = canvasTheme(options.dark);
  // Everything is moved so the content starts a margin in from the page's
  // corner: draw.io tiles pages from the origin, and a diagram drawn at
  // (2000, 900) would otherwise open across four of them.
  const box = contentBBox(model);
  const frame: Frame = { x: box.x - MARGIN, y: box.y - MARGIN };
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  for (const type of PAINT_ORDER) {
    for (const shape of model.shapes) {
      if (shape.type === type) cells.push(vertexCell(shape, shapeCell(shape, model, theme), frame));
    }
  }
  for (const connector of model.connectors) {
    const cell = edgeCell(connector, model, theme, frame);
    if (cell) cells.push(cell);
  }

  const name = page.name || options.title || `Page-${index + 1}`;
  return (
    `<diagram id="${xml(page.id ?? `page-${index + 1}`)}" name="${xml(name)}">` +
    `<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" ` +
    `arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.ceil(box.w + MARGIN * 2)}" ` +
    `pageHeight="${Math.ceil(box.h + MARGIN * 2)}" math="0" shadow="0" background="${theme.sheet}">` +
    `<root>${cells.join('')}</root></mxGraphModel></diagram>`
  );
}

/**
 * The whole document as a `.drawio` file: one page per reading given, every
 * shape a vertex in paint order and every connector with both ends an edge.
 *
 * `version` is where draw.io writes its own release; here it is the schema
 * the models were read from, which is the one version this writer has.
 */
export function toDrawio(pages: readonly DrawioPage[], options: DrawioOptions): string {
  const modified = options.modified ?? new Date().toISOString();
  return (
    `<mxfile host="AC Graph" modified="${xml(modified)}" agent="AC Graph" version="${CURRENT_SCHEMA_VERSION}">` +
    pages.map((page, index) => pageXml(page, index, options)).join('') +
    `</mxfile>`
  );
}
