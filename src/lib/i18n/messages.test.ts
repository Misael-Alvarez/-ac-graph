import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/lib/editor/templates';
import { LOCALES, MESSAGES, format, translate, type MessageKey } from './messages';

describe('message catalogue', () => {
  it('translates every key in every locale', () => {
    const keys = Object.keys(MESSAGES.en) as MessageKey[];
    for (const locale of LOCALES) {
      for (const key of keys) {
        expect(MESSAGES[locale][key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it('has no extra keys in a translation', () => {
    const english = Object.keys(MESSAGES.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort(), locale).toEqual(english);
    }
  });

  // `TEMPLATES` builds its keys by interpolating a template id, so a renamed
  // template would type-check happily and then print the raw key on screen.
  it('holds a name and a description for every built-in template', () => {
    for (const template of TEMPLATES) {
      for (const key of [template.nameKey, template.descriptionKey]) {
        expect(Object.keys(MESSAGES.en), key).toContain(key);
      }
    }
  });

  it('keeps placeholders consistent across locales', () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of Object.keys(MESSAGES.en) as MessageKey[]) {
      for (const locale of LOCALES) {
        expect(placeholders(MESSAGES[locale][key]), `${locale}.${key}`).toEqual(
          placeholders(MESSAGES.en[key]),
        );
      }
    }
  });
});

describe('format', () => {
  it('substitutes values', () => {
    expect(format('{count} shapes', { count: 3 })).toBe('3 shapes');
  });

  it('leaves an unknown placeholder visible rather than blanking it', () => {
    expect(format('{a} and {b}', { a: 'x' })).toBe('x and {b}');
  });

  it('returns the template untouched when there is nothing to fill', () => {
    expect(format('plain')).toBe('plain');
  });
});

describe('translate', () => {
  it('resolves per locale', () => {
    expect(translate('en', 'action.undo')).toBe('Undo');
    expect(translate('es', 'action.undo')).toBe('Deshacer');
  });

  it('interpolates values', () => {
    expect(translate('es', 'inspector.multi', { count: 4 })).toBe('4 formas seleccionadas');
  });
});
