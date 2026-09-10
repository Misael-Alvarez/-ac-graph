// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  customIconKey,
  customIconMatches,
  isCustomIconKey,
  readIconFile,
  sanitizeSvg,
} from './customIcons';
import {
  MAX_LIBRARY_ICONS,
  readIconLibrary,
  removeIconFromLibrary,
  saveIconToLibrary,
} from './iconLibrary';

const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
};

describe('customIconKey', () => {
  it('slugs the name and adds a tail, so two Gateways never collide', () => {
    const a = customIconKey('API Gateway ✨', () => 0.1234);
    expect(a).toMatch(/^custom-api-gateway-[a-z0-9]{5}$/);
    expect(customIconKey('API Gateway', () => 0.5)).not.toBe(a);
    expect(isCustomIconKey(a)).toBe(true);
    expect(isCustomIconKey('aws-lambda')).toBe(false);
  });

  it('never produces an empty slug', () => {
    expect(customIconKey('!!!')).toMatch(/^custom-icon-/);
  });
});

describe('sanitizeSvg', () => {
  it('keeps the drawing and drops what runs, loads or styles the page', () => {
    const result = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
        <style>rect{fill:red}</style>
        <script>alert(1)</script>
        <defs><linearGradient id="a"><stop offset="0"/></linearGradient></defs>
        <rect width="32" height="32" fill="url(#a)" onclick="alert(1)"/>
        <image href="https://evil.example/x.png"/>
        <use href="#a"/>
        <foreignObject><div>hi</div></foreignObject>
      </svg>`,
      'custom-test-abcde',
    );
    expect(result).not.toBeNull();
    expect(result!.viewBox).toBe('0 0 32 32');
    expect(result!.body).not.toMatch(/script|<style|foreignObject|onclick|https:\/\//);
    // The gradient survives, under a namespaced id that the fill still points at.
    expect(result!.body).toContain('id="custom-test-abcde-a"');
    expect(result!.body).toContain('url(#custom-test-abcde-a)');
    expect(result!.body).toContain('href="#custom-test-abcde-a"');
  });

  it('derives a viewBox from width and height when there is none', () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><circle r="4"/></svg>',
      'custom-x-00000',
    );
    expect(result!.viewBox).toBe('0 0 48 24');
  });

  it('refuses what is not an SVG picture', () => {
    expect(sanitizeSvg('<html><body>no</body></html>', 'custom-x-00000')).toBeNull();
    expect(
      sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'custom-x-00000'),
    ).toBeNull();
    expect(sanitizeSvg('<svg', 'custom-x-00000')).toBeNull();
  });
});

describe('readIconFile', () => {
  it("turns an SVG upload into a vector icon with the form's facts", async () => {
    const file = new File(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      ],
      'logo.svg',
      { type: 'image/svg+xml' },
    );
    const result = await readIconFile(
      file,
      { name: 'Datadog', source: 'Datadog', tags: ['monitoring', ' '] },
      () => '2026-09-09T00:00:00.000Z',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.icon.name).toBe('Datadog');
    expect(result.icon.tags).toEqual(['monitoring']);
    expect(result.icon.svg?.body).toContain('<rect');
    expect(result.icon.image).toBeUndefined();
    expect(result.icon.createdAt).toBe('2026-09-09T00:00:00.000Z');
  });

  it('refuses the wrong type and the oversize', async () => {
    const pdf = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' });
    expect(await readIconFile(pdf, { name: 'x' })).toEqual({ ok: false, reason: 'type' });
    const big = new File([new Uint8Array(300 * 1024)], 'big.png', { type: 'image/png' });
    expect(await readIconFile(big, { name: 'x' })).toEqual({ ok: false, reason: 'size' });
  });
});

describe('the browser library', () => {
  const icon = (key: string) => ({
    key,
    name: key,
    createdAt: '2026-01-01T00:00:00.000Z',
    image: 'data:image/png;base64,AAAA',
  });

  it('saves newest first, replaces by key and caps the count', () => {
    const storage = memory();
    for (let i = 0; i < MAX_LIBRARY_ICONS + 5; i++)
      saveIconToLibrary(storage, icon(`custom-i-${String(i).padStart(5, '0')}`));
    const icons = readIconLibrary(storage);
    expect(icons).toHaveLength(MAX_LIBRARY_ICONS);
    expect(icons[0].key).toBe(`custom-i-${String(MAX_LIBRARY_ICONS + 4).padStart(5, '0')}`);
    saveIconToLibrary(storage, { ...icon(icons[0].key), name: 'renamed' });
    expect(readIconLibrary(storage)[0].name).toBe('renamed');
    expect(readIconLibrary(storage)).toHaveLength(MAX_LIBRARY_ICONS);
  });

  it('forgets an icon and survives garbage in storage', () => {
    const storage = memory();
    saveIconToLibrary(storage, icon('custom-a-00000'));
    expect(removeIconFromLibrary(storage, 'custom-a-00000')).toEqual([]);
    storage.setItem('aion-studio-custom-icons', '{not json');
    expect(readIconLibrary(storage)).toEqual([]);
  });

  it('matches a search against name, source and tags', () => {
    const it_ = {
      ...icon('custom-x-00000'),
      name: 'Datadog',
      source: 'SaaS',
      tags: ['monitoring'],
    };
    expect(customIconMatches(it_, 'data')).toBe(true);
    expect(customIconMatches(it_, 'monitor')).toBe(true);
    expect(customIconMatches(it_, 'saas')).toBe(true);
    expect(customIconMatches(it_, 'kafka')).toBe(false);
  });
});
