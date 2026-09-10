import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  darkCanvas,
  lightCanvas,
  luminance,
  readableTextOn,
} from '@/lib/design/tokens';
import { PROVIDER_COLORS, accentForFill, providerOfFill, themedFill } from './providers';

describe('themedFill', () => {
  it('leaves every fill alone on paper', () => {
    for (const palette of Object.values(PROVIDER_COLORS)) {
      expect(themedFill(palette.fill, lightCanvas)).toBe(palette.fill);
    }
    expect(themedFill('#123456', lightCanvas)).toBe('#123456');
  });

  it('re-expresses a provider pastel as a dark card tinted by that provider', () => {
    // The bug this fixes: templates tint groups cream for AWS, and on the dark
    // sheet that cream came through as a bright slab with dark cards inside.
    const aws = themedFill(PROVIDER_COLORS.aws.fill, darkCanvas)!;
    expect(aws).not.toBe(PROVIDER_COLORS.aws.fill);
    expect(luminance(aws)).toBeLessThan(0.1);
    // Still legible for the theme's own title colour.
    expect(contrastRatio(readableTextOn(aws, darkCanvas), aws)).toBeGreaterThanOrEqual(4.5);
    // Different providers stay distinguishable from each other.
    expect(themedFill(PROVIDER_COLORS.azure.fill, darkCanvas)).not.toBe(aws);
  });

  it('dims an unknown pale fill but keeps a deliberate dark or saturated one', () => {
    expect(luminance(themedFill('#fef3c7', darkCanvas)!)).toBeLessThan(0.15);
    expect(themedFill('#1e3a8a', darkCanvas)).toBe('#1e3a8a');
    expect(themedFill('#dc2626', darkCanvas)).toBe('#dc2626');
  });

  it('returns null for anything that is not a colour, so callers use the theme', () => {
    expect(themedFill(undefined, darkCanvas)).toBeNull();
    expect(themedFill('rojo', lightCanvas)).toBeNull();
  });
});

describe('provider marks', () => {
  it('recognises the pastel a provider paints its groups with', () => {
    expect(providerOfFill(PROVIDER_COLORS.gcp.fill)).toBe('gcp');
    expect(providerOfFill(PROVIDER_COLORS.gcp.fill.toUpperCase())).toBe('gcp');
    expect(providerOfFill('#123456')).toBeNull();
  });

  it('marks a group with its provider colour, or a chosen dark colour, or the neutral', () => {
    expect(accentForFill(PROVIDER_COLORS.aws.fill, lightCanvas)).toBe(PROVIDER_COLORS.aws.border);
    expect(accentForFill('#1e3a8a', lightCanvas)).toBe('#1e3a8a');
    expect(accentForFill(undefined, lightCanvas)).toBe(lightCanvas.containerStroke);
    expect(accentForFill('#ffffff', darkCanvas)).toBe(darkCanvas.containerStroke);
  });
});
