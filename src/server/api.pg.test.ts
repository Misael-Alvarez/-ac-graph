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
import { GET as listMembers, PUT as putMember } from '@/app/api/diagrams/[id]/members/route';
import { DELETE as removeMember } from '@/app/api/diagrams/[id]/members/[userId]/route';
import { POST as postPresence } from '@/app/api/diagrams/[id]/presence/route';
import { GET as exportWorkspace } from '@/app/api/workspace/export/route';
import { GET as listIcons, POST as saveIcon } from '@/app/api/icons/route';
import { GET as listThreads, POST as openThread } from '@/app/api/diagrams/[id]/comments/route';
import {
  DELETE as deleteThread,
  PATCH as patchThread,
  POST as replyThread,
} from '@/app/api/diagrams/[id]/comments/[threadId]/route';
import { DELETE as deleteIcon } from '@/app/api/icons/[key]/route';
import { POST as importWorkspace } from '@/app/api/workspace/import/route';
import { GET as scrapeMetrics } from '@/app/api/metrics/route';
import { createSession, hashSessionId } from './auth/session';
import { closePool, getPool } from './db';
import { closeCollaboration } from './collab/collaboration';
import { events } from './collab/events';
import { appMetrics } from './observability/metrics';
import { captureLogs } from './testing/logs';
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
    await pool.query('delete from icons');
  });

  afterAll(async () => {
    await closeCollaboration();
    await closePool();
    await dropSchema(pool);
    await pool.end();
    resetServerSingletons();
    vi.unstubAllEnvs();
  });

  /** Ada lets Bob in with `role`; the way every test below gives Bob access. */
  const share = async (id: string, role: 'editor' | 'viewer', email = 'bob@example.com') => {
    const response = await putMember(
      request(`/api/diagrams/${id}/members`, {
        method: 'PUT',
        cookie: adaCookie,
        body: { email, role },
      }),
      ctx({ id }),
    );
    expect(response.status).toBe(200);
    return response.json();
  };

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
    it('creates a starting point when asked, and lists it as one', async () => {
      const response = await createDiagram(
        request('/api/diagrams', {
          method: 'POST',
          cookie: adaCookie,
          body: { title: 'Base', model: modelWithGroups(1), template: true },
        }),
      );
      expect(response.status).toBe(201);
      expect((await response.json()).template).toBe(true);
      const list = await (
        await listDiagrams(request('/api/diagrams', { cookie: adaCookie }))
      ).json();
      expect(list.map((d: DiagramRecord) => [d.title, d.template])).toEqual([['Base', true]]);
    });

    it('creates, lists, reads — for members only', async () => {
      const created = await create('First');
      expect(created.ownerId).toBe(ada.id);
      expect(created.role).toBe('owner');

      // Bob is a stranger: he lists nothing and is told whom to ask.
      expect(
        await (await listDiagrams(request('/api/diagrams', { cookie: bobCookie }))).json(),
      ).toEqual([]);
      const denied = await getDiagram(
        request(`/api/diagrams/${created.id}`, { cookie: bobCookie }),
        ctx({ id: created.id }),
      );
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({
        code: 'no_access',
        message: 'You do not have access to this diagram.',
        required: 'viewer',
        owner: { name: 'Ada' },
      });

      await share(created.id, 'viewer');
      const list = await listDiagrams(request('/api/diagrams', { cookie: bobCookie }));
      expect(await list.json()).toEqual([
        expect.objectContaining({ id: created.id, title: 'First', role: 'viewer' }),
      ]);

      const one = await getDiagram(
        request(`/api/diagrams/${created.id}`, { cookie: bobCookie }),
        ctx({ id: created.id }),
      );
      expect(await one.json()).toEqual({ ...created, role: 'viewer' });

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
      await share(created.id, 'editor');
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
      // The current record, as Bob may see it: same content, his own role.
      expect(conflict.current).toEqual({ ...current, role: 'editor' });
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
      await share(created.id, 'editor');
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

      await share(created.id, 'viewer');
      // A bare POST, as older clients send it: the server names the copy.
      const copy = await duplicateDiagram(
        request(`/api/diagrams/${created.id}/duplicate`, { method: 'POST', cookie: bobCookie }),
        ctx({ id: created.id }),
      );
      expect(copy.status).toBe(201);
      expect(await copy.json()).toMatchObject({ title: 'Arch copy', ownerId: bob.id });

      // The interface's own name for it, trimmed and bounded like any title.
      const named = await duplicateDiagram(
        request(`/api/diagrams/${created.id}/duplicate`, {
          method: 'POST',
          cookie: bobCookie,
          body: { title: '  Copia de Arch  ' },
        }),
        ctx({ id: created.id }),
      );
      expect(named.status).toBe(201);
      expect(await named.json()).toMatchObject({ title: 'Copia de Arch', ownerId: bob.id });

      for (const body of [{ title: 'x'.repeat(201) }, { title: '' }, { name: 'Copia' }]) {
        const refused = await duplicateDiagram(
          request(`/api/diagrams/${created.id}/duplicate`, {
            method: 'POST',
            cookie: bobCookie,
            body,
          }),
          ctx({ id: created.id }),
        );
        expect(refused.status).toBe(400);
        expect((await refused.json()).code).toBe('bad_request');
      }
      // Two copies of his own beside the diagram shared with him; nothing from a refusal.
      const bobsTitles = (
        (await (await listDiagrams(request('/api/diagrams', { cookie: bobCookie }))).json()) as {
          title: string;
        }[]
      ).map((d) => d.title);
      expect(bobsTitles.sort()).toEqual(['Arch', 'Arch copy', 'Copia de Arch']);

      const received: unknown[] = [];
      const off = events().subscribe(created.id, (event) => received.push(event));
      const gone = await deleteDiagram(
        request(`/api/diagrams/${created.id}`, { method: 'DELETE', cookie: adaCookie }),
        ctx({ id: created.id }),
      );
      off();
      expect(gone.status).toBe(204);
      expect(received).toEqual([{ type: 'deleted' }]);
      // Ada's diagram is gone; Bob's copies are Bob's and stay.
      expect(
        await (await listDiagrams(request('/api/diagrams', { cookie: adaCookie }))).json(),
      ).toHaveLength(0);
      expect(
        await (await listDiagrams(request('/api/diagrams', { cookie: bobCookie }))).json(),
      ).toHaveLength(2);
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

  describe('members', () => {
    it('keeps a stranger out of every route about the diagram', async () => {
      const created = await create();
      const asBob = (path: string, init: CallOptions = {}) =>
        request(path, { ...init, cookie: bobCookie });
      const responses = await Promise.all([
        getDiagram(asBob(`/api/diagrams/${created.id}`), ctx({ id: created.id })),
        saveDiagram(
          asBob(`/api/diagrams/${created.id}`, {
            method: 'PUT',
            body: { model: modelWithGroups(1) },
          }),
          ctx({ id: created.id }),
        ),
        patchDiagram(
          asBob(`/api/diagrams/${created.id}`, { method: 'PATCH', body: { title: 'x' } }),
          ctx({ id: created.id }),
        ),
        deleteDiagram(
          asBob(`/api/diagrams/${created.id}`, { method: 'DELETE' }),
          ctx({ id: created.id }),
        ),
        listVersions(asBob(`/api/diagrams/${created.id}/versions`), ctx({ id: created.id })),
        duplicateDiagram(
          asBob(`/api/diagrams/${created.id}/duplicate`, { method: 'POST' }),
          ctx({ id: created.id }),
        ),
        openEvents(asBob(`/api/diagrams/${created.id}/events`), ctx({ id: created.id })),
        postPresence(
          asBob(`/api/diagrams/${created.id}/presence`, {
            method: 'POST',
            body: { editing: true },
          }),
          ctx({ id: created.id }),
        ),
        listMembers(asBob(`/api/diagrams/${created.id}/members`), ctx({ id: created.id })),
        putMember(
          asBob(`/api/diagrams/${created.id}/members`, {
            method: 'PUT',
            body: { email: 'bob@example.com', role: 'editor' },
          }),
          ctx({ id: created.id }),
        ),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe('no_access');
      }
      // Nothing changed and nobody is in the room.
      expect(
        await (
          await getDiagram(
            request(`/api/diagrams/${created.id}`, { cookie: adaCookie }),
            ctx({ id: created.id }),
          )
        ).json(),
      ).toEqual(created);
      expect(events().subscriberCount(created.id)).toBe(0);
    });

    it('the owner invites by e-mail, everyone in the room hears it, and a viewer reads but cannot write', async () => {
      const created = await create();
      const received: unknown[] = [];
      const off = events().subscribe(created.id, (event) => received.push(event));
      try {
        const member = await share(created.id, 'viewer', 'BOB@example.com');
        expect(member).toMatchObject({ user: { id: bob.id, name: 'Bob' }, role: 'viewer' });
        expect(received).toEqual([
          { type: 'access', userId: bob.id, role: 'viewer', by: { id: ada.id, name: 'Ada' } },
        ]);

        const members = await listMembers(
          request(`/api/diagrams/${created.id}/members`, { cookie: bobCookie }),
          ctx({ id: created.id }),
        );
        expect(members.status).toBe(200);
        expect(
          (await members.json()).map((m: { user: User; role: string }) => [m.user.id, m.role]),
        ).toEqual([
          [ada.id, 'owner'],
          [bob.id, 'viewer'],
        ]);

        const read = await getDiagram(
          request(`/api/diagrams/${created.id}`, { cookie: bobCookie }),
          ctx({ id: created.id }),
        );
        expect((await read.json()).role).toBe('viewer');

        const write = await saveDiagram(
          request(`/api/diagrams/${created.id}`, {
            method: 'PUT',
            cookie: bobCookie,
            body: { model: modelWithGroups(1) },
          }),
          ctx({ id: created.id }),
        );
        expect(write.status).toBe(403);
        expect(await write.json()).toMatchObject({ code: 'no_access', required: 'editor' });

        // Presence works for a viewer: reading includes being in the room.
        const presence = await postPresence(
          request(`/api/diagrams/${created.id}/presence`, {
            method: 'POST',
            cookie: bobCookie,
            body: { cursor: { x: 1, y: 1 } },
          }),
          ctx({ id: created.id }),
        );
        expect(presence.status).toBe(204);

        // Promoted to editor: the write goes through.
        await share(created.id, 'editor');
        expect(received.at(-1)).toMatchObject({ type: 'access', userId: bob.id, role: 'editor' });
        const promoted = await saveDiagram(
          request(`/api/diagrams/${created.id}`, {
            method: 'PUT',
            cookie: bobCookie,
            body: { model: modelWithGroups(1) },
          }),
          ctx({ id: created.id }),
        );
        expect(promoted.status).toBe(200);
      } finally {
        off();
      }
    });

    it('removal and leaving', async () => {
      const created = await create();
      await share(created.id, 'editor');
      const received: unknown[] = [];
      const off = events().subscribe(created.id, (event) => received.push(event));
      try {
        // Bob leaves on his own.
        const left = await removeMember(
          request(`/api/diagrams/${created.id}/members/${bob.id}`, {
            method: 'DELETE',
            cookie: bobCookie,
          }),
          ctx({ id: created.id, userId: bob.id }),
        );
        expect(left.status).toBe(204);
        expect(received).toEqual([
          { type: 'access', userId: bob.id, role: null, by: { id: bob.id, name: 'Bob' } },
        ]);
        expect(
          (
            await getDiagram(
              request(`/api/diagrams/${created.id}`, { cookie: bobCookie }),
              ctx({ id: created.id }),
            )
          ).status,
        ).toBe(403);

        // The owner removes him after inviting him again; nothing published when nothing changed.
        await share(created.id, 'viewer');
        const removed = await removeMember(
          request(`/api/diagrams/${created.id}/members/${bob.id}`, {
            method: 'DELETE',
            cookie: adaCookie,
          }),
          ctx({ id: created.id, userId: bob.id }),
        );
        expect(removed.status).toBe(204);
        expect(received.at(-1)).toMatchObject({
          type: 'access',
          userId: bob.id,
          role: null,
          by: { id: ada.id },
        });
        const count = received.length;
        const again = await removeMember(
          request(`/api/diagrams/${created.id}/members/${bob.id}`, {
            method: 'DELETE',
            cookie: adaCookie,
          }),
          ctx({ id: created.id, userId: bob.id }),
        );
        expect(again.status).toBe(204);
        expect(received).toHaveLength(count);
      } finally {
        off();
      }
    });

    it('validates who can be touched and how', async () => {
      const created = await create();
      const put = (body: unknown, cookie = adaCookie) =>
        putMember(
          request(`/api/diagrams/${created.id}/members`, { method: 'PUT', cookie, body }),
          ctx({ id: created.id }),
        );
      expect((await put({ email: 'not an e-mail', role: 'viewer' })).status).toBe(400);
      expect((await put({ email: 'bob@example.com', role: 'owner' })).status).toBe(400);
      expect((await put({ email: 'bob@example.com', role: 'viewer', extra: 1 })).status).toBe(400);

      const unknown = await put({ email: 'nobody@example.com', role: 'viewer' });
      expect(unknown.status).toBe(404);
      expect((await unknown.json()).code).toBe('user_not_found');

      const self = await put({ email: 'ada@example.com', role: 'viewer' });
      expect(self.status).toBe(400);
      expect((await self.json()).message).toMatch(/owner/);

      const removeOwner = await removeMember(
        request(`/api/diagrams/${created.id}/members/${ada.id}`, {
          method: 'DELETE',
          cookie: adaCookie,
        }),
        ctx({ id: created.id, userId: ada.id }),
      );
      expect(removeOwner.status).toBe(400);

      // An editor is not an owner: no inviting, no removing others.
      await share(created.id, 'editor');
      expect((await put({ email: 'ada@example.com', role: 'viewer' }, bobCookie)).status).toBe(403);
      const editorRemovesOwner = await removeMember(
        request(`/api/diagrams/${created.id}/members/${ada.id}`, {
          method: 'DELETE',
          cookie: bobCookie,
        }),
        ctx({ id: created.id, userId: ada.id }),
      );
      expect(editorRemovesOwner.status).toBe(403);

      const ghost = await listMembers(
        request('/api/diagrams/ghost/members', { cookie: adaCookie }),
        ctx({ id: 'ghost' }),
      );
      expect(ghost.status).toBe(404);
    });
  });

  describe('icons', () => {
    const vault = {
      key: 'custom-vault-a1b2c',
      name: 'Vault',
      source: 'HashiCorp',
      svg: { viewBox: '0 0 24 24', body: '<path d="M2 2h20v20H2z"/>' },
      createdAt: '2026-09-10T10:00:00.000Z',
    };

    it('is one library for the workspace: what Ada uploads, Bob lists and may remove', async () => {
      const created = await saveIcon(
        request('/api/icons', { method: 'POST', cookie: adaCookie, body: vault }),
      );
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual(vault);

      const seenByBob = await (
        await listIcons(request('/api/icons', { cookie: bobCookie }))
      ).json();
      expect(seenByBob).toEqual([vault]);

      const gone = await deleteIcon(
        request(`/api/icons/${vault.key}`, { method: 'DELETE', cookie: bobCookie }),
        ctx({ key: vault.key }),
      );
      expect(gone.status).toBe(204);
      expect(await (await listIcons(request('/api/icons', { cookie: adaCookie }))).json()).toEqual(
        [],
      );
      const again = await deleteIcon(
        request(`/api/icons/${vault.key}`, { method: 'DELETE', cookie: bobCookie }),
        ctx({ key: vault.key }),
      );
      expect(again.status).toBe(404);
    });

    it('stores the same picture once and answers with the icon that holds it', async () => {
      await saveIcon(request('/api/icons', { method: 'POST', cookie: adaCookie, body: vault }));
      const twin = { ...vault, key: 'custom-secrets-z9y8x', name: 'Secrets', source: undefined };
      const response = await saveIcon(
        request('/api/icons', { method: 'POST', cookie: bobCookie, body: twin }),
      );
      // Not created: the library already had that drawing, under Ada's name for it.
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(vault);
      expect(await (await listIcons(request('/api/icons', { cookie: adaCookie }))).json()).toEqual([
        vault,
      ]);
      // The same key again replaces in place: a renamed icon is still one icon.
      const renamed = await saveIcon(
        request('/api/icons', {
          method: 'POST',
          cookie: adaCookie,
          body: { ...vault, name: 'Vault 2' },
        }),
      );
      expect(renamed.status).toBe(200);
      expect((await renamed.json()).name).toBe('Vault 2');
    });

    it('refuses what is not an icon, and needs a session', async () => {
      const both = await saveIcon(
        request('/api/icons', {
          method: 'POST',
          cookie: adaCookie,
          body: { ...vault, image: 'data:image/png;base64,AAAA' },
        }),
      );
      expect(both.status).toBe(400);
      const neither = await saveIcon(
        request('/api/icons', {
          method: 'POST',
          cookie: adaCookie,
          body: { ...vault, svg: undefined },
        }),
      );
      expect(neither.status).toBe(400);
      const badKey = await saveIcon(
        request('/api/icons', {
          method: 'POST',
          cookie: adaCookie,
          body: { ...vault, key: 'aws-lambda' },
        }),
      );
      expect(badKey.status).toBe(400);
      expect((await listIcons(request('/api/icons'))).status).toBe(401);
    });
  });

  describe('comments', () => {
    const anchor = { shapeId: null, x: 120, y: 80 };
    const threadsOf = async (id: string, cookie: string) =>
      (await listThreads(request(`/api/diagrams/${id}/comments`, { cookie }), ctx({ id }))).json();

    it('lets a viewer open a thread, signed by the session, and everyone in the room reads it', async () => {
      const created = await create();
      await share(created.id, 'viewer');
      const opened = await openThread(
        request(`/api/diagrams/${created.id}/comments`, {
          method: 'POST',
          cookie: bobCookie,
          body: { anchor, body: '  Is this the right region?  ' },
        }),
        ctx({ id: created.id }),
      );
      expect(opened.status).toBe(201);
      const thread = await opened.json();
      expect(thread).toMatchObject({
        diagramId: created.id,
        anchor,
        resolvedAt: null,
        resolvedBy: null,
      });
      expect(thread.comments).toHaveLength(1);
      expect(thread.comments[0]).toMatchObject({
        author: { id: bob.id, name: 'Bob' },
        body: 'Is this the right region?',
      });
      expect(await threadsOf(created.id, adaCookie)).toEqual([thread]);
    });

    it('is answered, resolved, reopened, and deleted by its author or the owner only', async () => {
      const created = await create();
      await share(created.id, 'viewer');
      const thread = await (
        await openThread(
          request(`/api/diagrams/${created.id}/comments`, {
            method: 'POST',
            cookie: bobCookie,
            body: { anchor, body: 'First' },
          }),
          ctx({ id: created.id }),
        )
      ).json();
      const path = `/api/diagrams/${created.id}/comments/${thread.id}`;
      const params = ctx({ id: created.id, threadId: thread.id });

      const replied = await replyThread(
        request(path, { method: 'POST', cookie: adaCookie, body: { body: 'Yes, prod' } }),
        params,
      );
      expect(replied.status).toBe(200);
      expect((await replied.json()).comments.map((c: { body: string }) => c.body)).toEqual([
        'First',
        'Yes, prod',
      ]);

      const resolved = await patchThread(
        request(path, { method: 'PATCH', cookie: bobCookie, body: { resolved: true } }),
        params,
      );
      expect((await resolved.json()).resolvedBy).toEqual({ id: bob.id, name: 'Bob' });
      const reopened = await patchThread(
        request(path, { method: 'PATCH', cookie: adaCookie, body: { resolved: false } }),
        params,
      );
      expect((await reopened.json()).resolvedAt).toBeNull();

      // Ada is the owner, not the author: she may still tidy it away — but
      // first, a third person who is neither may not.
      const carol = await insertUser(pool, 'Carol');
      const carolCookie = (await createSession(carol.id, pool)).id;
      await share(created.id, 'editor', 'carol@example.com');
      const refused = await deleteThread(
        request(path, { method: 'DELETE', cookie: carolCookie }),
        params,
      );
      expect(refused.status).toBe(403);
      expect((await refused.json()).code).toBe('forbidden');
      const gone = await deleteThread(
        request(path, { method: 'DELETE', cookie: adaCookie }),
        params,
      );
      expect(gone.status).toBe(204);
      expect(await threadsOf(created.id, adaCookie)).toEqual([]);
      const again = await deleteThread(
        request(path, { method: 'DELETE', cookie: adaCookie }),
        params,
      );
      expect(again.status).toBe(404);
    });

    it('is refused to a stranger, refuses an empty comment, and goes with the diagram', async () => {
      const created = await create();
      const denied = await openThread(
        request(`/api/diagrams/${created.id}/comments`, {
          method: 'POST',
          cookie: bobCookie,
          body: { anchor, body: 'Hello?' },
        }),
        ctx({ id: created.id }),
      );
      expect(denied.status).toBe(403);
      expect((await denied.json()).code).toBe('no_access');
      const empty = await openThread(
        request(`/api/diagrams/${created.id}/comments`, {
          method: 'POST',
          cookie: adaCookie,
          body: { anchor, body: '   ' },
        }),
        ctx({ id: created.id }),
      );
      expect(empty.status).toBe(400);

      await openThread(
        request(`/api/diagrams/${created.id}/comments`, {
          method: 'POST',
          cookie: adaCookie,
          body: { anchor, body: 'Kept until the diagram goes' },
        }),
        ctx({ id: created.id }),
      );
      await deleteDiagram(
        request(`/api/diagrams/${created.id}`, { method: 'DELETE', cookie: adaCookie }),
        ctx({ id: created.id }),
      );
      const left = await pool.query('select 1 from comment_threads where diagram_id = $1', [
        created.id,
      ]);
      expect(left.rows).toEqual([]);
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
      // Ada keeps her two; Bob's copies are his alone.
      const adas = await (
        await listDiagrams(request('/api/diagrams', { cookie: adaCookie }))
      ).json();
      expect(adas).toHaveLength(2);
      const bobs = await (
        await listDiagrams(request('/api/diagrams', { cookie: bobCookie }))
      ).json();
      expect(bobs).toHaveLength(2);
      expect(bobs.every((d: DiagramRecord) => d.ownerId === bob.id && d.role === 'owner')).toBe(
        true,
      );
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
      await share(created.id, 'editor');
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

      // A comment from Bob reaches Ada's stream too, as an id to fetch by.
      const opened = await openThread(
        request(`/api/diagrams/${created.id}/comments`, {
          method: 'POST',
          cookie: bobCookie,
          body: { anchor: { shapeId: null, x: 1, y: 2 }, body: 'Live?' },
        }),
        ctx({ id: created.id }),
      );
      const commented = await next();
      expect(commented).toContain('event: comment');
      expect(commented).toContain(`"threadId":"${(await opened.json()).id}"`);
      expect(commented).toContain('"action":"created"');
      expect(commented).not.toContain('Live?');
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

  describe('observability', () => {
    it('counts saves, conflicts, transactions and sessions, and logs who did what', async () => {
      const logs = captureLogs();
      try {
        const created = await create();
        await share(created.id, 'editor');
        const saved = await saveDiagram(
          request(`/api/diagrams/${created.id}`, {
            method: 'PUT',
            cookie: adaCookie,
            headers: { 'if-match': created.updatedAt, 'x-request-id': 'save-0001' },
            body: { model: modelWithGroups(2) },
          }),
          ctx({ id: created.id }),
        );
        expect(saved.status).toBe(200);
        expect(saved.headers.get('x-request-id')).toBe('save-0001');

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

        const app = appMetrics();
        expect(app.diagramSaves.get({ operation: 'save', result: 'ok' })).toBe(1);
        expect(app.diagramSaves.get({ operation: 'save', result: 'conflict' })).toBe(1);
        expect(app.httpConflicts.get({ route: '/api/diagrams/[id]' })).toBe(1);
        expect(
          app.httpRequests.get({ route: '/api/diagrams/[id]', method: 'PUT', status: 200 }),
        ).toBe(1);
        expect(
          app.httpRequests.get({ route: '/api/diagrams/[id]', method: 'PUT', status: 412 }),
        ).toBe(1);
        // Creation (diagram + owner row) and the save commit; the stale save rolls back.
        expect(app.dbTransactions.get({ result: 'commit' })).toBe(2);
        expect(app.dbTransactions.get({ result: 'rollback' })).toBe(1);

        const session = await createSession(ada.id, pool);
        expect(app.sessionsCreated.get()).toBe(1);
        const ended = await logout(
          request('/api/auth/logout', { method: 'POST', cookie: session.id }),
        );
        expect([200, 204]).toContain(ended.status);
        expect(app.sessionsEnded.get()).toBe(1);

        const okLine = logs.named('http request').find((line) => line.requestId === 'save-0001');
        expect(okLine).toMatchObject({
          method: 'PUT',
          route: '/api/diagrams/[id]',
          status: 200,
          userId: ada.id,
          diagramId: created.id,
        });
        expect(typeof okLine!.sessionKey).toBe('string');
        const conflictLine = logs
          .named('http request')
          .find((line) => line.status === 412 && line.route === '/api/diagrams/[id]');
        expect(conflictLine).toMatchObject({ userId: bob.id, code: 'conflict' });
        expect(logs.named('stale revision refused')[0]).toMatchObject({
          userId: bob.id,
          diagramId: created.id,
          operation: 'save',
        });

        const scrape = await scrapeMetrics(request('/api/metrics'));
        const text = await scrape.text();
        expect(text).toContain('acgraph_diagram_saves_total{operation="save",result="conflict"} 1');
        expect(text).toContain('acgraph_db_pool_clients{state="total"}');
        expect(text).not.toContain(created.id);
        expect(text).not.toContain(ada.id);
        expect(JSON.stringify(logs.records)).not.toContain(adaCookie);
      } finally {
        logs.restore();
      }
    });
  });

  it('uses the process-wide pool exactly once', () => {
    expect(getPool()).toBe(getPool());
  });
});
