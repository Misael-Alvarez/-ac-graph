import { describe, expect, it, vi } from 'vitest';
import { createEmptyModel } from '@/lib/engine';
import type { DiagramRecord, DiagramVersion } from '@/lib/domain';
import { DiagramConflictError } from './localRepository';
import {
  HttpDiagramRepository,
  HttpRepositoryError,
  NoAccessError,
  REQUESTED_WITH_HEADER,
  REQUESTED_WITH_VALUE,
  RemoteConflictError,
  UnauthenticatedError,
} from './httpRepository';

const record: DiagramRecord = {
  id: 'dgm_1',
  ownerId: 'usr_ada',
  title: 'Arch',
  description: '',
  folder: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
  thumbnail: null,
  model: createEmptyModel(),
};

const version: DiagramVersion = {
  id: 'ver_1',
  diagramId: 'dgm_1',
  createdAt: '2026-01-01T00:00:00.500Z',
  label: null,
  model: createEmptyModel(),
};

type Call = { url: string; init: RequestInit };

function fakeFetch(responder: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const headerOf = (call: Call, name: string) => new Headers(call.init.headers).get(name);

describe('HttpDiagramRepository', () => {
  it('lists with credentials and no cache, without the mutation marker', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ok([record]));
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });
    const list = await repo.list();
    expect(list[0].id).toBe('dgm_1');
    expect(calls[0].url).toBe('/api/diagrams');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.credentials).toBe('same-origin');
    expect(calls[0].init.cache).toBe('no-store');
    expect(headerOf(calls[0], REQUESTED_WITH_HEADER)).toBeNull();
  });

  it('parses records on read and returns null for a 404', async () => {
    const { fetchImpl } = fakeFetch((call) =>
      call.url.endsWith('/dgm_1') ? ok(record) : ok({ code: 'not_found', message: 'nope' }, 404),
    );
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });
    expect(await repo.get('dgm_1')).toEqual(record);
    expect(await repo.get('ghost')).toBeNull();
  });

  it('creates with the same-origin marker and a JSON body', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ok(record, 201));
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });
    const input = { title: 'Arch', model: createEmptyModel() };
    await repo.create(input);
    expect(calls[0].init.method).toBe('POST');
    expect(headerOf(calls[0], REQUESTED_WITH_HEADER)).toBe(REQUESTED_WITH_VALUE);
    expect(headerOf(calls[0], 'content-type')).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual(input);
  });

  it('sends expectedUpdatedAt as If-Match and the rest of the options in the body', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ok(record));
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });
    const model = createEmptyModel();
    await repo.save('dgm_1', model, {
      snapshot: true,
      label: 'before',
      metadata: { title: 'Renamed' },
      expectedUpdatedAt: record.updatedAt,
    });
    expect(calls[0].url).toBe('/api/diagrams/dgm_1');
    expect(calls[0].init.method).toBe('PUT');
    expect(headerOf(calls[0], 'if-match')).toBe(record.updatedAt);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      model,
      options: { snapshot: true, label: 'before', metadata: { title: 'Renamed' } },
    });
  });

  it('omits If-Match when there is no expected revision', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ok(record));
    await new HttpDiagramRepository({ fetch: fetchImpl }).save('dgm_1', createEmptyModel());
    expect(headerOf(calls[0], 'if-match')).toBeNull();
  });

  it('turns a 412 into the DiagramConflictError the editor already handles', async () => {
    const { fetchImpl } = fakeFetch(() =>
      ok({ code: 'conflict', message: 'stale', current: record }, 412),
    );
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });
    const failure = await repo
      .save('dgm_1', createEmptyModel(), { expectedUpdatedAt: 'old' })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(DiagramConflictError);
    expect(failure).toBeInstanceOf(RemoteConflictError);
    expect((failure as RemoteConflictError).current).toEqual(record);
    expect((failure as Error).message).toMatch(/another editor/);
  });

  it('turns a 401 into UnauthenticatedError', async () => {
    const { fetchImpl } = fakeFetch(() => ok({ code: 'unauthenticated', message: 'Sign in' }, 401));
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });
    await expect(repo.list()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('reports other failures with the server code, even without a JSON body', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('gateway', { status: 502 }));
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });
    const failure = await repo.list().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(HttpRepositoryError);
    expect((failure as HttpRepositoryError).status).toBe(502);
    expect((failure as HttpRepositoryError).code).toBe('error');
  });

  it('restores with If-Match and no body', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ok(record));
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });
    await repo.restoreVersion('dgm_1', 'ver_1', { expectedUpdatedAt: record.updatedAt });
    expect(calls[0].url).toBe('/api/diagrams/dgm_1/versions/ver_1/restore');
    expect(calls[0].init.method).toBe('POST');
    expect(headerOf(calls[0], 'if-match')).toBe(record.updatedAt);
    expect(calls[0].init.body).toBeUndefined();
  });

  it('covers the remaining endpoints', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.init.method === 'DELETE') return new Response(null, { status: 204 });
      if (call.url.endsWith('/versions')) return ok([version]);
      if (call.url.endsWith('/duplicate')) return ok({ ...record, id: 'dgm_2' }, 201);
      if (call.url.endsWith('/export')) return ok({ exportedAt: 'T', diagrams: [], versions: [] });
      if (call.url.endsWith('/import')) return ok({ imported: 3 });
      return ok(record);
    });
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });

    expect((await repo.updateMeta('dgm_1', { title: 'X' })).id).toBe('dgm_1');
    expect(calls.at(-1)?.init.method).toBe('PATCH');

    expect((await repo.duplicate('dgm_1')).id).toBe('dgm_2');
    await expect(repo.delete('dgm_1')).resolves.toBeUndefined();
    expect(await repo.listVersions('dgm_1')).toEqual([version]);
    expect(await repo.exportWorkspace()).toEqual({ exportedAt: 'T', diagrams: [], versions: [] });
    expect(await repo.importWorkspace({ exportedAt: 'T', diagrams: [], versions: [] })).toBe(3);
  });

  it('encodes ids into the path', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ok(record));
    await new HttpDiagramRepository({ fetch: fetchImpl, baseUrl: 'https://x.example' }).get('a/b');
    expect(calls[0].url).toBe('https://x.example/api/diagrams/a%2Fb');
  });

  it('turns a 403 no_access into NoAccessError with whom to ask', async () => {
    const { fetchImpl } = fakeFetch(() =>
      ok({ code: 'no_access', message: 'nope', required: 'editor', owner: { name: 'Ada' } }, 403),
    );
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });
    const thrown = await repo.get('dgm_1').catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(NoAccessError);
    expect(thrown).toBeInstanceOf(HttpRepositoryError);
    expect(thrown).toMatchObject({
      status: 403,
      code: 'no_access',
      required: 'editor',
      ownerName: 'Ada',
    });

    // A CSRF 403 is a different failure and stays a plain HttpRepositoryError.
    const csrf = fakeFetch(() => ok({ code: 'forbidden', message: 'Missing marker' }, 403));
    const other = await new HttpDiagramRepository({ fetch: csrf.fetchImpl })
      .delete('dgm_1')
      .catch((e: unknown) => e);
    expect(other).not.toBeInstanceOf(NoAccessError);
    expect(other).toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('reads and edits the members of a diagram', async () => {
    const member = {
      user: { id: 'usr_bob', name: 'Bob', email: 'bob@example.com' },
      role: 'viewer',
      addedAt: '2026-01-02T00:00:00.000Z',
    };
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.init.method === 'GET'
        ? ok([member])
        : call.init.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : ok(member),
    );
    const repo = new HttpDiagramRepository({ fetch: fetchImpl });

    expect(await repo.listMembers('dgm_1')).toEqual([member]);
    expect(calls[0].url).toBe('/api/diagrams/dgm_1/members');

    expect(await repo.setMember('dgm_1', 'bob@example.com', 'viewer')).toEqual(member);
    expect(calls[1].init.method).toBe('PUT');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      email: 'bob@example.com',
      role: 'viewer',
    });
    expect(headerOf(calls[1], REQUESTED_WITH_HEADER)).toBe(REQUESTED_WITH_VALUE);

    await repo.setMemberRole('dgm_1', 'usr_bob', 'editor');
    expect(calls[2].url).toBe('/api/diagrams/dgm_1/members/usr_bob');
    expect(calls[2].init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ role: 'editor' });

    await repo.removeMember('dgm_1', 'usr_bob');
    expect(calls[3].url).toBe('/api/diagrams/dgm_1/members/usr_bob');
    expect(calls[3].init.method).toBe('DELETE');
  });
});
