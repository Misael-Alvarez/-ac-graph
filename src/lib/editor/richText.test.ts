import { describe, expect, it } from 'vitest';
import {
  firstLine,
  layoutRichText,
  measureText,
  parseInline,
  parseRichText,
  plainText,
} from './richText';

describe('parseInline', () => {
  it('reads bold, italic and code', () => {
    expect(parseInline('a **b** *c* _d_ `e` f')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' ' },
      { text: 'd', italic: true },
      { text: ' ' },
      { text: 'e', code: true },
      { text: ' f' },
    ]);
  });

  it('leaves an unmatched marker as text', () => {
    expect(parseInline('costs *9.99 and 5*')).toEqual([
      { text: 'costs ' },
      { text: '9.99 and 5', italic: true },
    ]);
    expect(parseInline('a * b')).toEqual([{ text: 'a * b' }]);
    expect(parseInline('**loud')).toEqual([{ text: '**loud' }]);
    expect(parseInline('a ` b')).toEqual([{ text: 'a ` b' }]);
  });

  it('keeps an underscore inside a word', () => {
    expect(parseInline('snake_case_name here')).toEqual([{ text: 'snake_case_name here' }]);
  });

  it('nests bold inside italic', () => {
    expect(parseInline('*a **b** c*')).toEqual([
      { text: 'a ', italic: true },
      { text: 'b', bold: true, italic: true },
      { text: ' c', italic: true },
    ]);
  });
});

describe('parseRichText', () => {
  it('reads headings, bullets and paragraphs, with one gap between them', () => {
    expect(parseRichText('# Title\n## Sub\n\n\n- one\n* two\ntext\n\n')).toEqual([
      { kind: 'heading', level: 1, runs: [{ text: 'Title' }] },
      { kind: 'heading', level: 2, runs: [{ text: 'Sub' }] },
      { kind: 'gap' },
      { kind: 'bullet', runs: [{ text: 'one' }] },
      { kind: 'bullet', runs: [{ text: 'two' }] },
      { kind: 'paragraph', runs: [{ text: 'text' }] },
    ]);
  });

  it('accepts Windows line endings and drops a leading blank line', () => {
    expect(parseRichText('\r\n\r\na\r\nb')).toEqual([
      { kind: 'paragraph', runs: [{ text: 'a' }] },
      { kind: 'paragraph', runs: [{ text: 'b' }] },
    ]);
  });

  it('needs a space after the marker to make a heading or a bullet', () => {
    expect(parseRichText('#hashtag\n-dash')).toEqual([
      { kind: 'paragraph', runs: [{ text: '#hashtag' }] },
      { kind: 'paragraph', runs: [{ text: '-dash' }] },
    ]);
  });

  it('strips the markers for a plain reading', () => {
    expect(plainText('# **Todo**\n- migrate the `queue`\n\n- review IAM')).toBe(
      'Todo migrate the queue review IAM',
    );
    expect(firstLine('\n\n## *Phase* 2\nmore')).toBe('Phase 2');
    expect(firstLine('')).toBe('');
  });
});

describe('measureText', () => {
  it('grows with the text, the size and the weight', () => {
    const base = measureText('hello', 14);
    expect(base).toBeGreaterThan(0);
    expect(measureText('hello world', 14)).toBeGreaterThan(base);
    expect(measureText('hello', 28)).toBeCloseTo(base * 2);
    expect(measureText('hello', 14, true)).toBeGreaterThan(base);
  });

  it('knows a narrow letter from a wide one', () => {
    expect(measureText('iiii', 14)).toBeLessThan(measureText('mmmm', 14) / 2);
  });
});

describe('layoutRichText', () => {
  it('fits one short line and reports its height', () => {
    const { lines, height } = layoutRichText('hello', { width: 200, fontSize: 14 });
    expect(lines).toHaveLength(1);
    expect(lines[0].runs).toEqual([{ text: 'hello' }]);
    expect(height).toBeCloseTo(14 * 1.35);
    expect(lines[0].baseline).toBeGreaterThan(lines[0].top);
    expect(lines[0].baseline).toBeLessThan(height);
  });

  it('wraps at the width and never starts a line with a space', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    const { lines } = layoutRichText(text, { width: 120, fontSize: 14 });
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      const said = line.runs.map((r) => r.text).join('');
      expect(said).not.toMatch(/^\s|\s$/);
      expect(measureText(said, 14)).toBeLessThanOrEqual(120);
    }
    expect(lines.map((l) => l.runs.map((r) => r.text).join('')).join(' ')).toBe(text);
  });

  it('cuts a word wider than the column rather than letting it run out', () => {
    const { lines } = layoutRichText('https://example.com/a/very/long/path/that/goes/on', {
      width: 100,
      fontSize: 14,
    });
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureText(line.runs.map((r) => r.text).join(''), 14)).toBeLessThanOrEqual(100);
    }
  });

  it('draws a heading larger and a bullet indented with a marker', () => {
    const { lines } = layoutRichText('# Big\n- one\n- two words that wrap here', {
      width: 90,
      fontSize: 14,
    });
    expect(lines[0].fontSize).toBeCloseTo(14 * 1.85);
    expect(lines[0].bold).toBe(true);
    expect(lines[1].marker).toBe('•');
    expect(lines[1].indent).toBeGreaterThan(0);
    // The wrapped continuation of a bullet keeps the indent, not the marker.
    const wrapped = lines.slice(2);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped[0].marker).toBe('•');
    expect(wrapped[1].marker).toBeUndefined();
    expect(wrapped[1].indent).toBe(wrapped[0].indent);
  });

  it('keeps the styles across a wrap', () => {
    const { lines } = layoutRichText('plain **bold words that wrap** plain', {
      width: 110,
      fontSize: 14,
    });
    const boldRuns = lines.flatMap((l) => l.runs).filter((r) => r.bold);
    expect(
      boldRuns
        .map((r) => r.text)
        .join(' ')
        .replace(/\s+/g, ' '),
    ).toBe('bold words that wrap');
  });

  it('leaves half a line of air for a blank line', () => {
    const one = layoutRichText('a\nb', { width: 200, fontSize: 14 }).height;
    const gapped = layoutRichText('a\n\nb', { width: 200, fontSize: 14 }).height;
    expect(gapped - one).toBeCloseTo(14 * 1.35 * 0.5);
  });

  it('lays out nothing for an empty text', () => {
    expect(layoutRichText('', { width: 200, fontSize: 14 })).toEqual({ lines: [], height: 0 });
  });
});
