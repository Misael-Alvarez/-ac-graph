import { describe, expect, it } from 'vitest';
import { SERVICE_ICONS } from '@/data/serviceIcons';
import { switchCloud, switchShapeCloud } from './cloud';
import { modelWith } from './testUtils';

const iconKeys = (m: ReturnType<typeof modelWith>) => m.shapes.map((s) => s.icon?.key);

describe('switchCloud', () => {
  it('rewrites AWS services to their GCP equivalents', () => {
    const m = modelWith([
      { id: 'a', icon: { kind: 'symbol', key: 'aws-lambda' } },
      { id: 'b', icon: { kind: 'symbol', key: 'aws-s3' } },
    ]);
    const r = switchCloud(m, 'gcp');
    expect(r.switched).toBe(2);
    expect(iconKeys(m)).toEqual(['gcp-cloudfunctions', 'gcp-cloudstorage']);
  });

  it('relabels the shape to match the new service', () => {
    const m = modelWith([
      { id: 'a', title: 'Lambda', icon: { kind: 'symbol', key: 'aws-lambda' } },
    ]);
    switchCloud(m, 'azure');
    const svc = SERVICE_ICONS.find((s) => s.key === 'az-functions')!;
    expect(m.shapes[0].title).toBe(svc.label);
    expect(m.shapes[0].subtitle).toBe(svc.description ?? '');
  });

  it('leaves services already in the target cloud alone', () => {
    const m = modelWith([{ id: 'a', icon: { kind: 'symbol', key: 'gcp-cloudrun' } }]);
    expect(switchCloud(m, 'gcp').switched).toBe(0);
  });

  it('never touches generic or AION services', () => {
    const m = modelWith([
      { id: 'a', icon: { kind: 'symbol', key: 'gen-redis' } },
      { id: 'b', icon: { kind: 'symbol', key: 'aion-agent' } },
    ]);
    const r = switchCloud(m, 'aws');
    expect(r.switched).toBe(0);
    expect(r.skipped).toHaveLength(0);
    expect(iconKeys(m)).toEqual(['gen-redis', 'aion-agent']);
  });

  it('reports services with no equivalent instead of dropping them', () => {
    const m = modelWith([{ id: 'a', icon: { kind: 'symbol', key: 'aws-neptune' } }]);
    const r = switchCloud(m, 'gcp');
    expect(r.switched).toBe(0);
    expect(r.skipped).toEqual(['Neptune']);
    expect(m.shapes[0].icon!.key).toBe('aws-neptune');
  });

  it('ignores shapes with no icon', () => {
    const m = modelWith([{ id: 'a' }]);
    expect(switchCloud(m, 'aws').switched).toBe(0);
  });

  it('round-trips a service that exists in all three clouds', () => {
    const m = modelWith([{ id: 'a', icon: { kind: 'symbol', key: 'aws-lambda' } }]);
    switchCloud(m, 'azure');
    switchCloud(m, 'gcp');
    switchCloud(m, 'aws');
    expect(m.shapes[0].icon!.key).toBe('aws-lambda');
  });

  it('only ever emits keys that exist in the catalogue', () => {
    const known = new Set(SERVICE_ICONS.map((s) => s.key));
    for (const target of ['aws', 'azure', 'gcp'] as const) {
      const m = modelWith(
        SERVICE_ICONS.map((svc, i) => ({
          id: `s${i}`,
          icon: { kind: 'symbol' as const, key: svc.key },
        })),
      );
      switchCloud(m, target);
      for (const s of m.shapes) expect(known.has(s.icon!.key)).toBe(true);
    }
  });
});

describe('switchShapeCloud', () => {
  it('switches a single shape', () => {
    const m = modelWith([
      { id: 'a', icon: { kind: 'symbol', key: 'aws-lambda' } },
      { id: 'b', icon: { kind: 'symbol', key: 'aws-s3' } },
    ]);
    expect(switchShapeCloud(m, 'a', 'gcp')).toBe(true);
    expect(iconKeys(m)).toEqual(['gcp-cloudfunctions', 'aws-s3']);
  });

  it('returns false when there is no equivalent', () => {
    const m = modelWith([{ id: 'a', icon: { kind: 'symbol', key: 'aws-neptune' } }]);
    expect(switchShapeCloud(m, 'a', 'gcp')).toBe(false);
  });

  it('returns false for cloud-neutral and unknown shapes', () => {
    const m = modelWith([{ id: 'a', icon: { kind: 'symbol', key: 'gen-redis' } }, { id: 'b' }]);
    expect(switchShapeCloud(m, 'a', 'aws')).toBe(false);
    expect(switchShapeCloud(m, 'b', 'aws')).toBe(false);
    expect(switchShapeCloud(m, 'ghost', 'aws')).toBe(false);
  });
});

describe("retargeting writes the new subtitle in the author's language", () => {
  const lambda = () => modelWith([{ id: 'a', icon: { kind: 'symbol', key: 'aws-lambda' } }]);

  it('rewrites into Spanish when asked', () => {
    const m = lambda();
    switchCloud(m, 'gcp', 'es');
    expect(m.shapes[0].subtitle).toBe('Funciones serverless');
  });

  it('still defaults to English', () => {
    const m = lambda();
    switchCloud(m, 'gcp');
    expect(m.shapes[0].subtitle).toBe('Serverless functions');
  });

  it('does the same for a single shape', () => {
    const m = lambda();
    switchShapeCloud(m, 'a', 'gcp', 'es');
    expect(m.shapes[0].subtitle).toBe('Funciones serverless');
  });
});
