import { describe, expect, it } from 'vitest';
import { darkCanvas, lightCanvas } from '@/lib/design/tokens';
import { addGroup, createEmptyModel } from '@/lib/engine';
import {
  connectorLabel,
  connectorTags,
  fitBadges,
  itemBadges,
  lifecycleStyle,
  repositoryName,
  repositoryUrl,
  strokeFor,
  stripMetadata,
  toneColors,
} from './meta';

describe('itemBadges', () => {
  it('shows nothing for a service that says nothing about itself', () => {
    expect(itemBadges({})).toEqual([]);
    expect(itemBadges({ meta: {} })).toEqual([]);
  });

  it('orders state before names and leaves the default lifecycle off', () => {
    const badges = itemBadges({
      meta: {
        owner: 'payments',
        technology: 'FastAPI',
        lifecycle: 'active',
        criticality: 'critical',
        environment: 'prod',
        repository: 'github.com/aion/payments-api.git',
        tags: ['pci', ' edge '],
      },
    });
    expect(badges.map((b) => b.text)).toEqual([
      'prod',
      'critical',
      'FastAPI',
      '@payments',
      'payments-api',
      '#pci',
      '#edge',
    ]);
    expect(badges[0]).toMatchObject({ tone: 'success', kind: 'environment' });
    expect(badges[1]).toMatchObject({ tone: 'danger', kind: 'criticality' });
    expect(badges[4]).toMatchObject({ tone: 'accent', kind: 'repository' });
  });

  it('shortens a repository to its name', () => {
    expect(repositoryName('github/payments-api')).toBe('payments-api');
    expect(repositoryName('https://github.com/aion/x.git/')).toBe('x');
    expect(repositoryName('mono')).toBe('mono');
  });

  it('links a repository only when it names a host', () => {
    expect(repositoryUrl('https://github.com/aion/x')).toBe('https://github.com/aion/x');
    expect(repositoryUrl('http://gitea.local:3000/aion/x.git')).toBe(
      'http://gitea.local:3000/aion/x.git',
    );
    expect(repositoryUrl('github.com/aion/payments-api.git')).toBe(
      'https://github.com/aion/payments-api',
    );
    expect(repositoryUrl('gitlab.example.com/team/repo')).toBe(
      'https://gitlab.example.com/team/repo',
    );
    expect(repositoryUrl('git@github.com:aion/payments-api.git')).toBe(
      'https://github.com/aion/payments-api',
    );
    expect(repositoryUrl('ssh://git@bitbucket.org/aion/x')).toBe('https://bitbucket.org/aion/x');
    // No host, no link: a forge would be a guess.
    expect(repositoryUrl('aion/payments-api')).toBeNull();
    expect(repositoryUrl('mono')).toBeNull();
    expect(repositoryUrl('   ')).toBeNull();

    const [chip] = itemBadges({ meta: { repository: 'github.com/aion/x' } });
    expect(chip).toMatchObject({
      kind: 'repository',
      text: 'x',
      href: 'https://github.com/aion/x',
    });
    expect(itemBadges({ meta: { repository: 'aion/x' } })[0].href).toBeUndefined();
  });

  it('strips every piece of metadata for a clean export, nothing else', () => {
    const model = createEmptyModel();
    addGroup(model, 0, 0);
    const item = model.shapes.find((shape) => shape.type === 'item')!;
    item.meta = { environment: 'prod', repository: 'github.com/a/b', tags: ['x'] };
    item.title = 'Kept';
    const stripped = stripMetadata(model);
    expect(stripped.shapes.find((shape) => shape.id === item.id)).toMatchObject({
      title: 'Kept',
      meta: undefined,
    });
    // The original is untouched and untouched shapes keep their identity.
    expect(item.meta?.environment).toBe('prod');
    const group = model.shapes.find((shape) => shape.type === 'group')!;
    expect(stripped.shapes.find((shape) => shape.id === group.id)).toBe(group);
  });

  it('flags the lifecycles that change how a service should be read', () => {
    expect(itemBadges({ meta: { lifecycle: 'deprecated' } })[0]).toMatchObject({
      text: 'deprecated',
      tone: 'warning',
    });
    expect(itemBadges({ meta: { lifecycle: 'planned' } })[0]).toMatchObject({ tone: 'accent' });
  });
});

describe('fitBadges', () => {
  const badges = itemBadges({
    meta: { environment: 'prod', criticality: 'high', technology: 'PostgreSQL 16', owner: 'data' },
  });

  it('keeps whole chips only, in order, and counts the rest', () => {
    const { kept, hidden } = fitBadges(badges, 120, 9);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(badges.length);
    expect(kept.map((b) => b.text)).toEqual(badges.slice(0, kept.length).map((b) => b.text));
    expect(hidden).toBe(badges.length - kept.length);
  });

  it('keeps everything when there is room', () => {
    expect(fitBadges(badges, 1000, 9)).toEqual({ kept: badges, hidden: 0 });
  });

  it('keeps nothing when even the first chip does not fit', () => {
    expect(fitBadges(badges, 10, 9)).toEqual({ kept: [], hidden: badges.length });
  });
});

describe('lifecycleStyle', () => {
  it('outlines what is planned and fades what is retired', () => {
    expect(lifecycleStyle({ meta: { lifecycle: 'planned' } })).toEqual({
      dashed: true,
      opacity: 1,
    });
    expect(lifecycleStyle({ meta: { lifecycle: 'retired' } }).opacity).toBeLessThan(1);
    expect(lifecycleStyle({})).toEqual({ dashed: false, opacity: 1 });
  });
});

describe('connectors', () => {
  it('names a call by its protocol when the author wrote no label', () => {
    expect(connectorLabel({ label: '', meta: { protocol: 'grpc' } })).toBe('gRPC');
    expect(connectorLabel({ label: 'Pagos', meta: { protocol: 'grpc' } })).toBe('Pagos');
    expect(connectorLabel({ label: '', meta: { protocol: 'other' } })).toBe('');
    expect(connectorLabel({ label: '' })).toBe('');
  });

  it('strokes each kind of call differently, and lets a hand-set dash win', () => {
    expect(strokeFor({ style: 'solid' })).toEqual({ width: 1.8 });
    expect(strokeFor({ style: 'solid', meta: { kind: 'async' } }).dasharray).toBeDefined();
    expect(strokeFor({ style: 'solid', meta: { kind: 'data' } }).width).toBeGreaterThan(1.8);
    expect(strokeFor({ style: 'solid', meta: { kind: 'dependency' } }).width).toBeLessThan(1.8);
    expect(strokeFor({ style: 'dashed', meta: { kind: 'data' } })).toEqual({
      dasharray: '7 5',
      width: 1.8,
    });
  });

  it('tags regulated data in red and every data class, public included', () => {
    expect(connectorTags({ label: '', meta: { dataClass: 'pii' } })).toEqual([
      { text: 'pii', tone: 'danger', kind: 'dataClass' },
    ]);
    expect(connectorTags({ label: '', meta: { dataClass: 'public' } })).toEqual([
      { text: 'public', tone: 'neutral', kind: 'dataClass' },
    ]);
    expect(
      connectorTags({ label: '', meta: { auth: 'OAuth2', dataClass: 'internal' } }).map(
        (t) => t.kind,
      ),
    ).toEqual(['dataClass', 'auth']);
  });

  it('shows the protocol beside a label that does not already say it', () => {
    expect(connectorTags({ label: 'Pagos', meta: { protocol: 'grpc' } })).toEqual([
      { text: 'gRPC', tone: 'accent', kind: 'protocol' },
    ]);
    // Said once: as the label, not again as a tag; or as the label's fallback.
    expect(connectorTags({ label: 'gRPC', meta: { protocol: 'grpc' } })).toEqual([]);
    expect(connectorTags({ label: '', meta: { protocol: 'grpc' } })).toEqual([]);
  });
});

describe('toneColors', () => {
  it('gives every tone a fill that differs from the card in both themes', () => {
    for (const tone of ['neutral', 'info', 'success', 'warning', 'danger', 'accent'] as const) {
      const dark = toneColors(tone, darkCanvas.itemFill, darkCanvas);
      const light = toneColors(tone, lightCanvas.itemFill, lightCanvas);
      expect(dark.fill).not.toBe(darkCanvas.itemFill);
      expect(light.fill).not.toBe(lightCanvas.itemFill);
      expect(dark.text).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
