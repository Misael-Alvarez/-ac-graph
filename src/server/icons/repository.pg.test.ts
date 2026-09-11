import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomIcon, User } from '@/lib/domain';
import { IconLibraryFullError } from './errors';
import { MAX_WORKSPACE_ICONS, PgIconLibrary, contentHashOf } from './repository';
import { dropSchema, freshSchema, insertUser, pgAvailable, testPool } from '../testing/pg';

function icon(key: string, body = `<path d="M0 0h${key.length}"/>`): CustomIcon {
  return {
    key: `custom-${key}`,
    name: key,
    svg: { viewBox: '0 0 24 24', body },
    createdAt: '2026-09-10T10:00:00.000Z',
  };
}

describe.skipIf(!pgAvailable())('PgIconLibrary (PostgreSQL)', () => {
  let pool: Pool;
  let ada: User;
  let bob: User;
  let asAda: PgIconLibrary;
  let asBob: PgIconLibrary;

  beforeAll(async () => {
    pool = await testPool('t_icons');
    await freshSchema(pool);
    ada = await insertUser(pool, 'Ada');
    bob = await insertUser(pool, 'Bob');
  });

  beforeEach(async () => {
    await pool.query('delete from icons');
    asAda = new PgIconLibrary(ada, pool);
    asBob = new PgIconLibrary(bob, pool);
  });

  afterAll(async () => {
    await dropSchema(pool);
    await pool.end();
  });

  it('is shared: what one person adds, everyone lists, newest first', async () => {
    await asAda.save(icon('first'));
    await asBob.save(icon('second'));
    expect((await asAda.list()).map((i) => i.key)).toEqual(['custom-second', 'custom-first']);
    expect(await asBob.list()).toEqual(await asAda.list());
    expect(
      (await pool.query('select created_by from icons order by created_at')).rows.map(
        (r) => r.created_by,
      ),
    ).toEqual([ada.id, bob.id]);
  });

  it('stores one picture once, whatever it is called, and replaces by key', async () => {
    const original = icon('vault', '<path d="M2 2h20"/>');
    expect(await asAda.save(original)).toEqual({ icon: original, created: true });

    const twin = { ...icon('secrets', '<path d="M2 2h20"/>'), name: 'Secrets' };
    expect(await asBob.save(twin)).toEqual({ icon: original, created: false });
    expect(await asAda.list()).toEqual([original]);

    const renamed = { ...original, name: 'Vault (prod)' };
    expect(await asAda.save(renamed)).toEqual({ icon: renamed, created: false });
    expect((await asAda.list())[0].name).toBe('Vault (prod)');
    // A new drawing under the old key is a change of picture, and its hash follows.
    const redrawn = { ...original, svg: { viewBox: '0 0 24 24', body: '<circle r="9"/>' } };
    await asAda.save(redrawn);
    expect((await pool.query('select content_hash from icons')).rows[0].content_hash).toBe(
      contentHashOf(redrawn),
    );
  });

  it('hashes the picture, not the words around it', () => {
    const a = icon('a', '<path d="M1 1"/>');
    expect(contentHashOf({ ...a, name: 'other', source: 'x' })).toBe(contentHashOf(a));
    expect(contentHashOf(icon('b', '<path d="M1 2"/>'))).not.toBe(contentHashOf(a));
    const raster = { ...a, svg: undefined, image: 'data:image/png;base64,AAAA' };
    expect(contentHashOf(raster)).not.toBe(contentHashOf(a));
  });

  it('refuses the icon that would not fit, and says how full it is', async () => {
    // Fill the library to the count; the bytes stay small.
    await pool.query(
      `insert into icons (key, icon, content_hash, created_by)
         select 'custom-fill-' || n, jsonb_build_object('key', 'custom-fill-' || n, 'name', 'f', 'createdAt', 'x'),
                'hash-' || n, $1
           from generate_series(1, $2) as n`,
      [ada.id, MAX_WORKSPACE_ICONS],
    );
    await expect(asBob.save(icon('one-too-many'))).rejects.toBeInstanceOf(IconLibraryFullError);
    try {
      await asBob.save(icon('one-too-many'));
    } catch (thrown) {
      expect(thrown).toMatchObject({ count: MAX_WORKSPACE_ICONS });
    }
    // Replacing an icon already there needs no room.
    const kept = icon('fill-1');
    expect((await asAda.save(kept)).icon).toEqual(kept);
  });

  it('forgets an icon, and says whether there was one', async () => {
    await asAda.save(icon('gone'));
    expect(await asBob.remove('custom-gone')).toBe(true);
    expect(await asBob.remove('custom-gone')).toBe(false);
    expect(await asAda.list()).toEqual([]);
  });
});
