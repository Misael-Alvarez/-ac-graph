import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS, ensureSchema, resetSchemaMemo, runMigrations } from './schema';
import { dropSchema, pgAvailable, testPool } from './testing/pg';

describe.skipIf(!pgAvailable())('schema migrations (PostgreSQL)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await testPool('t_schema');
    await dropSchema(pool);
  });

  afterAll(async () => {
    await dropSchema(pool);
    await pool.end();
  });

  it('applies every migration once and then nothing', async () => {
    expect(await runMigrations(pool)).toBe(MIGRATIONS.length);
    expect(await runMigrations(pool)).toBe(0);
    const rows = await pool.query<{ id: number; name: string }>(
      'select id, name from schema_migrations order by id',
    );
    expect(rows.rows).toEqual(MIGRATIONS.map(({ id, name }) => ({ id, name })));
  });

  it('creates the expected tables with lowercase names', async () => {
    const rows = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = current_schema() order by table_name`,
    );
    expect(rows.rows.map((r) => r.table_name)).toEqual([
      'auth_states',
      'diagram_members',
      'diagram_versions',
      'diagrams',
      'icons',
      'schema_migrations',
      'sessions',
      'users',
    ]);
  });

  it('stores domain timestamps as text and internal ones as timestamptz', async () => {
    const rows = await pool.query<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = current_schema() and column_name in ('created_at', 'updated_at', 'expires_at')
        order by table_name, column_name`,
    );
    const types = Object.fromEntries(
      rows.rows.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type]),
    );
    expect(types['diagrams.created_at']).toBe('text');
    expect(types['diagrams.updated_at']).toBe('text');
    expect(types['diagram_versions.created_at']).toBe('text');
    expect(types['sessions.expires_at']).toBe('timestamp with time zone');
    expect(types['users.created_at']).toBe('timestamp with time zone');
    // The icon carries its own `createdAt` as text inside the JSON; the row's is the server's.
    expect(types['icons.created_at']).toBe('timestamp with time zone');
  });

  it('survives concurrent runners thanks to the advisory lock', async () => {
    await dropSchema(pool);
    const results = await Promise.all([
      runMigrations(pool),
      runMigrations(pool),
      runMigrations(pool),
    ]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(MIGRATIONS.length);
  });

  it('memoises ensureSchema per process and retries after a failure', async () => {
    resetSchemaMemo();
    const first = ensureSchema(pool);
    const second = ensureSchema(pool);
    expect(first).toBe(second);
    await first;

    // A pool that cannot connect makes the run fail; the memo must not keep it.
    resetSchemaMemo();
    const broken = await testPool('t_schema');
    await broken.end();
    await expect(ensureSchema(broken)).rejects.toThrow();
    await expect(ensureSchema(pool)).resolves.toBeUndefined();
    resetSchemaMemo();
  });
});
