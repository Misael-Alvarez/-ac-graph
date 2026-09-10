import { describe, expect, it } from 'vitest';
import { callbackUrl, displayName, safeNextPath } from './oidc';

describe('safeNextPath', () => {
  it('keeps same-site relative paths', () => {
    expect(safeNextPath('/')).toBe('/');
    expect(safeNextPath('/d/dgm_abc?view=x')).toBe('/d/dgm_abc?view=x');
  });

  it('refuses anything that could leave the site', () => {
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
    expect(safeNextPath('d/relative')).toBe('/');
  });

  it('refuses header injection and empty input', () => {
    expect(safeNextPath('/x\r\nSet-Cookie: a=b')).toBe('/');
    expect(safeNextPath('')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
  });
});

describe('callbackUrl', () => {
  it('is the public app URL plus the fixed callback path', () => {
    expect(callbackUrl({ appUrl: 'https://graph.example.com' })).toBe(
      'https://graph.example.com/api/auth/callback',
    );
  });
});

describe('displayName', () => {
  it('prefers name, then username, then e-mail, then subject', () => {
    expect(displayName({ sub: 's', name: 'Ada', preferred_username: 'ada', email: 'a@x' })).toBe(
      'Ada',
    );
    expect(displayName({ sub: 's', preferred_username: 'ada', email: 'a@x' })).toBe('ada');
    expect(displayName({ sub: 's', email: 'a@x' })).toBe('a@x');
    expect(displayName({ sub: 's', name: '   ' })).toBe('s');
  });
});
