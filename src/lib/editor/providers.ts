import {
  isColor,
  isDarkCanvas,
  luminance,
  mixHex,
  providerColors,
  type CanvasTheme,
} from '@/lib/design/tokens';

export interface ProviderPalette {
  /** Outline of the zone and of items inside it. */
  border: string;
  /** Group background. */
  fill: string;
  /** Boundary header bar. */
  header: string;
  /** Sub-boundary header bar, one step lighter. */
  subHeader: string;
  /** Boundary body. */
  body: string;
  /** Text on the header bar. */
  headerText: string;
}

/**
 * Per-provider palettes for canvas shapes.
 *
 * Vendor brand colours are fixed, so these are not theme tokens. The tints are
 * derived from `providerColors` so a brand update only has to happen in one place.
 */
export const PROVIDER_COLORS: Record<string, ProviderPalette> = {
  aws: {
    border: providerColors.aws,
    fill: '#fff8f0',
    header: providerColors.aws,
    subHeader: '#ffb84d',
    body: '#fffaf3',
    headerText: '#ffffff',
  },
  azure: {
    border: providerColors.azure,
    fill: '#f0f6ff',
    header: providerColors.azure,
    subHeader: '#4a9fe8',
    body: '#eef4fd',
    headerText: '#ffffff',
  },
  gcp: {
    border: providerColors.gcp,
    fill: '#f0f4ff',
    header: providerColors.gcp,
    subHeader: '#7baaf7',
    body: '#eef3fd',
    headerText: '#ffffff',
  },
  aion: {
    border: providerColors.aion,
    fill: '#f8f0ff',
    header: providerColors.aion,
    subHeader: '#9b59c5',
    body: '#f5ecfd',
    headerText: '#ffffff',
  },
  oci: {
    border: providerColors.oci,
    fill: '#fdf1ef',
    header: providerColors.oci,
    subHeader: '#d9695a',
    body: '#fcf3f1',
    headerText: '#ffffff',
  },
  ibm: {
    border: providerColors.ibm,
    fill: '#eef3ff',
    header: providerColors.ibm,
    subHeader: '#4589ff',
    body: '#eff4ff',
    headerText: '#ffffff',
  },
  generic: {
    border: providerColors.generic,
    fill: '#f8f9fa',
    header: '#e8eaed',
    subHeader: '#f1f3f4',
    body: '#fbfbfc',
    headerText: '#202124',
  },
};

/** Reads the provider out of a service key such as `aws-lambda`. */
export function providerOf(iconKey: string | undefined): string {
  if (!iconKey) return 'generic';
  const prefix = iconKey.split('-')[0];
  if (prefix === 'az') return 'azure';
  return prefix in PROVIDER_COLORS ? prefix : 'generic';
}

/** Cloud prefix used in service keys, per cloud id. */
export const CLOUD_KEY_PREFIX: Record<string, string> = {
  aws: 'aws-',
  azure: 'az-',
  gcp: 'gcp-',
  oci: 'oci-',
  ibm: 'ibm-',
  aion: 'aion-',
  generic: 'gen-',
};

export function paletteFor(iconKey: string | undefined): ProviderPalette {
  return PROVIDER_COLORS[providerOf(iconKey)];
}

/** The provider whose pastel tint this stored fill is, if it is one. */
export function providerOfFill(fill: string | undefined): string | null {
  if (!isColor(fill)) return null;
  const needle = fill.toLowerCase();
  for (const [name, palette] of Object.entries(PROVIDER_COLORS)) {
    if ([palette.fill, palette.body, palette.subHeader].some((c) => c.toLowerCase() === needle)) {
      return name;
    }
  }
  return null;
}

/**
 * A stored fill, adapted to the sheet it is being drawn on.
 *
 * Fills are saved as literal colours, and every template and the provider
 * palette chose them for paper: cream for AWS, ice blue for Azure. Painted as
 * stored onto the dark sheet they become bright slabs with dark cards inside.
 * On the dark canvas a pastel is read as the *intent* — "tint this by its
 * provider" — and re-expressed as a whisper of that provider's colour over the
 * dark card. A deliberately dark or saturated fill is somebody's choice and is
 * left exactly as it is; so is everything under the light theme.
 */
export function themedFill(
  fill: string | undefined,
  theme: CanvasTheme,
  base: string = theme.groupFill,
): string | null {
  if (!isColor(fill)) return null;
  if (!isDarkCanvas(theme)) return fill;
  const provider = providerOfFill(fill);
  if (provider) return mixHex(base, PROVIDER_COLORS[provider].border, 0.1);
  // A pale colour nobody would pick for a dark card: keep its hue, lose its glare.
  if (luminance(fill) > 0.6) return mixHex(base, fill, 0.22);
  return fill;
}

/**
 * The colour that says which provider a group belongs to, for its header mark.
 * Falls back to the theme's neutral so an unbranded group still gets a mark.
 */
export function accentForFill(fill: string | undefined, theme: CanvasTheme): string {
  const provider = providerOfFill(fill);
  if (provider) return PROVIDER_COLORS[provider].border;
  if (isColor(fill) && luminance(fill) <= 0.6) return fill;
  return theme.containerStroke;
}
