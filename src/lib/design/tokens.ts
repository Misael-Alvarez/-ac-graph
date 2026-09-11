/**
 * Design tokens — the single source of truth for the visual system.
 *
 * Values live here in TypeScript because the SVG renderer needs literal colours:
 * an exported .svg carries no stylesheet, so `var(--surface)` would resolve to
 * nothing in the downloaded file. `globals.css` mirrors these same values as CSS
 * custom properties for the chrome, and `tokens.test.ts` fails if the two drift.
 */

/**
 * Type scale. The previous UI used 8, 9 and 10px text, which is below the
 * legible minimum and left no room for hierarchy. 11px is the floor now.
 */
export const fontSize = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 15,
  lg: 18,
  xl: 24,
} as const;

export const lineHeight = {
  tight: 1.25,
  normal: 1.45,
  relaxed: 1.6,
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/** 4pt spacing scale. Every margin, padding and gap must come from here. */
export const space = {
  0: 0,
  px: 1,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 10,
  xl: 16,
  full: 9999,
} as const;

/** Three elevation levels, no more. Level 0 is flat with a border. */
export const elevation = {
  1: '0 1px 2px rgba(15, 18, 23, 0.06), 0 1px 3px rgba(15, 18, 23, 0.04)',
  2: '0 2px 8px rgba(15, 18, 23, 0.08), 0 1px 3px rgba(15, 18, 23, 0.06)',
  3: '0 8px 28px rgba(15, 18, 23, 0.14), 0 2px 6px rgba(15, 18, 23, 0.08)',
} as const;

/** Panels and menus animate at `fast`; only page-level transitions use `slow`. */
export const duration = {
  instant: 80,
  fast: 120,
  base: 160,
  slow: 240,
} as const;

export const easing = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
} as const;

export const zIndex = {
  canvas: 0,
  guides: 10,
  dock: 20,
  panel: 30,
  overlay: 40,
  menu: 50,
  toast: 60,
} as const;

/**
 * Semantic colours. Named by role, not by appearance, so a dark-mode value can
 * be lighter than its light-mode counterpart without the name turning into a lie.
 */
export interface ColorTokens {
  /** App chrome behind panels. */
  surface: string;
  /** Panels, menus, cards. */
  surfaceRaised: string;
  /** Hover/pressed wash on interactive surfaces. */
  surfaceHover: string;
  /** The area the canvas floats on. */
  canvasBackdrop: string;
  /** The canvas sheet itself. */
  canvasSheet: string;
  /** Grid dots on the canvas. */
  canvasGrid: string;
  textPrimary: string;
  textSecondary: string;
  /** Placeholder and disabled text. */
  textTertiary: string;
  /** Text on an accent-filled surface. */
  textOnAccent: string;
  borderSubtle: string;
  borderStrong: string;
  accent: string;
  accentHover: string;
  accentSubtle: string;
  danger: string;
  dangerSubtle: string;
  success: string;
  warning: string;
  /** Selection outline on canvas shapes. */
  selection: string;
  /** Alignment guide lines. */
  guide: string;
}

/**
 * The light chrome.
 *
 * Cooler and flatter than it was: neutrals with a trace of blue in them, so the
 * grey never reads as warm beside the canvas white, and a single indigo that
 * only ever means action or state.
 */
export const lightColors: ColorTokens = {
  surface: '#f4f6fb',
  surfaceRaised: '#ffffff',
  surfaceHover: '#e9edf6',
  canvasBackdrop: '#e3e7f1',
  canvasSheet: '#ffffff',
  canvasGrid: '#d4dae8',
  textPrimary: '#0c111d',
  textSecondary: '#4d566c',
  textTertiary: '#79829a',
  textOnAccent: '#ffffff',
  borderSubtle: '#e2e6ef',
  borderStrong: '#cfd5e3',
  accent: '#6d28d9',
  accentHover: '#5b21b6',
  accentSubtle: '#efe9ff',
  danger: '#dc2626',
  dangerSubtle: '#fdeceb',
  success: '#15803d',
  warning: '#c2620a',
  selection: '#6d28d9',
  guide: '#8b5cf6',
};

/**
 * The dark chrome, and the default one.
 *
 * Deep blue-black rather than grey or pure black: black turns every panel edge
 * into a hard line and swallows every shadow, grey looks like a spreadsheet.
 * A trace of indigo in the surfaces is what lets the violet accent glow instead
 * of merely sitting there. The canvas follows the chrome here (see
 * `canvasTheme`): a dark editor with a white sheet in the middle is a lamp,
 * not a workspace.
 */
export const darkColors: ColorTokens = {
  surface: '#0b1020',
  surfaceRaised: '#121a2e',
  surfaceHover: '#1a2440',
  canvasBackdrop: '#070b16',
  canvasSheet: '#0e1526',
  canvasGrid: '#1f2a44',
  textPrimary: '#eef2ff',
  textSecondary: '#aeb8d0',
  textTertiary: '#7b88a8',
  // The accent is a light violet, so text on it has to be dark to clear AA.
  textOnAccent: '#0b0b1f',
  accent: '#a78bfa',
  accentHover: '#c4b5fd',
  accentSubtle: '#2a2152',
  borderSubtle: '#1f2a44',
  borderStrong: '#2e3b5c',
  danger: '#f87171',
  dangerSubtle: '#3a1d24',
  success: '#4ade80',
  warning: '#fbbf24',
  selection: '#a78bfa',
  guide: '#c4b5fd',
};

/** The brand gradient, from the AION isotype: its purple into its orange. */
export const brandColors = {
  from: '#6d28d9',
  to: '#ff5f06',
} as const;

/**
 * The live colour: presence, sync and anything happening right now. Cyan on
 * purpose — it is the one hue the accent, the vendors and the status colours
 * do not use, so "someone else is here" never reads as a selection or a
 * warning.
 */
export const signalColor = '#22d3ee';

/** Brand colours of each cloud provider. Fixed by the vendors, not themeable. */
export const providerColors = {
  aws: '#ff9900',
  azure: '#0078d4',
  gcp: '#4285f4',
  oci: '#c74634',
  ibm: '#0f62fe',
  aion: '#6d28d9',
  generic: '#9aa0a6',
} as const;

/** Maps a token name to the CSS custom property that carries it. */
export function cssVar(token: keyof ColorTokens): string {
  return `var(--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;
}

/**
 * Colours used to paint the diagram itself.
 *
 * Separate from the chrome tokens because these values are baked into exported
 * SVG files, where no stylesheet exists to resolve custom properties.
 */
export interface CanvasTheme {
  sheet: string;
  grid: string;
  /** Default fill of an item card. */
  itemFill: string;
  itemStroke: string;
  groupFill: string;
  groupStroke: string;
  containerStroke: string;
  titleText: string;
  subtitleText: string;
  noteText: string;
  connector: string;
  connectorLabelFill: string;
  connectorLabelStroke: string;
  connectorLabelText: string;
  divider: string;
  /** Drop shadow applied to cards. */
  shadow: string;
  /** A note's paper when the author picked no colour: the yellow of a sticky. */
  notePaper: string;
  /** A region's tint when the author picked no colour, and its edge. */
  regionTint: string;
  regionStroke: string;
}

export const lightCanvas: CanvasTheme = {
  sheet: '#ffffff',
  grid: '#d0d2d5',
  itemFill: '#ffffff',
  itemStroke: '#dadce0',
  groupFill: '#fafbfc',
  groupStroke: '#dadce0',
  containerStroke: '#9aa0a6',
  titleText: '#202124',
  subtitleText: '#5f6368',
  noteText: '#80868b',
  connector: '#5f6368',
  connectorLabelFill: '#ffffff',
  connectorLabelStroke: '#dadce0',
  connectorLabelText: '#3c4043',
  divider: '#e8eaed',
  shadow: 'rgba(15, 18, 23, 0.10)',
  notePaper: '#fde68a',
  regionTint: '#eef2f8',
  regionStroke: '#c4cddd',
};

export const darkCanvas: CanvasTheme = {
  sheet: '#0e1526',
  grid: '#1f2a44',
  itemFill: '#16203a',
  itemStroke: '#2e3b5c',
  groupFill: '#111a30',
  groupStroke: '#263354',
  containerStroke: '#4d5a7c',
  titleText: '#eef2ff',
  subtitleText: '#aeb8d0',
  noteText: '#7b88a8',
  connector: '#94a0bb',
  connectorLabelFill: '#16203a',
  connectorLabelStroke: '#2e3b5c',
  connectorLabelText: '#d3dae8',
  divider: '#1f2a44',
  shadow: 'rgba(0, 0, 0, 0.55)',
  notePaper: '#d9b846',
  regionTint: '#141d33',
  regionStroke: '#2c3a5c',
};

/**
 * The canvas palette.
 *
 * Follows the chrome: the sheet is paper under the light interface and deep
 * blue-black under the dark one, so an export made from a dark editor looks
 * like the screen it was made from. Provider tints on groups stay legible in
 * both because `readableTextOn` picks the ink per fill.
 */
export function canvasTheme(dark = false): CanvasTheme {
  return dark ? darkCanvas : lightCanvas;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(full.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const HEX_COLOUR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Whether a stored `fill` is something a renderer can paint with.
 *
 * A shape's fill is free text: it arrives from a template, from generated code
 * or from a field the user types into. An unpaintable value must fall back to
 * the theme rather than reach the canvas — in a standalone exported SVG an
 * invalid fill is painted black, which is how a diagram comes back from an
 * export as a wall of black boxes.
 */
export function isColor(value: string | undefined | null): value is string {
  return typeof value === 'string' && HEX_COLOUR.test(value);
}

/**
 * Picks legible text for an arbitrary background.
 *
 * Shapes can carry a user- or template-chosen `fill`, which the theme knows
 * nothing about. Without this, a group tinted with a pale provider colour got
 * the dark theme's near-white title and became invisible.
 */
export function readableTextOn(background: string, theme: CanvasTheme): string {
  if (!isColor(background)) return theme.titleText;
  return contrastRatio(background, theme.titleText) >= 4.5
    ? theme.titleText
    : luminance(background) > 0.5
      ? '#1f1f1f'
      : '#f5f6f7';
}

/** Linear blend of two `#rrggbb` colours; `t` is the share of `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const k = Math.min(1, Math.max(0, t));
  const channel = (x: number, y: number) => Math.round(x + (y - x) * k);
  return `#${[channel(ar, br), channel(ag, bg), channel(ab, bb)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Whether a canvas theme is the dark one, by the only fact that matters: its sheet. */
export function isDarkCanvas(theme: CanvasTheme): boolean {
  return luminance(theme.sheet) < 0.5;
}
