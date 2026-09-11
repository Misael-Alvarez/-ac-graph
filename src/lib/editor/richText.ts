/**
 * The little markup a note or a free text understands, and how it is laid out.
 *
 * A note is a sentence or a list, not a document: `**bold**`, `*italic*`,
 * `` `code` ``, a `- ` bullet, a `# ` or `## ` heading and a blank line between
 * paragraphs are the whole vocabulary. Anything else is written as typed, so a
 * stray asterisk never swallows the rest of the text.
 *
 * The layout is done here, in numbers, rather than left to the browser. The
 * canvas, the export, the embed and the library preview all draw the same SVG,
 * and SVG has no line wrapping of its own — `<foreignObject>` would give it
 * one, but rasterises to nothing in a PNG and is ignored by half the tools an
 * exported SVG ends up in. So the text is broken into lines with an estimate
 * of how wide each glyph is, which is what every diagram tool without a
 * browser does. The estimate is a few percent off at worst; a line that wraps
 * a word early is a note nobody notices, and one that runs out of its paper is
 * one everybody does, so the widths lean wide.
 */

export interface Inline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { kind: 'heading'; level: 1 | 2; runs: Inline[] }
  | { kind: 'bullet'; runs: Inline[] }
  | { kind: 'paragraph'; runs: Inline[] }
  /** A blank line: a pause between paragraphs, drawn as half a line of air. */
  | { kind: 'gap' };

/** One drawn line: where it sits in the block of text and what it says. */
export interface TextLine {
  runs: Inline[];
  /** Distance from the top of the text to the top of this line's box. */
  top: number;
  /** Where the baseline sits, from the top of the text. */
  baseline: number;
  fontSize: number;
  bold: boolean;
  /** Left inset of the text, for a bullet's hanging indent. */
  indent: number;
  /** Drawn before the first line of a bullet, and nothing before its wraps. */
  marker?: string;
}

export interface TextLayout {
  lines: TextLine[];
  /** Height of everything drawn, in the same units as the width. */
  height: number;
}

/* ── inline ─────────────────────────────────────────────── */

/**
 * Splits one line into styled runs.
 *
 * Markers pair up on the same line only, and an unmatched one is text — so a
 * price of `*9.99` or a lone backtick is shown, not lost. Bold is `**`, italic
 * a single `*` or `_` (the `_` only between spaces, so `snake_case` survives).
 */
export function parseInline(text: string): Inline[] {
  const runs: Inline[] = [];
  let buffer = '';
  let bold = false;
  let italic = false;
  let i = 0;

  const flush = () => {
    if (!buffer) return;
    runs.push({ text: buffer, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) });
    buffer = '';
  };
  /** Whether `marker` opened here closes further along the same line. */
  const closes = (marker: string, from: number) => text.indexOf(marker, from) !== -1;

  while (i < text.length) {
    const ch = text[i];
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        runs.push({ text: text.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
    } else if (ch === '*' && text[i + 1] === '*') {
      if (bold || closes('**', i + 2)) {
        flush();
        bold = !bold;
        i += 2;
        continue;
      }
    } else if (ch === '*' || (ch === '_' && (i === 0 || text[i - 1] === ' ' || italic))) {
      const closer = text.indexOf(ch, i + 1);
      const validClose = ch === '*' || closer === text.length - 1 || text[closer + 1] === ' ';
      if (italic || (closer > i + 1 && validClose)) {
        flush();
        italic = !italic;
        i += 1;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return runs;
}

/* ── blocks ─────────────────────────────────────────────── */

export function parseRichText(source: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      // Two blank lines are one pause, and a leading pause is no pause at all.
      if (blocks.length && blocks[blocks.length - 1].kind !== 'gap') blocks.push({ kind: 'gap' });
      continue;
    }
    const heading = line.match(/^(#{1,2})\s+(.*)$/);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length as 1 | 2,
        runs: parseInline(heading[2]),
      });
      continue;
    }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      blocks.push({ kind: 'bullet', runs: parseInline(bullet[1]) });
      continue;
    }
    blocks.push({ kind: 'paragraph', runs: parseInline(line.trim()) });
  }
  while (blocks.length && blocks[blocks.length - 1].kind === 'gap') blocks.pop();
  return blocks;
}

/** The text with its markers taken out, one space between what were lines. */
export function plainText(source: string): string {
  return parseRichText(source)
    .filter((block) => block.kind !== 'gap')
    .map((block) => ('runs' in block ? block.runs.map((run) => run.text).join('') : ''))
    .join(' ')
    .trim();
}

/** The first thing said — what a list, a key or a title should call the text. */
export function firstLine(source: string): string {
  const block = parseRichText(source).find((b) => b.kind !== 'gap');
  return block && 'runs' in block ? block.runs.map((run) => run.text).join('') : '';
}

/* ── measuring ──────────────────────────────────────────── */

/**
 * Advance widths as a share of the font size, for a humanist sans at the
 * weights the canvas uses. Grouped by the classes that actually differ; the
 * long tail of lowercase letters is one number, which is how such tables get
 * within a few percent of the real thing.
 */
const NARROW = new Set("il|!.,;:'".split(''));
const THIN = new Set('fjtIr'.split(''));
const WIDE = new Set('mwMW'.split(''));
const PUNCT = new Set('()[]{}-/\\"'.split(''));

export function charWidth(ch: string, code = false): number {
  if (code) return 0.62;
  if (ch === ' ') return 0.27;
  if (NARROW.has(ch)) return 0.27;
  if (THIN.has(ch)) return 0.35;
  if (WIDE.has(ch)) return 0.86;
  if (PUNCT.has(ch)) return 0.36;
  if (ch === '@' || ch === '%') return 0.94;
  if (ch >= '0' && ch <= '9') return 0.6;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  if (ch >= 'a' && ch <= 'z') return 0.56;
  // Accented letters, symbols, and anything outside Latin: assume a full em
  // for ideographs and a lowercase letter for the rest.
  return ch.charCodeAt(0) > 0x2e7f ? 1 : 0.58;
}

/** Estimated width of a run of text, in the same units as the font size. */
export function measureText(text: string, fontSize: number, bold = false, code = false): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch, code);
  return width * fontSize * (bold ? 1.05 : 1);
}

/* ── layout ─────────────────────────────────────────────── */

export interface LayoutOptions {
  /** Width the lines have to fit in. */
  width: number;
  /** Size of body text; headings and the gap are scaled from it. */
  fontSize: number;
  /** Line box as a multiple of the font size. */
  lineHeight?: number;
}

const HEADING_SCALE: Record<1 | 2, number> = { 1: 1.85, 2: 1.35 };
const BULLET_MARKER = '•';

interface Word {
  text: string;
  style: Omit<Inline, 'text'>;
  width: number;
}

/** Splits runs into words, each keeping the style of the run it came from. */
function wordsOf(runs: Inline[], fontSize: number, bold: boolean): Word[] {
  const words: Word[] = [];
  for (const run of runs) {
    const style = { bold: run.bold, italic: run.italic, code: run.code };
    for (const piece of run.text.split(/(\s+)/)) {
      if (!piece) continue;
      words.push({
        text: piece,
        style,
        width: measureText(piece, fontSize, bold || !!run.bold, run.code),
      });
    }
  }
  return words;
}

/** Cuts a word that alone is wider than the line into pieces that fit. */
function splitLongWord(word: Word, fontSize: number, bold: boolean, width: number): Word[] {
  const pieces: Word[] = [];
  let current = '';
  for (const ch of word.text) {
    const candidate = current + ch;
    if (
      current &&
      measureText(candidate, fontSize, bold || !!word.style.bold, word.style.code) > width
    ) {
      pieces.push({
        text: current,
        style: word.style,
        width: measureText(current, fontSize, bold || !!word.style.bold, word.style.code),
      });
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) {
    pieces.push({
      text: current,
      style: word.style,
      width: measureText(current, fontSize, bold || !!word.style.bold, word.style.code),
    });
  }
  return pieces;
}

/** Greedy line breaking: words go on the line until one does not fit. */
function breakLines(words: Word[], width: number, fontSize: number, bold: boolean): Inline[][] {
  const lines: Inline[][] = [];
  let line: Word[] = [];
  let used = 0;

  const commit = () => {
    // Trailing whitespace belongs to the break, not to the line.
    while (line.length && /^\s+$/.test(line[line.length - 1].text)) line.pop();
    lines.push(mergeRuns(line));
    line = [];
    used = 0;
  };
  const place = (word: Word) => {
    line.push(word);
    used += word.width;
  };

  for (const word of words) {
    const blank = /^\s+$/.test(word.text);
    // A line never starts with the space that broke the previous one.
    if (blank && !line.length) continue;
    if (line.length && used + word.width > width) {
      commit();
      if (blank) continue;
    }
    if (word.width > width) {
      // Wider than the column on its own: cut where it runs out, like a URL.
      const pieces = splitLongWord(word, fontSize, bold, width);
      pieces.forEach((piece, index) => {
        place(piece);
        if (index < pieces.length - 1) commit();
      });
      continue;
    }
    place(word);
  }
  if (line.length) commit();
  return lines.length ? lines : [[]];
}

/** Joins neighbouring words of one style back into a run, so a line is few `<tspan>`s. */
function mergeRuns(words: Word[]): Inline[] {
  const runs: Inline[] = [];
  for (const word of words) {
    const last = runs[runs.length - 1];
    if (
      last &&
      !!last.bold === !!word.style.bold &&
      !!last.italic === !!word.style.italic &&
      !!last.code === !!word.style.code
    ) {
      last.text += word.text;
    } else {
      runs.push({
        text: word.text,
        ...(word.style.bold ? { bold: true } : {}),
        ...(word.style.italic ? { italic: true } : {}),
        ...(word.style.code ? { code: true } : {}),
      });
    }
  }
  return runs;
}

/**
 * Lays the text out in a column of the given width.
 *
 * Returns the lines with their vertical positions and the total height, so a
 * renderer can draw them and a caller can size the paper to them.
 */
export function layoutRichText(source: string, options: LayoutOptions): TextLayout {
  const { width, fontSize, lineHeight = 1.35 } = options;
  const lines: TextLine[] = [];
  let y = 0;

  for (const block of parseRichText(source)) {
    if (block.kind === 'gap') {
      y += fontSize * lineHeight * 0.5;
      continue;
    }
    const heading = block.kind === 'heading';
    const size = heading ? fontSize * HEADING_SCALE[block.level] : fontSize;
    const bold = heading;
    const indent = block.kind === 'bullet' ? fontSize * 1.1 : 0;
    const box = size * lineHeight;
    const available = Math.max(width - indent, fontSize * 2);
    const broken = breakLines(wordsOf(block.runs, size, bold), available, size, bold);

    for (const [index, runs] of broken.entries()) {
      lines.push({
        runs,
        top: y,
        // Ascent of a humanist sans is roughly three quarters of the size; the
        // rest of the box is split above and below it.
        baseline: y + (box - size) / 2 + size * 0.78,
        fontSize: size,
        bold,
        indent,
        marker: block.kind === 'bullet' && index === 0 ? BULLET_MARKER : undefined,
      });
      y += box;
    }
  }

  return { lines, height: y };
}
