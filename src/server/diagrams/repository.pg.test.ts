import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@/lib/domain';
import { addGroup, createEmptyModel } from '@/lib/engine';
import { DiagramConflictError, MAX_VERSIONS_PER_DIAGRAM } from '@/lib/store/localRepository';
import { renderThumbnail } from '@/lib/store/thumbnail';
import { createClock } from '../clock';
import {
  DiagramForbiddenError,
  DiagramNotFoundError,
  MembershipError,
  UserNotFoundError,
  VersionNotFoundError,
} from './errors';
import { PgDiagramRepository } from './repository';
import { dropSchema, freshSchema, insertUser, pgAvailable, testPool } from '../testing/pg';

function modelWithGroups(n: number) {
  const m = createEmptyModel();
  for (let i = 0; i < n; i++) addGroup(m, i * 500, 0);
  return m;
}

describe.skipIf(!pgAvailable())('PgDiagramRepository (PostgreSQL)', () => {
  let pool: Pool;
  let ada: User;
  let bob: User;
  let repo: PgDiagramRepository;
  let asBob: PgDiagramRepository;

  beforeAll(async () => {
    pool = await testPool('t_repository');
    await freshSchema(pool);
    ada = await insertUser(pool, 'Ada');
    bob = await insertUser(pool, 'Bob');
  });

  beforeEach(async () => {
    await pool.query('delete from diagrams');
    const clock = createClock();
    repo = new PgDiagramRepository(ada, pool, clock);
    asBob = new PgDiagramRepository(bob, pool, clock);
  });

  afterAll(async () => {
    await dropSchema(pool);
    await pool.end();
  });

  describe('create / get / list', () => {
    it('round-trips a diagram owned by the actor', async () => {
      const created = await repo.create({ title: 'My arch', model: modelWithGroups(2) });
      expect(created.ownerId).toBe(ada.id);
      const fetched = await repo.get(created.id);
      expect(fetched).toEqual(created);
      expect(fetched?.model.shapes).toHaveLength(6);
    });

    it('starts empty and returns null for an unknown id', async () => {
      expect(await repo.list()).toEqual([]);
      expect(await repo.get('nope')).toBeNull();
    });

    it('lists metadata without the model, newest update first', async () => {
      const a = await repo.create({ title: 'A', model: createEmptyModel() });
      await repo.create({ title: 'B', model: createEmptyModel() });
      await repo.save(a.id, modelWithGroups(1));
      const list = await repo.list();
      expect(list.map((d) => d.title)).toEqual(['A', 'B']);
      expect('model' in list[0]).toBe(false);
    });

    it('is private until shared: another user neither lists nor reads it', async () => {
      const created = await repo.create({ title: 'Private', model: createEmptyModel() });
      expect(created.role).toBe('owner');
      expect(await asBob.list()).toEqual([]);
      await expect(asBob.get(created.id)).rejects.toBeInstanceOf(DiagramForbiddenError);
      await expect(asBob.get(created.id)).rejects.toMatchObject({
        required: 'viewer',
        ownerName: 'Ada',
      });
      expect(await asBob.roleOf(created.id)).toBeNull();
      // Still a 404, not a 403, when the diagram does not exist at all.
      expect(await asBob.get('ghost')).toBeNull();
    });

    it('an invited editor sees and edits it; the list carries each person\u2019s role', async () => {
      const created = await repo.create({ title: 'Shared', model: createEmptyModel() });
      await repo.setMember(created.id, 'bob@example.com', 'editor');
      expect((await asBob.list()).map((d) => [d.id, d.role])).toEqual([[created.id, 'editor']]);
      expect((await repo.list())[0].role).toBe('owner');
      const saved = await asBob.save(created.id, modelWithGroups(1));
      expect(saved.ownerId).toBe(ada.id);
      expect(saved.role).toBe('editor');
      expect(saved.model.shapes).toHaveLength(3);
    });
  });

  describe('roles', () => {
    it('a viewer reads, follows history and copies, but cannot write', async () => {
      const created = await repo.create({ title: 'Read me', model: modelWithGroups(1) });
      await repo.save(created.id, modelWithGroups(2), { snapshot: true });
      await repo.setMember(created.id, 'Bob@Example.com', 'viewer');

      expect((await asBob.get(created.id))?.role).toBe('viewer');
      expect(await asBob.listVersions(created.id)).toHaveLength(1);
      expect((await asBob.duplicate(created.id)).ownerId).toBe(bob.id);

      await expect(asBob.save(created.id, modelWithGroups(3))).rejects.toMatchObject({
        name: 'DiagramForbiddenError',
        required: 'editor',
      });
      await expect(asBob.updateMeta(created.id, { title: 'x' })).rejects.toBeInstanceOf(
        DiagramForbiddenError,
      );
      const [version] = await asBob.listVersions(created.id);
      await expect(asBob.restoreVersion(created.id, version.id)).rejects.toBeInstanceOf(
        DiagramForbiddenError,
      );
      await expect(asBob.delete(created.id)).rejects.toMatchObject({ required: 'owner' });
      expect(await repo.get(created.id)).not.toBeNull();
    });

    it('an editor cannot delete or manage members; only the owner can', async () => {
      const created = await repo.create({ title: 'Team', model: createEmptyModel() });
      await repo.setMember(created.id, 'bob@example.com', 'editor');
      await expect(asBob.delete(created.id)).rejects.toMatchObject({ required: 'owner' });
      await expect(asBob.setMember(created.id, 'ada@example.com', 'viewer')).rejects.toMatchObject({
        required: 'owner',
      });
      await expect(asBob.removeMember(created.id, ada.id)).rejects.toMatchObject({
        required: 'owner',
      });
      await repo.delete(created.id);
      expect(await repo.get(created.id)).toBeNull();
    });

    it('lists members owner first, changes roles in place and refuses touching the owner', async () => {
      const created = await repo.create({ title: 'Team', model: createEmptyModel() });
      const member = await repo.setMember(created.id, 'bob@example.com', 'viewer');
      expect(member).toMatchObject({ user: { id: bob.id, name: 'Bob' }, role: 'viewer' });
      expect(typeof member.addedAt).toBe('string');

      await repo.setMember(created.id, 'bob@example.com', 'editor');
      const members = await repo.listMembers(created.id);
      expect(members.map((m) => [m.user.id, m.role])).toEqual([
        [ada.id, 'owner'],
        [bob.id, 'editor'],
      ]);
      // Any member may see who else is in.
      expect(await asBob.listMembers(created.id)).toEqual(members);

      await expect(repo.setMember(created.id, 'ada@example.com', 'viewer')).rejects.toBeInstanceOf(
        MembershipError,
      );
      await expect(repo.removeMember(created.id, ada.id)).rejects.toBeInstanceOf(MembershipError);
      await expect(
        repo.setMember(created.id, 'nobody@example.com', 'viewer'),
      ).rejects.toBeInstanceOf(UserNotFoundError);
      await expect(repo.listMembers('ghost')).rejects.toBeInstanceOf(DiagramNotFoundError);
    });

    it('the owner removes a member, and a member may leave on their own', async () => {
      const created = await repo.create({ title: 'Team', model: createEmptyModel() });
      await repo.setMember(created.id, 'bob@example.com', 'editor');
      expect(await asBob.removeMember(created.id, bob.id)).toBe(true);
      expect(await asBob.list()).toEqual([]);

      await repo.setMember(created.id, 'bob@example.com', 'viewer');
      expect(await repo.removeMember(created.id, bob.id)).toBe(true);
      await expect(asBob.get(created.id)).rejects.toBeInstanceOf(DiagramForbiddenError);
      // A stranger cannot leave what they were never part of, nor learn whether it exists.
      await expect(asBob.removeMember(created.id, bob.id)).rejects.toBeInstanceOf(
        DiagramForbiddenError,
      );
    });

    it('membership goes with the diagram', async () => {
      const created = await repo.create({ title: 'Gone', model: createEmptyModel() });
      await repo.setMember(created.id, 'bob@example.com', 'viewer');
      await repo.delete(created.id);
      const rows = await pool.query('select 1 from diagram_members where diagram_id = $1', [
        created.id,
      ]);
      expect(rows.rowCount).toBe(0);
    });
  });

  describe('save', () => {
    it('replaces the model, renders the thumbnail and bumps updatedAt', async () => {
      const created = await repo.create({ title: 'A', model: createEmptyModel() });
      const content = modelWithGroups(3);
      const saved = await repo.save(created.id, content);
      expect(saved.model).toEqual(content);
      expect(saved.thumbnail).toBe(renderThumbnail(content));
      expect(saved.updatedAt > created.updatedAt).toBe(true);
      expect(saved.createdAt).toBe(created.createdAt);
      expect(await repo.get(created.id)).toEqual(saved);
    });

    it('rejects an unknown diagram', async () => {
      await expect(repo.save('ghost', createEmptyModel())).rejects.toBeInstanceOf(
        DiagramNotFoundError,
      );
    });

    it('does not snapshot unless asked', async () => {
      const created = await repo.create({ title: 'A', model: createEmptyModel() });
      await repo.save(created.id, modelWithGroups(1));
      expect(await repo.listVersions(created.id)).toHaveLength(0);
    });

    it('commits model, metadata and explicit snapshot together', async () => {
      const created = await repo.create({ title: 'A', model: createEmptyModel() });
      const current = modelWithGroups(2);
      const captured = modelWithGroups(1);
      const saved = await repo.save(created.id, current, {
        metadata: { title: 'Renamed', folder: 'infra' },
        snapshotModel: captured,
        label: 'checkpoint',
        expectedUpdatedAt: created.updatedAt,
      });
      expect(saved.title).toBe('Renamed');
      expect(saved.folder).toBe('infra');
      const versions = await repo.listVersions(created.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].model).toEqual(captured);
      expect(versions[0].label).toBe('checkpoint');
    });

    it('snapshots the previous content when asked', async () => {
      const created = await repo.create({ title: 'A', model: modelWithGroups(1) });
      await repo.save(created.id, modelWithGroups(2), { snapshot: true });
      const [version] = await repo.listVersions(created.id);
      expect(version.model).toEqual(created.model);
      expect(version.createdAt > created.updatedAt).toBe(true);
    });

    it('rejects a stale revision without changing anything', async () => {
      const created = await repo.create({ title: 'A', model: createEmptyModel() });
      const newer = await repo.save(created.id, modelWithGroups(2));
      await expect(
        repo.save(created.id, modelWithGroups(1), {
          snapshot: true,
          expectedUpdatedAt: created.updatedAt,
        }),
      ).rejects.toBeInstanceOf(DiagramConflictError);
      expect(await repo.get(created.id)).toEqual(newer);
      expect(await repo.listVersions(created.id)).toEqual([]);
    });

    it('serialises concurrent writers so no revision is lost', async () => {
      const created = await repo.create({ title: 'A', model: createEmptyModel() });
      await repo.setMember(created.id, 'bob@example.com', 'editor');
      const results = await Promise.allSettled([
        repo.save(created.id, modelWithGroups(1), { expectedUpdatedAt: created.updatedAt }),
        asBob.save(created.id, modelWithGroups(2), { expectedUpdatedAt: created.updatedAt }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DiagramConflictError);
    });

    it('stamps strictly increasing timestamps even across repository instances', async () => {
      const created = await repo.create({ title: 'A', model: createEmptyModel() });
      await repo.setMember(created.id, 'bob@example.com', 'editor');
      const other = new PgDiagramRepository(
        bob,
        pool,
        createClock(() => 0),
      );
      const first = await other.save(created.id, modelWithGroups(1));
      const second = await repo.save(created.id, modelWithGroups(2));
      expect(first.updatedAt > created.updatedAt).toBe(true);
      expect(second.updatedAt > first.updatedAt).toBe(true);
    });
  });

  describe('updateMeta / duplicate / delete', () => {
    it('patches metadata and bumps updatedAt', async () => {
      const created = await repo.create({ title: 'A', model: modelWithGroups(1) });
      const updated = await repo.updateMeta(created.id, {
        title: 'B',
        description: 'desc',
        thumbnail: '<svg/>',
      });
      expect(updated).toMatchObject({ title: 'B', description: 'desc', thumbnail: '<svg/>' });
      expect(updated.model).toEqual(created.model);
      expect(updated.updatedAt > created.updatedAt).toBe(true);
    });

    it('duplicates under a new id owned by the duplicator', async () => {
      const created = await repo.create({ title: 'A', model: modelWithGroups(1), folder: 'f' });
      await repo.setMember(created.id, 'bob@example.com', 'viewer');
      const copy = await asBob.duplicate(created.id);
      expect(copy.id).not.toBe(created.id);
      expect(copy.title).toBe('A copy');
      expect(copy.folder).toBe('f');
      expect(copy.ownerId).toBe(bob.id);
      expect(copy.model).toEqual(created.model);
      await expect(repo.duplicate('ghost')).rejects.toBeInstanceOf(DiagramNotFoundError);
    });

    it('deletes the diagram and its history, and is idempotent', async () => {
      const created = await repo.create({ title: 'A', model: modelWithGroups(1) });
      await repo.save(created.id, modelWithGroups(2), { snapshot: true });
      await repo.delete(created.id);
      expect(await repo.get(created.id)).toBeNull();
      await expect(repo.listVersions(created.id)).rejects.toBeInstanceOf(DiagramNotFoundError);
      const versions = await pool.query('select 1 from diagram_versions where diagram_id = $1', [
        created.id,
      ]);
      expect(versions.rowCount).toBe(0);
      await expect(repo.delete(created.id)).resolves.toBeUndefined();
    });
  });

  describe('versions', () => {
    it('lists newest first and prunes beyond the cap', async () => {
      const created = await repo.create({ title: 'A', model: modelWithGroups(1) });
      for (let i = 0; i < MAX_VERSIONS_PER_DIAGRAM + 5; i++) {
        await repo.save(created.id, modelWithGroups((i % 3) + 1), {
          snapshot: true,
          label: `v${i}`,
        });
      }
      const versions = await repo.listVersions(created.id);
      expect(versions).toHaveLength(MAX_VERSIONS_PER_DIAGRAM);
      expect(versions[0].label).toBe(`v${MAX_VERSIONS_PER_DIAGRAM + 4}`);
      expect(versions.at(-1)?.label).toBe('v5');
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i - 1].createdAt > versions[i].createdAt).toBe(true);
      }
    });

    it('restores a version, keeping the present as "before restore"', async () => {
      const created = await repo.create({ title: 'A', model: modelWithGroups(1) });
      const second = await repo.save(created.id, modelWithGroups(2), { snapshot: true });
      const [snapshot] = await repo.listVersions(created.id);
      const restored = await repo.restoreVersion(created.id, snapshot.id, {
        expectedUpdatedAt: second.updatedAt,
      });
      expect(restored.model).toEqual(created.model);
      expect(restored.thumbnail).toBe(renderThumbnail(created.model));
      expect(restored.updatedAt > second.updatedAt).toBe(true);
      const versions = await repo.listVersions(created.id);
      expect(versions[0].label).toBe('before restore');
      expect(versions[0].model).toEqual(second.model);
    });

    it('refuses a stale restore and an unknown version', async () => {
      const created = await repo.create({ title: 'A', model: modelWithGroups(1) });
      await repo.save(created.id, modelWithGroups(2), { snapshot: true });
      const [snapshot] = await repo.listVersions(created.id);
      await expect(
        repo.restoreVersion(created.id, snapshot.id, { expectedUpdatedAt: created.updatedAt }),
      ).rejects.toBeInstanceOf(DiagramConflictError);
      await expect(repo.restoreVersion(created.id, 'ver_ghost')).rejects.toBeInstanceOf(
        VersionNotFoundError,
      );
      // A version of another diagram cannot be restored into this one.
      const other = await repo.create({ title: 'B', model: modelWithGroups(3) });
      await expect(repo.restoreVersion(other.id, snapshot.id)).rejects.toBeInstanceOf(
        VersionNotFoundError,
      );
    });
  });

  describe('workspace export / import', () => {
    it('round-trips diagrams and versions under new ids, owned by the importer', async () => {
      const a = await repo.create({ title: 'A', model: modelWithGroups(1) });
      await repo.save(a.id, modelWithGroups(2), { snapshot: true, label: 'kept' });
      await repo.create({ title: 'B', model: createEmptyModel() });

      const dump = await repo.exportWorkspace();
      expect(dump.diagrams).toHaveLength(2);
      expect(dump.versions).toHaveLength(1);
      expect(typeof dump.exportedAt).toBe('string');

      await pool.query('delete from diagrams');
      expect(await asBob.importWorkspace(dump)).toBe(2);

      const list = await asBob.list();
      expect(list.map((d) => d.title).sort()).toEqual(['A', 'B']);
      expect(list.every((d) => d.ownerId === bob.id && d.role === 'owner')).toBe(true);
      // The importer's copies are theirs alone until shared.
      expect(await repo.list()).toEqual([]);
      expect(list.map((d) => d.id)).not.toContain(a.id);

      const importedA = list.find((d) => d.title === 'A')!;
      const versions = await asBob.listVersions(importedA.id);
      expect(versions).toHaveLength(1);
      expect(versions[0].label).toBe('kept');
      expect(versions[0].id).not.toBe(dump.versions[0].id);
    });

    it('writes nothing when any record is invalid', async () => {
      const dump = await repo.exportWorkspace();
      const bad = {
        ...dump,
        diagrams: [
          { ...(await repo.create({ title: 'ok', model: createEmptyModel() })), id: 'x' },
          { id: 'broken' },
        ],
      };
      await pool.query('delete from diagrams');
      await expect(repo.importWorkspace(bad as never)).rejects.toThrow();
      expect(await repo.list()).toEqual([]);
    });

    it('skips versions whose diagram is not in the dump', async () => {
      const dump = {
        exportedAt: 'T',
        diagrams: [],
        versions: [
          {
            id: 'ver_x',
            diagramId: 'dgm_missing',
            createdAt: 'T',
            label: null,
            model: createEmptyModel(),
          },
        ],
      };
      expect(await repo.importWorkspace(dump)).toBe(0);
      expect((await pool.query('select count(*)::int as n from diagram_versions')).rows[0].n).toBe(
        0,
      );
    });
  });
});
