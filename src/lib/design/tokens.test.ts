import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  cssVar,
  darkCanvas,
  darkColors,
  fontSize,
  isColor,
  isDarkCanvas,
  lightCanvas,
  lightColors,
  luminance,
  mixHex,
  radius,
  readableTextOn,
  space,
  type ColorTokens,
} from './tokens';
import { PROVIDER_COLORS } from '@/lib/editor/providers';

/** Every background a group can be tinted with by a template or the picker. */
const PROVIDER_TINTS = Object.fromEntries(
  Object.entries(PROVIDER_COLORS).map(([name, palette]) => [name, palette.fill]),
);

const css = readFileSync('src/app/globals.css', 'utf8');

/** Reads a custom property out of a specific selector block in globals.css. */
function readVar(selector: string, name: string): string | null {
  const block = css.slice(css.indexOf(`${selector} {`));
  const body = block.slice(0, block.indexOf('}'));
  const match = body.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

const colorNames = Object.keys(lightColors) as (keyof ColorTokens)[];

describe('token / CSS parity', () => {
  it('exposes every colour token as a light-mode custom property', () => {
    for (const name of colorNames) {
      const cssName = cssVar(name).slice(6, -1); // var(--x) -> x
      expect(readVar(':root', cssName), `--${cssName}`).toBe(lightColors[name]);
    }
  });

  it('overrides every colour token in dark mode', () => {
    for (const name of colorNames) {
      const cssName = cssVar(name).slice(6, -1);
      expect(readVar('.dark', cssName), `--${cssName}`).toBe(darkColors[name]);
    }
  });

  it('exposes the type scale', () => {
    for (const [name, px] of Object.entries(fontSize)) {
      expect(readVar(':root', `text-${name}`)).toBe(`${px}px`);
    }
  });

  it('exposes the radius scale', () => {
    for (const name of ['sm', 'md', 'lg', 'xl'] as const) {
      expect(readVar(':root', `radius-${name}`)).toBe(`${radius[name]}px`);
    }
  });

  it('exposes the spacing scale', () => {
    for (const step of [1, 2, 3, 4, 5, 6, 8] as const) {
      expect(readVar(':root', `space-${step}`)).toBe(`${space[step]}px`);
    }
  });
});

describe('cssVar', () => {
  it('converts camelCase token names to kebab-case properties', () => {
    expect(cssVar('surfaceRaised')).toBe('var(--surface-raised)');
    expect(cssVar('accent')).toBe('var(--accent)');
    expect(cssVar('canvasBackdrop')).toBe('var(--canvas-backdrop)');
  });
});

describe('palette quality', () => {
  /** WCAG relative luminance. */
  function luminance(hex: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  const pairs: [keyof ColorTokens, keyof ColorTokens, number][] = [
    // Body text must clear AA (4.5:1); secondary text is still body-sized here.
    ['textPrimary', 'surfaceRaised', 4.5],
    ['textSecondary', 'surfaceRaised', 4.5],
    ['textPrimary', 'surface', 4.5],
    // Tertiary text is placeholder-only, so AA-large (3:1) is the bar.
    ['textTertiary', 'surfaceRaised', 3],
    ['textOnAccent', 'accent', 4.5],
  ];

  it('meets contrast targets in light mode', () => {
    for (const [fg, bg, min] of pairs) {
      expect(contrast(lightColors[fg], lightColors[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(
        min,
      );
    }
  });

  it('meets contrast targets in dark mode', () => {
    for (const [fg, bg, min] of pairs) {
      expect(contrast(darkColors[fg], darkColors[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(
        min,
      );
    }
  });

  it('defines both themes over the same token set', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it('keeps the smallest type at a legible size', () => {
    expect(Math.min(...Object.values(fontSize))).toBeGreaterThanOrEqual(11);
  });
});

describe('readableTextOn', () => {
  it('keeps the theme colour when it already contrasts', () => {
    expect(readableTextOn(lightCanvas.groupFill, lightCanvas)).toBe(lightCanvas.titleText);
  });

  it('flips to dark text on a pale fill under the dark theme', () => {
    // A template tints groups with a pale provider colour; the dark theme's
    // near-white title would vanish on it.
    const chosen = readableTextOn('#fff8f0', darkCanvas);
    expect(chosen).not.toBe(darkCanvas.titleText);
    expect(contrastRatio(chosen, '#fff8f0')).toBeGreaterThanOrEqual(4.5);
  });

  it('flips to light text on a dark fill under the light theme', () => {
    const chosen = readableTextOn('#101418', lightCanvas);
    expect(contrastRatio(chosen, '#101418')).toBeGreaterThanOrEqual(4.5);
  });

  it('always reaches AA against any provider tint in both themes', () => {
    const tints = Object.values(PROVIDER_TINTS);
    for (const theme of [lightCanvas, darkCanvas]) {
      for (const tint of tints) {
        expect(contrastRatio(readableTextOn(tint, theme), tint), tint).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('falls back to the theme colour for a value it cannot parse', () => {
    expect(readableTextOn('rgb(1,2,3)', darkCanvas)).toBe(darkCanvas.titleText);
    expect(readableTextOn('', lightCanvas)).toBe(lightCanvas.titleText);
  });

  it('accepts three-digit hex', () => {
    expect(luminance('#fff')).toBeCloseTo(luminance('#ffffff'));
  });
});

describe('stylesheet integrity', () => {
  /** Every custom property the stylesheet defines anywhere. */
  const defined = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));

  /** Every custom property it reads. */
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));

  /**
   * Declared outside this stylesheet: the colours and the row index by React
   * inline styles, the pointer position by `useLiquidPointer`, the font pair by
   * `next/font` on the <html> element (see app/layout.tsx).
   *
   * Every one of these is written with a fallback at the point of use, so a
   * surface nobody has pointed at yet still has a defined background.
   */
  const RUNTIME_PROVIDED = new Set([
    '--chip-color',
    '--cloud-color',
    '--font-sans',
    '--font-mono',
    // The pointer's position, written by `useLiquidPointer`.
    '--gx',
    '--gy',
    // Positions measured from the DOM: the dock's active tool and the palette's
    // travelling highlight.
    '--tool-index',
    '--row-y',
    '--row-h',
    // A row's index in its list, for the stagger.
    '--i',
    // Presence: each collaborator's colour and cursor position, written by
    // the presence layer per person.
    '--user-color',
    '--cx',
    '--cy',
    // The home page showcase leans towards the pointer; the angles are written
    // by the tilt handler per move.
    '--tilt-x',
    '--tilt-y',
  ]);

  it('defines every custom property it uses', () => {
    // An undefined property makes the whole declaration invalid, silently. That
    // is how the library lost its padding and every button lost its transition:
    // `var(--space-10)` and `var(--duration-instant)` were never declared.
    const missing = [...used].filter((name) => !defined.has(name) && !RUNTIME_PROVIDED.has(name));
    expect(missing).toEqual([]);
  });

  it('declares the full radius and duration scales', () => {
    for (const name of [
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--radius-xl',
      '--radius-full',
    ]) {
      expect(defined.has(name), name).toBe(true);
    }
    for (const name of [
      '--duration-instant',
      '--duration-fast',
      '--duration-base',
      '--duration-slow',
    ]) {
      expect(defined.has(name), name).toBe(true);
    }
  });

  it('exposes the whole spacing scale it references', () => {
    for (const step of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
      expect(defined.has(`--space-${step}`), `--space-${step}`).toBe(true);
    }
  });

  it('defines the brand gradient in both themes', () => {
    expect(readVar(':root', 'brand-from')).toBeTruthy();
    expect(readVar(':root', 'brand-to')).toBeTruthy();
    expect(readVar('.dark', 'brand-from')).toBeTruthy();
    expect(readVar('.dark', 'brand-to')).toBeTruthy();
  });
});

describe('isColor', () => {
  it('accepts the two hex forms a colour input produces', () => {
    expect(isColor('#fff')).toBe(true);
    expect(isColor('#F1F3F4')).toBe(true);
  });

  it('rejects what a text field lets a user type', () => {
    // Each of these used to reach the canvas as a shape fill, and an exported
    // SVG paints an unrecognised fill black.
    for (const value of ['', 'rojo', '#12', '#1234567', 'rgb(0,0,0)', 'red', undefined]) {
      expect(isColor(value), String(value)).toBe(false);
    }
  });
});

describe('mixHex', () => {
  it('blends two colours by the share of the second', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#fff', '#000', 0.25)).toBe('#bfbfbf');
  });

  it('tells the dark canvas from the light one by its sheet', () => {
    expect(isDarkCanvas(lightCanvas)).toBe(false);
    expect(isDarkCanvas(darkCanvas)).toBe(true);
  });
});
