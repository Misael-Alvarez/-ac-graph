import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMac, modKey, shortcut, spellChord } from './platform';

afterEach(() => vi.unstubAllGlobals());

describe('shortcut spelling', () => {
  it('uses the command glyph on a Mac', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(isMac()).toBe(true);
    expect(shortcut('K')).toBe('⌘K');
  });

  it('names the control key everywhere else', () => {
    // The bug this replaces: three surfaces spelled every shortcut with ⌘,
    // so Windows and Linux were told to press a key they do not have.
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(modKey()).toBe('Ctrl+');
    expect(shortcut('K')).toBe('Ctrl+K');
  });

  it('prefers userAgentData, which is the one that is not deprecated', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, platform: 'Win32' });
    expect(isMac()).toBe(true);
  });

  it('falls back to the user agent when the platform is unset', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });
    expect(isMac()).toBe(true);
  });

  it('ignores an empty hint instead of believing it', () => {
    // Chromium hands back an empty string for the hint in some contexts, which
    // is not the same as not knowing.
    vi.stubGlobal('navigator', { userAgentData: { platform: '' }, platform: 'MacIntel' });
    expect(isMac()).toBe(true);
  });

  it('answers something usable with no navigator at all', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isMac()).toBe(false);
    expect(shortcut('K')).toBe('Ctrl+K');
  });
});

describe('spellChord', () => {
  it('runs modifier glyphs together on a Mac, the way the menu bar does', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(spellChord('Mod+Shift+S')).toBe('⌘⇧S');
    expect(spellChord('Mod+/')).toBe('⌘/');
    expect(spellChord('Del')).toBe('Del');
  });

  it('keeps words joined by plus signs elsewhere', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(spellChord('Mod+Shift+S')).toBe('Ctrl+Shift+S');
    expect(spellChord('Shift+Arrows')).toBe('Shift+Arrows');
  });
});
