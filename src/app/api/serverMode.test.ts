import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET as callback } from './auth/callback/route';
import { GET as login } from './auth/login/route';
import { POST as logout } from './auth/logout/route';
import { GET as me } from './auth/me/route';
import { GET as listDiagrams, POST as createDiagram } from './diagrams/route';
import { DELETE as deleteDiagram, GET as getDiagram } from './diagrams/[id]/route';
import { GET as exportWorkspace } from './workspace/export/route';

/**
 * The parts of the server API that answer before any database is touched:
 * the mode gate, the CSRF guard and the missing-session shortcut. Everything
 * behind them is covered by the PostgreSQL integration tests.
 */
const ORIGIN = 'https://graph.example.com';

function request(path: string, init: RequestInit = {}): NextRequest {
  const req = new Request(`${ORIGIN}${path}`, init) as Request & { nextUrl: URL };
  req.nextUrl = new URL(req.url);
  return req as unknown as NextRequest;
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function localMode() {
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('OIDC_ISSUER', '');
  vi.stubEnv('OIDC_CLIENT_ID', '');
  vi.stubEnv('APP_URL', '');
}

function serverMode() {
  // A database nobody listens on: these tests must never get that far.
  vi.stubEnv('DATABASE_URL', 'postgres://nobody:nothing@127.0.0.1:1/none');
  vi.stubEnv('OIDC_ISSUER', 'https://auth.example.com/application/o/ac-graph/');
  vi.stubEnv('OIDC_CLIENT_ID', 'client');
  vi.stubEnv('APP_URL', ORIGIN);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('in local mode', () => {
  it('every server route answers 404 server_mode_off', async () => {
    localMode();
    const responses = await Promise.all([
      login(request('/api/auth/login')),
      callback(request('/api/auth/callback?code=x&state=y')),
      logout(request('/api/auth/logout', { method: 'POST' })),
      me(request('/api/auth/me')),
      listDiagrams(request('/api/diagrams')),
      createDiagram(request('/api/diagrams', { method: 'POST' })),
      getDiagram(request('/api/diagrams/dgm_1'), context('dgm_1')),
      exportWorkspace(request('/api/workspace/export')),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe('server_mode_off');
    }
  });
});

describe('in server mode, before the database', () => {
  it('a read without a session cookie is 401', async () => {
    serverMode();
    const response = await listDiagrams(request('/api/diagrams'));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthenticated' });
  });

  it('a mutation without the same-origin marker is 403, even with a cookie', async () => {
    serverMode();
    const response = await deleteDiagram(
      request('/api/diagrams/dgm_1', {
        method: 'DELETE',
        headers: { cookie: 'acg_session=abc', origin: ORIGIN },
      }),
      context('dgm_1'),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'forbidden' });
  });

  it('a mutation from another origin is 403', async () => {
    serverMode();
    const response = await createDiagram(
      request('/api/diagrams', {
        method: 'POST',
        headers: {
          cookie: 'acg_session=abc',
          origin: 'https://evil.example',
          'x-requested-with': 'ac-graph',
        },
      }),
    );
    expect(response.status).toBe(403);
  });

  it('logout is guarded the same way', async () => {
    serverMode();
    const response = await logout(request('/api/auth/logout', { method: 'POST' }));
    expect(response.status).toBe(403);
  });
});
