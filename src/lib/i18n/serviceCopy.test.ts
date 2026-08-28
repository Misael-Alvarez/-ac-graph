import { describe, it, expect } from 'vitest';
import { SERVICE_CATEGORIES, SERVICE_ICONS } from '@/data/serviceIcons';
import {
  SERVICE_DESCRIPTIONS_ES,
  serviceAreaLabel,
  serviceDescription,
  serviceDescriptions,
} from './serviceCopy';

const described = SERVICE_ICONS.filter((s) => s.description);
const englishInUse = new Set(described.map((s) => s.description as string));

describe('the catalogue speaks both languages', () => {
  // The guard that matters: `serviceIcons.ts` is regenerated from the master
  // list, so a new release can introduce a description no one has translated.
  // Nothing would break at runtime — it falls back to English — which is
  // exactly why it needs a test to be noticed at all.
  it('translates every description the generated data carries', () => {
    const missing = [...englishInUse].filter((text) => !(text in SERVICE_DESCRIPTIONS_ES));
    expect(missing, `untranslated: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps no translation for a description the data dropped', () => {
    const stale = Object.keys(SERVICE_DESCRIPTIONS_ES).filter((text) => !englishInUse.has(text));
    expect(stale, `stale: ${stale.join(', ')}`).toEqual([]);
  });

  it('actually says something different in Spanish', () => {
    const untouched = [...englishInUse].filter((t) => SERVICE_DESCRIPTIONS_ES[t] === t);
    // A handful are the same word in both languages; a wholesale copy is not.
    expect(untouched.length).toBeLessThan(englishInUse.size * 0.1);
  });

  it('names every functional area the browser can group by', () => {
    for (const category of SERVICE_CATEGORIES) {
      const es = serviceAreaLabel(category.id, category.label, 'es');
      expect(es, category.id).toBeTruthy();
      expect(serviceAreaLabel(category.id, category.label, 'en')).toBe(category.label);
    }
  });
});

describe('serviceDescription', () => {
  const lambda = SERVICE_ICONS.find((s) => s.key === 'aws-lambda');

  it('returns English untouched', () => {
    expect(serviceDescription(lambda, 'en')).toBe(lambda?.description);
  });

  it('translates for Spanish', () => {
    expect(serviceDescription(lambda, 'es')).toBe('Cómputo serverless');
  });

  it('is an empty string for a service with no description, in either language', () => {
    const bare = SERVICE_ICONS.find((s) => !s.description);
    expect(serviceDescription(bare, 'es')).toBe('');
    expect(serviceDescription(undefined, 'en')).toBe('');
  });

  it('falls back to English rather than to nothing', () => {
    const invented = { key: 'x', label: 'X', category: 'aws' as const, description: 'Nowhere' };
    expect(serviceDescription(invented, 'es')).toBe('Nowhere');
  });
});

describe('serviceDescriptions', () => {
  it('offers both languages so a search and a round trip match either', () => {
    const lambda = SERVICE_ICONS.find((s) => s.key === 'aws-lambda');
    expect(serviceDescriptions(lambda)).toEqual(['Serverless compute', 'Cómputo serverless']);
  });

  it('does not repeat a description that reads the same in both', () => {
    const same = { key: 'x', label: 'X', category: 'aws' as const, description: 'DevOps' };
    expect(serviceDescriptions(same)).toEqual(['DevOps']);
  });

  it('is empty for a service with nothing to say', () => {
    expect(serviceDescriptions(undefined)).toEqual([]);
  });
});
