import { describe, expect, it } from 'vitest';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { MAX_CATALOG_RESULTS, SERVICES_PER_CLOUD, queryCatalog } from './catalog';

const keysOf = (result: ReturnType<typeof queryCatalog>) =>
  result.sections.flatMap((section) => section.services.map((service) => service.key));

describe('browsing a cloud', () => {
  it('shows that cloud and nothing else', () => {
    const result = queryCatalog({ cloud: 'gcp', query: '' });
    expect(result.searching).toBe(false);
    expect(result.sections.length).toBeGreaterThan(1);
    for (const key of keysOf(result)) expect(key.startsWith('gcp-')).toBe(true);
  });

  it('counts every service in the cloud, uncapped', () => {
    const result = queryCatalog({ cloud: 'aws', query: '' });
    expect(result.shown).toBe(SERVICES_PER_CLOUD.get('aws'));
    expect(result.shown).toBe(result.total);
    expect(result.shown).toBeGreaterThan(MAX_CATALOG_RESULTS);
  });

  it('orders services by name inside an area, which is how a reader scans them', () => {
    const [section] = queryCatalog({ cloud: 'aws', query: '' }).sections;
    const labels = section.services.map((service) => service.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });
});

describe('searching', () => {
  it('crosses every cloud, not just the open tab', () => {
    const clouds = new Set(
      queryCatalog({ cloud: 'aws', query: 'kubernetes' }).sections.flatMap((section) =>
        section.services.map((service) => service.category),
      ),
    );
    expect(clouds.size).toBeGreaterThan(1);
  });

  it('leads with the exact match, whatever area it is filed under', () => {
    // The regression this module exists for: ranking the matches and then
    // sorting each area alphabetically led with "ElastiCache" for `cache` and
    // "Cosmos DB Mongo" for `api`, burying the service actually named that.
    expect(queryCatalog({ cloud: 'aws', query: 'cache' }).sections[0].services[0].key).toBe(
      'gen-cache',
    );
    expect(queryCatalog({ cloud: 'aws', query: 'api' }).sections[0].services[0].key).toBe(
      'gen-api',
    );
  });

  it('keeps the ranking inside an area too', () => {
    const [first] = queryCatalog({ cloud: 'aws', query: 'kubernetes' }).sections;
    // "Kubernetes" before "Azure Arc-enabled Kubernetes", which is the opposite
    // of alphabetical order.
    expect(first.services[0].key).toBe('gen-kubernetes');
  });

  it('ranks a name above a description that merely mentions the word', () => {
    const ranked = keysOf(queryCatalog({ cloud: 'aws', query: 'lambda' }));
    expect(ranked[0]).toBe('aws-lambda');
  });

  it('caps what it returns and still reports the true total', () => {
    const result = queryCatalog({ cloud: 'aws', query: 'a', limit: 10 });
    expect(result.shown).toBe(10);
    expect(result.total).toBeGreaterThan(10);
    expect(keysOf(result)).toHaveLength(10);
  });

  it('reports nothing rather than everything when there is no match', () => {
    const result = queryCatalog({ cloud: 'aws', query: 'zzzznotaservice' });
    expect(result.sections).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('ignores surrounding whitespace, which a paste brings along', () => {
    expect(queryCatalog({ cloud: 'aws', query: '  lambda  ' }).total).toBe(
      queryCatalog({ cloud: 'aws', query: 'lambda' }).total,
    );
  });
});

describe('cloud counts', () => {
  it('accounts for every service in the catalogue', () => {
    const total = [...SERVICES_PER_CLOUD.values()].reduce((sum, count) => sum + count, 0);
    expect(total).toBe(SERVICE_ICONS.length);
  });
});

describe('browsing in Spanish', () => {
  it('names the areas in Spanish and keeps the same grouping', () => {
    const es = queryCatalog({ cloud: 'aws', query: '', locale: 'es' });
    const en = queryCatalog({ cloud: 'aws', query: '', locale: 'en' });

    expect(es.sections.map((s) => s.id)).toEqual(en.sections.map((s) => s.id));
    expect(es.sections.map((s) => s.label)).not.toEqual(en.sections.map((s) => s.label));
    expect(es.sections.find((s) => s.id === 'database')?.label).toBe('Bases de datos');
  });

  it('finds a service by what it does in either language', () => {
    // The ranking is deliberately language-blind: someone who reads Spanish
    // still types "serverless", and someone who reads English may well have
    // been handed a Spanish diagram.
    const spanish = queryCatalog({ cloud: 'aws', query: 'cómputo serverless', locale: 'es' });
    const english = queryCatalog({ cloud: 'aws', query: 'serverless compute', locale: 'en' });

    expect(keysOf(spanish)).toContain('aws-lambda');
    expect(keysOf(english)).toContain('aws-lambda');
  });

  it('answers a Spanish query even while the interface is English', () => {
    const result = queryCatalog({ cloud: 'aws', query: 'red de entrega', locale: 'en' });
    expect(keysOf(result)).toContain('aws-cloudfront');
  });
});
