import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { appMetrics } from '@/server/observability/metrics';
import { captureLogs } from '@/server/testing/logs';
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

describe('every answer is observable', () => {
  it('carries a request id and leaves one access line with the route template', async () => {
    serverMode();
    const logs = captureLogs();
    try {
      const response = await getDiagram(
        request('/api/diagrams/dgm_1', { headers: { 'x-request-id': 'proxy-0001' } }),
        context('dgm_1'),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('x-request-id')).toBe('proxy-0001');

      const [line, ...rest] = logs.named('http request');
      expect(rest).toEqual([]);
      // The handler never ran, yet the line knows which diagram was asked for.
      expect(line).toMatchObject({
        level: 'info',
        requestId: 'proxy-0001',
        method: 'GET',
        route: '/api/diagrams/[id]',
        path: '/api/diagrams/dgm_1',
        diagramId: 'dgm_1',
        status: 401,
        code: 'unauthenticated',
      });
      expect(line).not.toHaveProperty('userId');
      expect(JSON.stringify(logs.records)).not.toContain('acg_session');

      expect(
        appMetrics().httpRequests.get({ route: '/api/diagrams/[id]', method: 'GET', status: 401 }),
      ).toBe(1);
    } finally {
      logs.restore();
    }
  });

  it('a local-mode 404 is counted under its route too', async () => {
    localMode();
    const logs = captureLogs();
    try {
      await listDiagrams(request('/api/diagrams'));
      expect(logs.named('http request')[0]).toMatchObject({
        route: '/api/diagrams',
        status: 404,
        code: 'server_mode_off',
      });
    } finally {
      logs.restore();
    }
  });
});
