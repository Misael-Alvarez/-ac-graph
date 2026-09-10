import { describe, expect, it, vi } from 'vitest';
import { fetchAppConfig } from './appConfig';

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('fetchAppConfig', () => {
  it('reads server mode with its auth endpoints', async () => {
    const config = await fetchAppConfig(
      respond(200, {
        mode: 'server',
        auth: { loginUrl: '/api/auth/login', logoutUrl: '/api/auth/logout' },
      }),
    );
    expect(config.mode).toBe('server');
    expect(config.auth?.loginUrl).toBe('/api/auth/login');
  });

  it('falls back to local mode when the endpoint fails or answers nonsense', async () => {
    expect((await fetchAppConfig(respond(500, {}))).mode).toBe('local');
    expect((await fetchAppConfig(respond(200, { mode: 'cloud' }))).mode).toBe('local');
    const failing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect((await fetchAppConfig(failing)).mode).toBe('local');
  });
});
