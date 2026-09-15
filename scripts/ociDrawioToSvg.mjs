import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/**
 * Turns Oracle's draw.io assets for OCI into one SVG file per icon.
 *
 * Run: node scripts/ociDrawioToSvg.mjs <library.xml | file.drawio> <out-dir> [--page <name>]
 *
 * Oracle publishes its architecture icons for draw.io
 * (https://docs.oracle.com/en-us/iaas/Content/General/Reference/graphicsfordiagrams.htm)
 * in two shapes: an `<mxlibrary>` whose entries have titles, and a `.drawio`
 * toolkit whose "Icons" page lays every icon out under its caption. In both,
 * the artwork is not embedded SVG but mxGraph *stencils* — `<path>` elements of
 * `move`/`line`/`curve` commands in a 100×100 space, filled with the cell's
 * `fillColor` — deflated and base64-encoded inside each cell's style. This
 * script replays those stencils the way `mxStencil.js` does (variable aspect:
 * each axis scales to the cell box; `fillstroke` paints the current path with
 * the cell's fill and stroke) and writes plain `<path>` elements, one file per
 * icon, named by its title or caption.
 *
 * Text is left out: the icon is the drawing, and the app sets the product name
 * beside it in its own type. The viewBox is the union of the painted cells,
 * which is how the icons are meant to be framed — the style guide's square is
 * filled by whichever side is longer.
 */

const args = process.argv.slice(2);
const pageFlag = args.indexOf('--page');
const pageName = pageFlag >= 0 ? args.splice(pageFlag, 2)[1] : 'Icons';
const [input, outDir] = args;
if (!input || !outDir) {
  console.error(
    'usage: node scripts/ociDrawioToSvg.mjs <library.xml | file.drawio> <out-dir> [--page <name>]',
  );
  process.exit(1);
}

/** draw.io's compressed form: base64 → raw deflate → URL-encoded XML. */
function inflate(encoded) {
  return decodeURIComponent(inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8'));
}

/** Titles and captions arrive double-escaped (`-&amp;nbsp;Data`), so this decodes until stable. */
function decodeEntities(text) {
  let current = text;
  for (let round = 0; round < 3; round++) {
    const next = current
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
    if (next === current) break;
    current = next;
  }
  return current;
}

/** The caption text of a cell: its HTML value without tags, or ''. */
function caption(cell) {
  return decodeEntities(cell.value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The `<mxCell>`s of one model with their style map, tree links and absolute box. */
function parseCells(model) {
  // A cell wrapped in `<UserObject id label>` keeps its id and text on the wrapper.
  const flat = model
    .replace(
      /<(?:UserObject|object)\b([^>]*)>\s*<mxCell\b/g,
      (_, attrs) => `<mxCell ${attrs.replace(/\blabel=/, 'value=')}`,
    )
    .replace(/<\/(?:UserObject|object)>/g, '');
  const cells = new Map();
  let order = 0;
  for (const match of flat.matchAll(/<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g)) {
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/([a-zA-Z]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]),
    );
    const geometry = match[2]?.match(/<mxGeometry\b([^>]*)\/?>/)?.[1] ?? '';
    const geo = Object.fromEntries(
      [...geometry.matchAll(/([a-zA-Z]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]),
    );
    const style = {};
    for (const part of (attrs.style ?? '').split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) style[part.slice(0, eq)] = part.slice(eq + 1);
      else if (part) style[part] = '1';
    }
    // The stencil holds `;`-free base64, so splitting on `;` above kept it whole.
    const stencil = attrs.style?.match(/shape=stencil\(([^)]*)\)/)?.[1];
    cells.set(attrs.id, {
      id: attrs.id,
      order: order++,
      parent: attrs.parent,
      value: attrs.value ?? '',
      vertex: attrs.vertex === '1',
      edge: attrs.edge === '1',
      relative: geo.relative === '1',
      group: (attrs.style ?? '').startsWith('group'),
      x: Number(geo.x ?? 0),
      y: Number(geo.y ?? 0),
      w: Number(geo.width ?? 0),
      h: Number(geo.height ?? 0),
      style,
      stencil,
      children: [],
    });
  }
  for (const cell of cells.values()) {
    const parent = cells.get(cell.parent);
    if (parent && parent !== cell) parent.children.push(cell);
  }
  // Absolute position: a vertex's geometry is relative to its parent's origin.
  const absolute = (cell, depth = 0) => {
    if (cell.ax !== undefined) return;
    const parent = cells.get(cell.parent);
    if (parent && parent.id !== '0' && parent.id !== '1' && parent.vertex && depth < 64) {
      absolute(parent, depth + 1);
      cell.ax = parent.ax + cell.x;
      cell.ay = parent.ay + cell.y;
    } else {
      cell.ax = cell.x;
      cell.ay = cell.y;
    }
  };
  for (const cell of cells.values()) absolute(cell);
  return cells;
}

/** Two decimals, no trailing zeros, no leading zero: `0.50` → `.5`, `-0.5` → `-.5`. */
const fmt = (n) => {
  const rounded = Math.round(n * 100) / 100;
  if (rounded === 0) return '0';
  return String(rounded).replace(/^(-?)0\./, '$1.');
};

/**
 * Path data in its shortest spelling.
 *
 * Visio-born stencils spell every point in full and repeat the last one, so a
 * plain rendering of the toolkit ran to 7 KB per icon. This removes repeated
 * points, closes with `Z` a line that returns to the subpath's start, writes
 * axis-aligned lines as `H`/`V`, picks the shorter of absolute and relative
 * coordinates for each command, drops the letter when a command repeats and
 * the separator when a sign or a leading dot already marks the boundary.
 */
function compactPath(segments) {
  const round = (n) => Math.round(n * 100) / 100;
  let out = '';
  let last = '';
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  const join = (numbers) =>
    numbers.map(fmt).reduce((acc, text) => {
      if (!acc) return text;
      const glue = text.startsWith('-') || (text.startsWith('.') && /\.\d*$/.test(acc)) ? '' : ' ';
      return acc + glue + text;
    }, '');
  const emit = (letter, absolute, relative) => {
    const candidates = [[letter, join(absolute)]];
    if (relative) candidates.push([letter.toLowerCase(), join(relative)]);
    const [command, text] = candidates.sort((a, b) => a[1].length - b[1].length)[0];
    // A repeated moveto must keep its letter: bare pairs after `M` are linetos.
    if (command === last && letter !== 'M') {
      const glue = text.startsWith('-') || (text.startsWith('.') && /\.\d+$/.test(out)) ? '' : ' ';
      out += glue + text;
    } else {
      out += command + text;
      last = command;
    }
  };
  for (let i = 0; i < segments.length; i++) {
    const [cmd, ...n] = segments[i];
    if (cmd === 'Z') {
      if (last !== 'Z') out += 'Z';
      last = 'Z';
      cx = startX;
      cy = startY;
      continue;
    }
    const x = round(n[n.length - 2]);
    const y = round(n[n.length - 1]);
    if (cmd === 'M') {
      emit('M', [x, y], i === 0 ? null : [x - cx, y - cy]);
      startX = x;
      startY = y;
    } else if (cmd === 'L') {
      if (x === cx && y === cy) continue;
      const next = segments[i + 1]?.[0];
      if (x === startX && y === startY && (next === undefined || next === 'M' || next === 'Z')) {
        segments[i] = ['Z'];
        i--;
        continue;
      }
      if (y === cy) emit('H', [x], [x - cx]);
      else if (x === cx) emit('V', [y], [y - cy]);
      else emit('L', [x, y], [x - cx, y - cy]);
    } else if (cmd === 'A') {
      const [rx, ry, rot, large, sweep] = n;
      emit('A', [rx, ry, rot, large, sweep, x, y], [rx, ry, rot, large, sweep, x - cx, y - cy]);
    } else {
      const points = n.map(round);
      emit(
        cmd,
        points,
        points.map((v, index) => v - (index % 2 === 0 ? cx : cy)),
      );
    }
    cx = x;
    cy = y;
  }
  return out;
}

/**
 * Replays a stencil inside `box`, returning SVG elements.
 *
 * Mirrors mxStencil.drawNode: coordinates are `x0 + x * sx`, where the scale is
 * the box over the stencil's declared size (100 when absent) and, for
 * `aspect="fixed"`, the smaller of the two applied to both axes and centred.
 */
function renderStencil(xml, box, cellStyle) {
  const shapeAttrs = xml.match(/<shape\b([^>]*)>/)?.[1] ?? '';
  const attr = (source, name) => source.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  const w0 = Number(attr(shapeAttrs, 'w') ?? 100);
  const h0 = Number(attr(shapeAttrs, 'h') ?? 100);
  let sx = box.w / w0;
  let sy = box.h / h0;
  let x0 = box.x;
  let y0 = box.y;
  if (attr(shapeAttrs, 'aspect') === 'fixed') {
    sx = sy = Math.min(sx, sy);
    x0 += (box.w - w0 * sx) / 2;
    y0 += (box.h - h0 * sy) / 2;
  }
  const minScale = Math.min(sx, sy);
  const declaredWidth = attr(shapeAttrs, 'strokewidth') ?? '1';
  const none = (color) => !color || color === 'none';

  const initial = {
    fill: none(cellStyle.fillColor) ? null : cellStyle.fillColor,
    stroke: none(cellStyle.strokeColor) ? null : cellStyle.strokeColor,
    strokeWidth:
      declaredWidth === 'inherit'
        ? Number(cellStyle.strokeWidth ?? 1)
        : Number(declaredWidth) * minScale,
    alpha: 1,
    fillAlpha: 1,
    strokeAlpha: 1,
    dashed: false,
    dashPattern: '',
  };
  let state = { ...initial };
  const stack = [];
  let segments = [];
  const out = [];
  const X = (v) => x0 + Number(v) * sx;
  const Y = (v) => y0 + Number(v) * sy;

  const paint = (fill, stroke) => {
    if (segments.length === 0) return;
    const attrs = [`d="${compactPath(segments)}"`];
    const fillColor = fill && state.fill ? state.fill : 'none';
    attrs.push(`fill="${fillColor}"`);
    const fillAlpha = state.alpha * state.fillAlpha;
    if (fillColor !== 'none' && fillAlpha < 1) attrs.push(`fill-opacity="${fmt(fillAlpha)}"`);
    if (stroke && state.stroke) {
      attrs.push(`stroke="${state.stroke}"`, `stroke-width="${fmt(state.strokeWidth)}"`);
      const strokeAlpha = state.alpha * state.strokeAlpha;
      if (strokeAlpha < 1) attrs.push(`stroke-opacity="${fmt(strokeAlpha)}"`);
      if (state.dashed) {
        const pattern = (state.dashPattern || '3 3')
          .split(/\s+/)
          .filter(Boolean)
          .map((n) => fmt(Number(n) * minScale))
          .join(' ');
        attrs.push(`stroke-dasharray="${pattern}"`);
      }
    }
    if (fillColor !== 'none' || (stroke && state.stroke)) out.push(`<path ${attrs.join(' ')}/>`);
    segments = [];
  };

  for (const op of xml.matchAll(/<([a-z-]+)\b([^>]*?)\/?>/g)) {
    const [, name, raw] = op;
    const a = (key) => attr(raw, key);
    switch (name) {
      case 'save':
        stack.push({ ...state });
        break;
      case 'restore':
        state = stack.pop() ?? { ...initial };
        break;
      case 'move':
        segments.push(['M', X(a('x')), Y(a('y'))]);
        break;
      case 'line':
        segments.push(['L', X(a('x')), Y(a('y'))]);
        break;
      case 'quad':
        segments.push(['Q', X(a('x1')), Y(a('y1')), X(a('x2')), Y(a('y2'))]);
        break;
      case 'curve':
        segments.push([
          'C',
          X(a('x1')),
          Y(a('y1')),
          X(a('x2')),
          Y(a('y2')),
          X(a('x3')),
          Y(a('y3')),
        ]);
        break;
      case 'arc':
        segments.push([
          'A',
          Number(a('rx')) * sx,
          Number(a('ry')) * sy,
          Number(a('x-axis-rotation') ?? 0),
          Number(a('large-arc-flag') ?? 0),
          Number(a('sweep-flag') ?? 0),
          X(a('x')),
          Y(a('y')),
        ]);
        break;
      case 'close':
        segments.push(['Z']);
        break;
      case 'rect': {
        const x = X(a('x'));
        const y = Y(a('y'));
        const w = Number(a('w')) * sx;
        const h = Number(a('h')) * sy;
        segments.push(['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']);
        break;
      }
      case 'roundrect': {
        const x = X(a('x'));
        const y = Y(a('y'));
        const w = Number(a('w')) * sx;
        const h = Number(a('h')) * sy;
        const factor = (Number(a('arcsize')) || 15) / 100;
        const r = Math.min(w * factor, h * factor);
        segments.push(
          ['M', x + r, y],
          ['L', x + w - r, y],
          ['A', r, r, 0, 0, 1, x + w, y + r],
          ['L', x + w, y + h - r],
          ['A', r, r, 0, 0, 1, x + w - r, y + h],
          ['L', x + r, y + h],
          ['A', r, r, 0, 0, 1, x, y + h - r],
          ['L', x, y + r],
          ['A', r, r, 0, 0, 1, x + r, y],
          ['Z'],
        );
        break;
      }
      case 'ellipse': {
        const x = X(a('x'));
        const y = Y(a('y'));
        const rx = (Number(a('w')) * sx) / 2;
        const ry = (Number(a('h')) * sy) / 2;
        segments.push(
          ['M', x, y + ry],
          ['A', rx, ry, 0, 1, 0, x + 2 * rx, y + ry],
          ['A', rx, ry, 0, 1, 0, x, y + ry],
          ['Z'],
        );
        break;
      }
      case 'fill':
        paint(true, false);
        break;
      case 'stroke':
        paint(false, true);
        break;
      case 'fillstroke':
        paint(true, true);
        break;
      case 'fillcolor':
        state.fill = none(a('color')) ? null : a('color');
        break;
      case 'strokecolor':
        state.stroke = none(a('color')) ? null : a('color');
        break;
      case 'strokewidth':
        state.strokeWidth = Number(a('width')) * (a('fixed') === '1' ? 1 : minScale);
        break;
      case 'alpha':
        state.alpha = Number(a('alpha'));
        break;
      case 'fillalpha':
        state.fillAlpha = Number(a('alpha'));
        break;
      case 'strokealpha':
        state.strokeAlpha = Number(a('alpha'));
        break;
      case 'dashed':
        state.dashed = a('dashed') === '1';
        break;
      case 'dashpattern':
        state.dashPattern = a('pattern') ?? '';
        break;
      default:
        break;
    }
  }
  return out;
}

/** The drawing of the given cells as an SVG document, or null when nothing paints. */
function cellsToSvg(cells) {
  // Document order is paint order: a white backing plate precedes the glyph on it.
  const drawable = [...cells]
    .sort((a, b) => a.order - b.order)
    .filter(
      (cell) =>
        cell.vertex &&
        !cell.edge &&
        !cell.relative &&
        cell.stencil &&
        cell.w > 0 &&
        cell.h > 0 &&
        // Captions carry the stencil of their text box; the drawing is never in them.
        !caption(cell),
    )
    .map((cell) => ({ cell, ops: inflate(cell.stencil) }))
    .filter(({ ops }) => /<(?:fillstroke|fill|stroke)\b/.test(ops));
  if (drawable.length === 0) return null;
  // The page places icons thousands of units from the origin; the drawing
  // starts at 0 0 so its coordinates stay short.
  const x1 = Math.min(...drawable.map(({ cell }) => cell.ax));
  const y1 = Math.min(...drawable.map(({ cell }) => cell.ay));
  const x2 = Math.max(...drawable.map(({ cell }) => cell.ax + cell.w));
  const y2 = Math.max(...drawable.map(({ cell }) => cell.ay + cell.h));
  const paths = drawable.flatMap(({ cell, ops }) =>
    renderStencil(ops, { x: cell.ax - x1, y: cell.ay - y1, w: cell.w, h: cell.h }, cell.style),
  );
  if (paths.length === 0) return null;
  const viewBox = `0 0 ${fmt(x2 - x1)} ${fmt(y2 - y1)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${paths.join('\n')}\n</svg>\n`;
}

/** Every cell below `root`, root included. */
function descendants(root) {
  const out = [root];
  for (let i = 0; i < out.length; i++) out.push(...out[i].children);
  return out;
}

/**
 * An SVG embedded as a `data:image/svg+xml` cell image, made self-contained.
 *
 * The connector examples carry their glyphs (FastConnect, Site-to-Site VPN) as
 * Illustrator exports that colour elements through `<style>` classes. A sprite
 * shares one stylesheet across every symbol, so `.st0` from one icon would
 * recolour another: the classes are resolved into presentation attributes and
 * the stylesheet dropped. Editor prologues and comments go with it.
 */
function inlineEmbeddedSvg(dataUrl) {
  const encoded = dataUrl.match(/^data:image\/svg\+xml[;,]([\s\S]*)$/)?.[1];
  if (!encoded) return null;
  let svg = Buffer.from(encoded.replace(/^base64,/, ''), 'base64').toString('utf8');
  const rules = new Map();
  for (const [, sheet] of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const [, names, body] of sheet.matchAll(/([.#][^{]+)\{([^}]*)\}/g)) {
      for (const name of names.split(',')) {
        const cls = name.trim().replace(/^\./, '');
        const decls = body
          .split(';')
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d) => d.split(':').map((part) => part.trim()));
        rules.set(cls, [...(rules.get(cls) ?? []), ...decls]);
      }
    }
  }
  svg = svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(
      /<([a-zA-Z]+)\b([^>]*?)\sclass="([^"]*)"([^>]*?)(\/?)>/g,
      (_, tag, before, classes, after, close) => {
        const attrs = [];
        for (const cls of classes.split(/\s+/)) {
          for (const [prop, value] of rules.get(cls) ?? []) {
            if (prop && value && !/^(class|style)$/.test(prop)) attrs.push(`${prop}="${value}"`);
          }
        }
        return `<${tag}${before}${attrs.length ? ` ${attrs.join(' ')}` : ''}${after}${close}>`;
      },
    )
    .replace(/\s+xml:space="[^"]*"/g, '')
    .replace(/\s+style="enable-background:[^"]*"/g, '')
    .replace(/\s+x="0px"\s+y="0px"/g, '')
    .replace(/\s+version="1.1"/g, '')
    .replace(/\s+id="Layer_1"/g, '')
    .trim();
  return /<svg\b[^>]*viewBox=/.test(svg) ? `${svg}\n` : null;
}

/** The library: one icon per entry, titled by the entry. */
function fromLibrary(source) {
  const entries = JSON.parse(
    source.replace(/^\s*<mxlibrary>/, '').replace(/<\/mxlibrary>\s*$/, ''),
  );
  const icons = [];
  for (const entry of entries) {
    if (!entry.xml || !entry.title) continue;
    const cells = [...parseCells(inflate(entry.xml)).values()];
    const icon = { title: decodeEntities(entry.title), cells };
    // Entries drawn only with an embedded image (the connector glyphs) keep it.
    const images = new Set(
      cells.map((cell) => cell.style.image).filter((img) => img?.startsWith('data:image/svg+xml')),
    );
    if (images.size === 1 && !cells.some((cell) => cell.stencil && !caption(cell) && cell.w > 20)) {
      icon.svg = inlineEmbeddedSvg([...images][0]);
    }
    icons.push(icon);
  }
  return icons;
}

/**
 * A toolkit page: one icon per subtree that holds stencils and caption lines.
 *
 * The page is a grid of containers, each an icon with its caption split into
 * one text cell per line; a few icons sit loose at the top level next to their
 * caption. A container whose children are themselves captioned drawings is a
 * category, and its children are visited one by one. Loose cells are clustered
 * by proximity and captioned by the loose text just beneath them.
 */
function fromPage(source, name) {
  const page = [...source.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram>/g)].find(
    ([, attrs]) => attrs.match(/\bname="([^"]*)"/)?.[1] === name,
  );
  if (!page) throw new Error(`page "${name}" not found`);
  const body = page[2].trim();
  const model = body.startsWith('<') ? body : inflate(body);
  const cells = parseCells(model);
  const hasCaption = (cell) => Boolean(caption(cell));
  const drawn = (cell) => descendants(cell).some((c) => c.stencil && !hasCaption(c));
  const captioned = (cell) => descendants(cell).some(hasCaption);
  const icons = [];
  const title = (nodes) =>
    nodes
      .filter(hasCaption)
      .sort((a, b) => a.ay - b.ay || a.ax - b.ax)
      .map(caption)
      .join(' ');

  const visit = (cell) => {
    if (cell.children.some((child) => drawn(child) && captioned(child))) {
      for (const child of cell.children) visit(child);
      return;
    }
    if (drawn(cell) && captioned(cell)) {
      const all = descendants(cell);
      icons.push({ title: title(all), cells: all });
    }
  };

  const top = [...cells.values()].filter((c) => c.parent === '1' && c.vertex && !c.relative);
  for (const cell of top.filter((c) => c.children.length > 0)) visit(cell);

  // Loose stencils: cluster those whose boxes sit within a few pixels of each other.
  const loose = top.filter(
    (c) => c.children.length === 0 && c.stencil && !hasCaption(c) && c.w < 400 && c.h < 400,
  );
  const looseText = top.filter(
    (c) => c.children.length === 0 && hasCaption(c) && !/<h\d/.test(decodeEntities(c.value)),
  );
  const near = (a, b, gap) =>
    a.ax - gap <= b.ax + b.w &&
    b.ax - gap <= a.ax + a.w &&
    a.ay - gap <= b.ay + b.h &&
    b.ay - gap <= a.ay + a.h;
  const clusters = [];
  for (const cell of loose) {
    const joined = clusters.filter((cluster) => cluster.some((c) => near(c, cell, 12)));
    const merged = joined.flat();
    merged.push(cell);
    for (const cluster of joined) clusters.splice(clusters.indexOf(cluster), 1);
    clusters.push(merged);
  }
  for (const cluster of clusters) {
    const x1 = Math.min(...cluster.map((c) => c.ax));
    const x2 = Math.max(...cluster.map((c) => c.ax + c.w));
    const y2 = Math.max(...cluster.map((c) => c.ay + c.h));
    const lines = looseText.filter(
      (t) => t.ax < x2 + 4 && t.ax + t.w > x1 - 4 && t.ay >= y2 - 4 && t.ay <= y2 + 60,
    );
    if (lines.length > 0) icons.push({ title: title(lines), cells: cluster });
  }
  return icons;
}

const source = readFileSync(input, 'utf8');
const icons = /^\s*<mxlibrary>/.test(source) ? fromLibrary(source) : fromPage(source, pageName);
mkdirSync(outDir, { recursive: true });

const used = new Map();
let written = 0;
for (const icon of icons) {
  const svg = icon.svg ?? cellsToSvg(icon.cells);
  if (!svg) continue;
  const title = icon.title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) continue;
  // Both sources repeat a few titles (three "User" variants); number the rest.
  const count = (used.get(title) ?? 0) + 1;
  used.set(title, count);
  const name = count === 1 ? title : `${title} (${count})`;
  writeFileSync(join(outDir, `${name}.svg`), svg);
  written++;
}
console.log(`wrote ${written} of ${icons.length} icons to ${outDir}`);
