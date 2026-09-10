import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/config', () => {
  it('reports local mode when the server variables are absent', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('OIDC_ISSUER', '');
    vi.stubEnv('OIDC_CLIENT_ID', '');
    vi.stubEnv('APP_URL', '');
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ mode: 'local' });
  });

  it('reports server mode with the auth endpoints when all four are set', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://x:y@db/acgraph');
    vi.stubEnv('OIDC_ISSUER', 'https://auth.example.com/application/o/ac-graph/');
    vi.stubEnv('OIDC_CLIENT_ID', 'client');
    vi.stubEnv('APP_URL', 'https://graph.example.com');
    expect(await GET().json()).toEqual({
      mode: 'server',
      auth: { loginUrl: '/api/auth/login', logoutUrl: '/api/auth/logout' },
    });
  });
});
