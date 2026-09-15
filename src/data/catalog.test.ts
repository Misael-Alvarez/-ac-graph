import { describe, expect, it } from 'vitest';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_SHORT_LABELS,
  SERVICE_CATEGORIES,
  SERVICE_ICONS,
} from './serviceIcons';
import {
  CLOUD_EQUIVALENCES,
  CLOUD_TARGETS,
  findEquivalent,
  getEquivalents,
} from './cloudEquivalents';
import { SVG_SYMBOLS, spriteFor } from '@/components/icons/svgIconDefs';
import iconSources from './iconSources.json';

const KEYS = new Set(SERVICE_ICONS.map((s) => s.key));
const CATEGORY_IDS = new Set(SERVICE_CATEGORIES.map((c) => c.id));
const CLOUDS = ['aws', 'azure', 'gcp', 'oci', 'ibm', 'aion', 'generic'] as const;

describe('service catalogue', () => {
  it('covers every cloud', () => {
    const present = new Set(SERVICE_ICONS.map((s) => s.category));
    for (const cloud of CLOUDS) expect(present.has(cloud), cloud).toBe(true);
  });

  it('has no duplicate keys', () => {
    expect(KEYS.size).toBe(SERVICE_ICONS.length);
  });

  it('gives every service a label and a known cloud and area', () => {
    for (const service of SERVICE_ICONS) {
      expect(service.label.trim(), service.key).not.toBe('');
      expect(CLOUDS as readonly string[], service.key).toContain(service.category);
      expect(
        CATEGORY_IDS.has(service.subcategory ?? ''),
        `${service.key} → ${service.subcategory}`,
      ).toBe(true);
    }
  });

  it('keys every service to its cloud', () => {
    const prefixes: Record<string, string> = {
      aws: 'aws-',
      azure: 'az-',
      gcp: 'gcp-',
      oci: 'oci-',
      ibm: 'ibm-',
      aion: 'aion-',
      generic: 'gen-',
    };
    for (const service of SERVICE_ICONS) {
      expect(service.key.startsWith(prefixes[service.category]), service.key).toBe(true);
    }
  });

  it('names and colours every cloud', () => {
    for (const cloud of CLOUDS) {
      expect(CATEGORY_LABELS[cloud], cloud).toBeTruthy();
      expect(CATEGORY_SHORT_LABELS[cloud], cloud).toBeTruthy();
      expect(CATEGORY_COLORS[cloud], cloud).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps the services the app shipped with, so stored diagrams still resolve', () => {
    // A handful of keys from every cloud the app originally had.
    for (const key of [
      'aws-ec2',
      'aws-s3',
      'aws-lambda',
      'aws-apigateway',
      'aws-dynamodb',
      'aws-sagemaker',
      'az-vm',
      'az-functions',
      'az-blob',
      'az-cosmosdb',
      'gcp-cloudrun',
      'gcp-bigquery',
      'gcp-cloudfunctions',
      'gen-redis',
      'gen-server',
      'aion-chatbot',
      'aion-pipeline',
    ]) {
      expect(KEYS.has(key), key).toBe(true);
    }
  });
});

describe('icons', () => {
  it('has a symbol for every service', () => {
    const missing = SERVICE_ICONS.filter((s) => !SVG_SYMBOLS[s.key]).map((s) => s.key);
    expect(missing).toEqual([]);
  });

  it('has no symbol without a service', () => {
    const orphans = Object.keys(SVG_SYMBOLS).filter((key) => !KEYS.has(key));
    expect(orphans).toEqual([]);
  });

  it('gives each symbol the right id and a viewBox', () => {
    for (const [key, symbol] of Object.entries(SVG_SYMBOLS)) {
      expect(symbol, key).toMatch(new RegExp(`^<symbol id="i-${key}"[^>]*\\bviewBox="[^"]+"`));
      expect(symbol.endsWith('</symbol>'), key).toBe(true);
    }
  });

  it('holds exactly one symbol per service', () => {
    expect(Object.keys(SVG_SYMBOLS)).toHaveLength(SERVICE_ICONS.length);
    expect(SERVICE_ICONS).toHaveLength(572);
  });

  it('is static artwork: no scripts, handlers, stylesheets, foreign objects or outside references', () => {
    for (const [key, symbol] of Object.entries(SVG_SYMBOLS)) {
      expect(symbol, key).not.toMatch(/<script|<foreignObject|<style|javascript:/i);
      expect(symbol, key).not.toMatch(/\son[a-z]+\s*=/i);
      // Every href stays in the document: fragments only, never a URL or data:.
      for (const [, target] of symbol.matchAll(/\s(?:xlink:)?href\s*=\s*"([^"]*)"/gi)) {
        expect(target, `${key} → ${target}`).toMatch(/^#/);
      }
      // A symbol scales to its `<use>`: the root's width/height never survive.
      expect(symbol, key).not.toMatch(/^<symbol[^>]*\s(?:width|height)=/);
    }
  });

  it('has no duplicate ids anywhere in the sprite', () => {
    const seen = new Map<string, string>();
    for (const [key, symbol] of Object.entries(SVG_SYMBOLS)) {
      for (const [, id] of symbol.matchAll(/\sid="([^"]+)"/g)) {
        expect(seen.has(id), `id "${id}" in ${key} already used by ${seen.get(id)}`).toBe(false);
        seen.set(id, key);
      }
    }
  });

  it('namespaces every inner id with its service key and resolves references inside the symbol', () => {
    for (const [key, symbol] of Object.entries(SVG_SYMBOLS)) {
      const ids = [...symbol.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      const inner = ids.filter((id) => id !== `i-${key}`);
      for (const id of inner) expect(id, `${key}: ${id}`).toMatch(new RegExp(`^${key}_`));
      const defined = new Set(ids);
      const references = [
        ...[...symbol.matchAll(/url\(['"]?#([^)'"]+)['"]?\)/g)].map((m) => m[1]),
        ...[...symbol.matchAll(/\s(?:xlink:)?href="#([^"]+)"/g)].map((m) => m[1]),
      ];
      for (const ref of references) {
        expect(defined.has(ref), `${key} references #${ref} which it does not define`).toBe(true);
      }
    }
  });

  it('records the provenance of every symbol', () => {
    const provenance = iconSources as Record<string, { source: string; file?: string }>;
    expect(Object.keys(provenance).sort()).toEqual([...KEYS].sort());
    for (const [key, entry] of Object.entries(provenance)) {
      expect(['pack', 'existing', 'generated'], key).toContain(entry.source);
      if (entry.source === 'pack') expect(entry.file, key).toMatch(/\.svg$/);
    }
  });

  it('draws at least 517 services with official artwork, Azure and OCI included', () => {
    const provenance = iconSources as Record<string, { source: string; file?: string }>;
    const official = Object.entries(provenance).filter(([, e]) => e.source === 'pack');
    expect(official.length).toBeGreaterThanOrEqual(517);
    const fromPack = (prefix: string, folder: string) => {
      const keys = SERVICE_ICONS.filter((s) => s.key.startsWith(prefix));
      const drawn = keys.filter(({ key }) => provenance[key].source === 'pack');
      for (const { key } of drawn) {
        expect(provenance[key].file, key).toMatch(new RegExp(`^${folder}/`));
      }
      return { total: keys.length, drawn: drawn.length };
    };
    expect(fromPack('aws-', 'aws')).toEqual({ total: 127, drawn: 126 });
    expect(fromPack('gcp-', 'gcp')).toEqual({ total: 113, drawn: 113 });
    expect(fromPack('ibm-', 'ibm')).toEqual({ total: 74, drawn: 74 });
    const azure = fromPack('az-', 'azure');
    expect(azure.total).toBe(128);
    expect(azure.drawn).toBeGreaterThanOrEqual(117);
    const oci = fromPack('oci-', 'oci');
    expect(oci.total).toBe(90);
    expect(oci.drawn).toBeGreaterThanOrEqual(87);
  });

  it('keeps every hand-made Azure and OCI symbol for the services without an official icon', () => {
    // These have no artwork in the official sets (third-party brands, or products
    // Microsoft and Oracle have not drawn yet); they keep their existing marks.
    const provenance = iconSources as Record<string, { source: string }>;
    const kept = Object.entries(provenance)
      .filter(([key, e]) => /^(az|oci)-/.test(key) && e.source === 'existing')
      .map(([key]) => key)
      .sort();
    expect(kept).toEqual([
      'az-bicep',
      'az-cli',
      'az-copilotstudio',
      'az-cyclecloud',
      'az-fabric2',
      'az-github',
      'az-githubactions',
      'az-githubcodespaces',
      'az-managedlustre',
      'az-purview',
      'az-semantickernel',
      'oci-budgets',
      'oci-costanalysis',
      'oci-vmwaresolution',
    ]);
    for (const key of kept) expect(SVG_SYMBOLS[key], key).toMatch(/<(path|rect|circle|polygon)/);
  });

  it('builds a sprite holding only what was asked for', () => {
    const sprite = spriteFor(['aws-lambda', 'gcp-bigquery', 'aws-lambda', 'does-not-exist']);
    expect(sprite).toContain('id="i-aws-lambda"');
    expect(sprite).toContain('id="i-gcp-bigquery"');
    expect((sprite.match(/<symbol/g) ?? []).length).toBe(2);
  });

  it('keeps a diagram-sized sprite far smaller than the whole set', () => {
    // The full set is inlined nowhere; this is why.
    const everything = Object.values(SVG_SYMBOLS).join('').length;
    const five = spriteFor([
      'aws-lambda',
      'aws-s3',
      'aws-dynamodb',
      'az-functions',
      'gcp-bigquery',
    ]).length;
    expect(five).toBeLessThan(everything / 20);
  });
});

describe('cloud equivalences', () => {
  it('only references services that exist', () => {
    for (const row of CLOUD_EQUIVALENCES) {
      for (const cloud of CLOUD_TARGETS) {
        const key = row[cloud];
        if (key) expect(KEYS.has(key), `${row.role} → ${cloud} → ${key}`).toBe(true);
      }
    }
  });

  it('puts each key under its own cloud', () => {
    const prefixes = { aws: 'aws-', azure: 'az-', gcp: 'gcp-', oci: 'oci-', ibm: 'ibm-' };
    for (const row of CLOUD_EQUIVALENCES) {
      for (const cloud of CLOUD_TARGETS) {
        const key = row[cloud];
        if (key) expect(key.startsWith(prefixes[cloud]), `${row.role}: ${key}`).toBe(true);
      }
    }
  });

  it('never maps a service to itself', () => {
    for (const cloud of CLOUD_TARGETS) {
      for (const row of CLOUD_EQUIVALENCES) {
        if (row[cloud]) expect(findEquivalent(row[cloud], cloud)).toBeNull();
      }
    }
  });

  it('translates across all five clouds', () => {
    expect(findEquivalent('aws-lambda', 'gcp')).toBe('gcp-cloudfunctions');
    expect(findEquivalent('aws-lambda', 'azure')).toBe('az-functions');
    expect(findEquivalent('aws-lambda', 'oci')).toBe('oci-functions');
    expect(findEquivalent('aws-lambda', 'ibm')).toBeTruthy();
    expect(findEquivalent('aws-s3', 'oci')).toBeTruthy();
  });

  it('reports the role a service plays', () => {
    const role = getEquivalents('aws-s3');
    expect(role?.role).toBeTruthy();
    expect(role?.aws).toBe('aws-s3');
  });

  it('returns nothing for a service it does not know', () => {
    expect(findEquivalent('gen-redis', 'aws')).toBeNull();
    expect(getEquivalents('not-a-key')).toBeNull();
  });
});
