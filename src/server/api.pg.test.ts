import type { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramRecord, User } from '@/lib/domain';
import { addGroup, createEmptyModel } from '@/lib/engine';
import { GET as me } from '@/app/api/auth/me/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as listDiagrams, POST as createDiagram } from '@/app/api/diagrams/route';
import {
  DELETE as deleteDiagram,
  GET as getDiagram,
  PATCH as patchDiagram,
  PUT as saveDiagram,
} from '@/app/api/diagrams/[id]/route';
import { POST as duplicateDiagram } from '@/app/api/diagrams/[id]/duplicate/route';
import { GET as listVersions } from '@/app/api/diagrams/[id]/versions/route';
import { POST as restoreVersion } from '@/app/api/diagrams/[id]/versions/[versionId]/restore/route';
import { GET as openEvents } from '@/app/api/diagrams/[id]/events/route';
import { POST as postPresence } from '@/app/api/diagrams/[id]/presence/route';
import { GET as exportWorkspace } from '@/app/api/workspace/export/route';
import { POST as importWorkspace } from '@/app/api/workspace/import/route';
import { createSession, hashSessionId } from './auth/session';
import { closePool, getPool } from './db';
import { events } from './collab/events';
import {
  dropSchema,
  insertUser,
  pgAvailable,
  resetServerSingletons,
  testEnv,
  testPool,
} from './testing/pg';

/**
 * The route handlers end to end against a real database: sessions, the CSRF
 * guard, optimistic concurrency over HTTP, history, workspace dumps and the
 * events published after a commit.
 */
const SCHEMA = 't_api';
const ENV = pgAvailable() ? testEnv(SCHEMA) : null;
const ORIGIN = 'https://graph.example.com';

function modelWithGroups(n: number) {
  const m = createEmptyModel();
  for (let i = 0; i < n; i++) addGroup(m, i * 500, 0);
  return m;
}

interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string | null;
  headers?: Record<string, string>;
}

function request(path: string, options: CallOptions = {}): NextRequest {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set('cookie', `acg_session=${options.cookie}`);
  if (method !== 'GET') {
    headers.set('x-requested-with', 'ac-graph');
    headers.set('origin', ORIGIN);
  }
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const req = new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }) as Request & { nextUrl: URL };
  req.nextUrl = new URL(req.url);
  return req as unknown as NextRequest;
}

const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });

describe.skipIf(!pgAvailable())('server API over HTTP (PostgreSQL)', () => {
  let pool: Pool;
  let ada: User;
  let bob: User;
  let adaCookie: string;
  let bobCookie: string;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(ENV!)) vi.stubEnv(key, value);
    resetServerSingletons();
    pool = await testPool(SCHEMA);
    await dropSchema(pool);
    // First authenticated call runs the migrations through ensureSchema().
    const boot = await me(request('/api/auth/me', { cookie: 'unknown' }));
    expect(boot.status).toBe(401);
    ada = await insertUser(pool, 'Ada');
    bob = await insertUser(pool, 'Bob');
    adaCookie = (await createSession(ada.id, pool)).id;
    bobCookie = (await createSession(bob.id, pool)).id;
  });

  beforeEach(async () => {
    await pool.query('delete from diagrams');
  });

  afterAll(async () => {
    await closePool();
    await dropSchema(pool);
    await pool.end();
    resetServerSingletons();
    vi.unstubAllEnvs();
  });

  const create = async (title = 'Arch', cookie = adaCookie): Promise<DiagramRecord> => {
    const response = await createDiagram(
      request('/api/diagrams', {
        method: 'POST',
        cookie,
        body: { title, model: modelWithGroups(1) },
      }),
    );
    expect(response.status).toBe(201);
    return response.json();
  };

  describe('sessions', () => {
    it('identifies the user behind a valid cookie and rejects the rest', async () => {
      const ok = await me(request('/api/auth/me', { cookie: adaCookie }));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ user: ada });

      const unknown = await me(request('/api/auth/me', { cookie: 'not-a-session' }));
      expect(unknown.status).toBe(401);
      expect((await unknown.json()).code).toBe('unauthenticated');
    });

    it('stores only the hash of the session id', async () => {
      const rows = await pool.query<{ id_hash: string }>('select id_hash from sessions');
      expect(rows.rows.map((r) => r.id_hash)).toContain(hashSessionId(adaCookie));
      expect(rows.rows.map((r) => r.id_hash)).not.toContain(adaCookie);
    });

    it('ignores an expired session', async () => {
      const expired = await createSession(ada.id, pool);
      await pool.query(
        `update sessions set expires_at = now() - interval '1 minute' where id_hash = $1`,
        [hashSessionId(expired.id)],
      );
      const response = await me(request('/api/auth/me', { cookie: expired.id }));
      expect(response.status).toBe(401);
    });

    it('logout deletes the session and clears the cookie', async () => {
      const temp = await createSession(ada.id, pool);
      const response = await logout(
        request('/api/auth/logout', { method: 'POST', cookie: temp.id }),
      );
      // Discovery against the fake issuer fails, so there is no end-session URL: 204.
      expect(response.status).toBe(204);
      expect(response.headers.get('set-cookie')).toContain('acg_session=;');
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
      expect(await me(request('/api/auth/me', { cookie: temp.id }))).toMatchObject({ status: 401 });
    });
  });

  describe('diagrams', () => {
    it('creates, lists, reads', async () => {
      const created = await create('First');
      expect(created.ownerId).toBe(ada.id);

      const list = await listDiagrams(request('/api/diagrams', { cookie: bobCookie }));
      expect(await list.json()).toEqual([
        expect.objectContaining({ id: created.id, title: 'First' }),
      ]);

      const one = await getDiagram(
        request(`/api/diagrams/${created.id}`, { cookie: bobCookie }),
        ctx({ id: created.id }),
      );
      expect(await one.json()).toEqual(created);

      const missing = await getDiagram(
        request('/api/diagrams/ghost', { cookie: adaCookie }),
        ctx({ id: 'ghost' }),
      );
      expect(missing.status).toBe(404);
      expect((await missing.json()).code).toBe('not_found');
    });

    it('validates bodies', async () => {
      const response = await createDiagram(
        request('/api/diagrams', {
          method: 'POST',
          cookie: adaCookie,
          body: { title: '', model: { nope: true } },
        }),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe('bad_request');
      expect(body.issues.length).toBeGreaterThan(0);
    });

    it('saves with If-Match and answers 412 with the current record on a stale revision', async () => {
      const created = await create();
      const model = modelWithGroups(2);
      const saved = await saveDiagram(
        request(`/api/diagrams/${created.id}`, {
          method: 'PUT',
          cookie: adaCookie,
          headers: { 'if-match': created.updatedAt },
          body: { model, options: { snapshot: true, metadata: { title: 'Renamed' } } },
        }),
        ctx({ id: created.id }),
      );
      expect(saved.status).toBe(200);
      const current: DiagramRecord = await saved.json();
      expect(current.title).toBe('Renamed');
      expect(current.model).toEqual(model);

      const stale = await saveDiagram(
        request(`/api/diagrams/${created.id}`, {
          method: 'PUT',
          cookie: bobCookie,
          headers: { 'if-match': created.updatedAt },
          body: { model: modelWithGroups(3) },
        }),
        ctx({ id: created.id }),
      );
      expect(stale.status).toBe(412);
      const conflict = await stale.json();
      expect(conflict.code).toBe('conflict');
      expect(conflict.current).toEqual(current);
    });

    it('also honours expectedUpdatedAt in the body, and saves freely without either', async () => {
      const created = await create();
      const stale = await saveDiagram(
        request(`/api/diagrams/${created.id}`, {
          method: 'PUT',
          cookie: adaCookie,
          body: { model: modelWithGroups(2), options: { expectedUpdatedAt: 'wrong' } },
        }),
        ctx({ id: created.id }),
      );
      expect(stale.status).toBe(412);

      const free = await saveDiagram(
        request(`/api/diagrams/${created.id}`, {
          method: 'PUT',
          cookie: adaCookie,
          body: { model: modelWithGroups(2) },
        }),
        ctx({ id: created.id }),
      );
      expect(free.status).toBe(200);
    });

    it('publishes saved and meta events after a commit', async () => {
      const created = await create();
      const received: unknown[] = [];
      const off = events().subscribe(created.id, (event) => received.push(event));
      try {
        await saveDiagram(
          request(`/api/diagrams/${created.id}`, {
            method: 'PUT',
            cookie: bobCookie,
            body: { model: modelWithGroups(2), options: { metadata: { title: 'New title' } } },
          }),
          ctx({ id: created.id }),
        );
        expect(received).toEqual([
          expect.objectContaining({ type: 'saved', by: { id: bob.id, name: 'Bob' } }),
          { type: 'meta', title: 'New title' },
        ]);
      } finally {
        off();
      }
    });

    it('patches metadata, duplicates, deletes', async () => {
      const created = await create();
      const patched = await patchDiagram(
        request(`/api/diagrams/${created.id}`, {
          method: 'PATCH',
          cookie: adaCookie,
          body: { folder: 'infra' },
        }),
        ctx({ id: created.id }),
      );
      expect((await patched.json()).folder).toBe('infra');

      const rejected = await patchDiagram(
        request(`/api/diagrams/${created.id}`, {
          method: 'PATCH',
          cookie: adaCookie,
          body: { ownerId: 'hijack' },
        }),
        ctx({ id: created.id }),
      );
      expect(rejected.status).toBe(400);

      const copy = await duplicateDiagram(
        request(`/api/diagrams/${created.id}/duplicate`, { method: 'POST', cookie: bobCookie }),
        ctx({ id: created.id }),
      );
      expect(copy.status).toBe(201);
      expect(await copy.json()).toMatchObject({ title: 'Arch copy', ownerId: bob.id });

      const received: unknown[] = [];
      const off = events().subscribe(created.id, (event) => received.push(event));
      const gone = await deleteDiagram(
        request(`/api/diagrams/${created.id}`, { method: 'DELETE', cookie: adaCookie }),
        ctx({ id: created.id }),
      );
      off();
      expect(gone.status).toBe(204);
      expect(received).toEqual([{ type: 'deleted' }]);
      expect((await listDiagrams(request('/api/diagrams', { cookie: adaCookie }))).status).toBe(
        200,
      );
      expect(
        await (await listDiagrams(request('/api/diagrams', { cookie: adaCookie }))).json(),
      ).toHaveLength(1);
    });

    it('refuses oversized bodies with 413', async () => {
      const created = await create();
      const huge = request(`/api/diagrams/${created.id}`, {
        method: 'PUT',
        cookie: adaCookie,
        headers: { 'content-length': String(6 * 1024 * 1024) },
        body: { model: createEmptyModel() },
      });
      const response = await saveDiagram(huge, ctx({ id: created.id }));
      expect(response.status).toBe(413);
      expect((await response.json()).code).toBe('payload_too_large');
    });
  });

  describe('versions', () => {
    it('lists history and restores with If-Match', async () => {
      const created = await create();
      const saved: DiagramRecord = await (
        await saveDiagram(
          request(`/api/diagrams/${created.id}`, {
            method: 'PUT',
            cookie: adaCookie,
            body: { model: modelWithGroups(2), options: { snapshot: true } },
          }),
          ctx({ id: created.id }),
        )
      ).json();

      const versions = await (
        await listVersions(
          request(`/api/diagrams/${created.id}/versions`, { cookie: adaCookie }),
          ctx({ id: created.id }),
        )
      ).json();
      expect(versions).toHaveLength(1);
      expect(versions[0].model).toEqual(created.model);

      const stale = await restoreVersion(
        request(`/api/diagrams/${created.id}/versions/${versions[0].id}/restore`, {
          method: 'POST',
          cookie: adaCookie,
          headers: { 'if-match': created.updatedAt },
        }),
        ctx({ id: created.id, versionId: versions[0].id }),
      );
      expect(stale.status).toBe(412);

      const restored = await restoreVersion(
        request(`/api/diagrams/${created.id}/versions/${versions[0].id}/restore`, {
          method: 'POST',
          cookie: adaCookie,
          headers: { 'if-match': saved.updatedAt },
        }),
        ctx({ id: created.id, versionId: versions[0].id }),
      );
      expect(restored.status).toBe(200);
      expect((await restored.json()).model).toEqual(created.model);

      const unknown = await restoreVersion(
        request(`/api/diagrams/${created.id}/versions/ver_ghost/restore`, {
          method: 'POST',
          cookie: adaCookie,
        }),
        ctx({ id: created.id, versionId: 'ver_ghost' }),
      );
      expect(unknown.status).toBe(404);

      const noDiagram = await listVersions(
        request('/api/diagrams/ghost/versions', { cookie: adaCookie }),
        ctx({ id: 'ghost' }),
      );
      expect(noDiagram.status).toBe(404);
    });
  });

  describe('workspace', () => {
    it('exports and re-imports', async () => {
      await create('A');
      await create('B');
      const dump = await (
        await exportWorkspace(request('/api/workspace/export', { cookie: adaCookie }))
      ).json();
      expect(dump.diagrams).toHaveLength(2);

      const imported = await importWorkspace(
        request('/api/workspace/import', { method: 'POST', cookie: bobCookie, body: dump }),
      );
      expect(await imported.json()).toEqual({ imported: 2 });
      const list = await (
        await listDiagrams(request('/api/diagrams', { cookie: adaCookie }))
      ).json();
      expect(list).toHaveLength(4);
      expect(list.filter((d: DiagramRecord) => d.ownerId === bob.id)).toHaveLength(2);
    });

    it('rejects a malformed dump', async () => {
      const response = await importWorkspace(
        request('/api/workspace/import', {
          method: 'POST',
          cookie: adaCookie,
          body: { diagrams: 'no' },
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  describe('collaboration', () => {
    it('streams presence to a viewer and relays a save from another user', async () => {
      const created = await create();
      const abort = new AbortController();
      const req = request(`/api/diagrams/${created.id}/events`, { cookie: adaCookie });
      Object.defineProperty(req, 'signal', { value: abort.signal });
      const stream = await openEvents(req, ctx({ id: created.id }));
      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toContain('text/event-stream');

      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      const next = async () => decoder.decode((await reader.read()).value);

      expect(await next()).toContain('event: presence');

      const presence = await postPresence(
        request(`/api/diagrams/${created.id}/presence`, {
          method: 'POST',
          cookie: bobCookie,
          body: { cursor: { x: 10, y: 20 }, editing: true },
        }),
        ctx({ id: created.id }),
      );
      expect(presence.status).toBe(204);
      const roster = await next();
      expect(roster).toContain('"name":"Bob"');
      expect(roster).toContain('"editing":true');
      expect(roster).toContain('"self":false');

      await saveDiagram(
        request(`/api/diagrams/${created.id}`, {
          method: 'PUT',
          cookie: bobCookie,
          body: { model: modelWithGroups(2) },
        }),
        ctx({ id: created.id }),
      );
      const saved = await next();
      expect(saved).toContain('event: saved');
      expect(saved).toContain(`"by":{"id":"${bob.id}","name":"Bob"}`);

      abort.abort();
      expect((await reader.read()).done).toBe(true);
    });

    it('refuses a stream for an unknown diagram and an invalid presence body', async () => {
      const missing = await openEvents(
        request('/api/diagrams/ghost/events', { cookie: adaCookie }),
        ctx({ id: 'ghost' }),
      );
      expect(missing.status).toBe(404);

      const created = await create();
      const bad = await postPresence(
        request(`/api/diagrams/${created.id}/presence`, {
          method: 'POST',
          cookie: adaCookie,
          body: { cursor: { x: 'a' } },
        }),
        ctx({ id: created.id }),
      );
      expect(bad.status).toBe(400);
    });
  });

  it('uses the process-wide pool exactly once', () => {
    expect(getPool()).toBe(getPool());
  });
});
