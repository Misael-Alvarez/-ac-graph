import { describe, expect, it } from 'vitest';
import { MESSAGES } from '@/lib/i18n/messages';
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  bindingFor,
  chordOf,
  duplicateChords,
  shortcutFor,
} from './shortcuts';

const event = (
  key: string,
  mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('shortcut registry', () => {
  it('binds every chord to exactly one command', () => {
    expect(duplicateChords()).toEqual([]);
  });

  it('describes every binding with a message that exists in both languages', () => {
    for (const shortcut of SHORTCUTS) {
      expect(MESSAGES.es[shortcut.labelKey], shortcut.labelKey).toBeTruthy();
      expect(MESSAGES.en[shortcut.labelKey], shortcut.labelKey).toBeTruthy();
    }
    for (const group of SHORTCUT_GROUPS) {
      expect(MESSAGES.es[group.titleKey]).toBeTruthy();
    }
  });

  it('tells the truth about Space and the arrow keys', () => {
    // Space held pans; arrows nudge. Neither fits the view or lays out.
    expect(SHORTCUTS.find((s) => s.keys === 'Space')?.labelKey).toBe('shortcuts.panHold');
    expect(SHORTCUTS.find((s) => s.keys === 'Arrows')?.labelKey).toBe('shortcuts.nudge');
  });

  it('finds a command chord by id', () => {
    expect(shortcutFor('undo')).toBe('Mod+Z');
    expect(shortcutFor('share')).toBe('Mod+Shift+S');
    expect(shortcutFor('nothing')).toBeUndefined();
  });
});

describe('chordOf', () => {
  it('reads Ctrl and Cmd as the same modifier', () => {
    expect(chordOf(event('z', { ctrlKey: true }))).toBe('Mod+Z');
    expect(chordOf(event('z', { metaKey: true }))).toBe('Mod+Z');
  });

  it('spells Shift for letters and named keys, not for symbols that already changed', () => {
    expect(chordOf(event('Z', { metaKey: true, shiftKey: true }))).toBe('Mod+Shift+Z');
    expect(chordOf(event('ArrowLeft', { shiftKey: true }))).toBe('Shift+Arrows');
    // `?` is Shift+/ on most layouts; the key already says what it is.
    expect(chordOf(event('?', { shiftKey: true }))).toBe('?');
  });

  it('names the special keys the sheet uses', () => {
    expect(chordOf(event(' '))).toBe('Space');
    expect(chordOf(event('Escape'))).toBe('Esc');
    expect(chordOf(event('Delete'))).toBe('Del');
    expect(chordOf(event('Backspace'))).toBe('Del');
    expect(chordOf(event('ArrowUp'))).toBe('Arrows');
  });

  it('ignores a bare modifier press', () => {
    expect(chordOf(event('Shift', { shiftKey: true }))).toBeNull();
    expect(chordOf(event('Meta', { metaKey: true }))).toBeNull();
  });

  it('resolves a chord to its binding', () => {
    expect(bindingFor('Mod+K')?.id).toBe('palette');
    expect(bindingFor('V')?.scope).toBe('tool');
    expect(bindingFor('Mod+Q')).toBeUndefined();
  });
});
