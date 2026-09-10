import type { Pool } from 'pg';
import { getPool } from './db';
import { resetSingleton, singleton } from './globals';

/**
 * The database schema, as an ordered list of idempotent migrations.
 *
 * Embedded SQL rather than migration files so the standalone Next.js build has
 * nothing to copy or locate at run time. Each step runs once per database and
 * is recorded in `schema_migrations`; a step that fails rolls the whole run
 * back, so the schema is never half-way between two versions.
 *
 * Domain timestamps (`created_at`, `updated_at` on diagrams and versions) are
 * stored as `text`: the domain compares ISO strings for exact equality when
 * checking `expectedUpdatedAt`, and a round trip through `timestamptz` would
 * reformat them. Server-internal tables use `timestamptz` as usual.
 */
interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'users',
    sql: `
      create table if not exists users (
        id text primary key,
        issuer text not null,
        subject text not null,
        name text not null,
        email text,
        picture text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint users_issuer_subject_key unique (issuer, subject)
      );
    `,
  },
  {
    id: 2,
    name: 'sessions',
    sql: `
      create table if not exists sessions (
        id_hash text primary key,
        user_id text not null references users (id) on delete cascade,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null
      );
      create index if not exists sessions_user_id_idx on sessions (user_id);
      create index if not exists sessions_expires_at_idx on sessions (expires_at);
    `,
  },
  {
    id: 3,
    name: 'auth_states',
    sql: `
      create table if not exists auth_states (
        state text primary key,
        code_verifier text not null,
        nonce text not null,
        next_path text not null,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null
      );
      create index if not exists auth_states_expires_at_idx on auth_states (expires_at);
    `,
  },
  {
    id: 4,
    name: 'diagrams',
    sql: `
      create table if not exists diagrams (
        id text primary key,
        owner_id text not null references users (id),
        title text not null,
        description text not null default '',
        folder text,
        created_at text not null,
        updated_at text not null,
        thumbnail text,
        model jsonb not null
      );
      create index if not exists diagrams_owner_id_idx on diagrams (owner_id);
      create index if not exists diagrams_updated_at_idx on diagrams (updated_at desc);
    `,
  },
  {
    id: 5,
    name: 'diagram_versions',
    sql: `
      create table if not exists diagram_versions (
        id text primary key,
        diagram_id text not null references diagrams (id) on delete cascade,
        created_at text not null,
        label text,
        model jsonb not null
      );
      create index if not exists diagram_versions_diagram_id_created_at_idx
        on diagram_versions (diagram_id, created_at desc);
    `,
  },
];

/** Arbitrary but fixed: every replica must ask for the same advisory lock. */
const SCHEMA_LOCK_KEY = 7_364_281_045;

const SCHEMA_READY_KEY = 'schemaReady';

export async function runMigrations(pool: Pool): Promise<number> {
  const client = await pool.connect();
  let applied = 0;
  try {
    await client.query('begin');
    // Several replicas may boot at once; only one of them runs the DDL.
    await client.query('select pg_advisory_xact_lock($1::bigint)', [SCHEMA_LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        id integer primary key,
        name text not null,
        applied_at timestamptz not null default now()
      )
    `);
    const done = await client.query<{ id: number }>('select id from schema_migrations');
    const doneIds = new Set(done.rows.map((row) => row.id));
    for (const migration of MIGRATIONS) {
      if (doneIds.has(migration.id)) continue;
      await client.query(migration.sql);
      await client.query('insert into schema_migrations (id, name) values ($1, $2)', [
        migration.id,
        migration.name,
      ]);
      applied++;
    }
    await client.query('commit');
    return applied;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Brings the schema up to date, once per process.
 *
 * The promise is memoised so concurrent first requests share one run. A failed
 * run is forgotten, so the next request retries instead of being stuck behind a
 * rejected promise for the life of the process.
 */
export function ensureSchema(pool?: Pool): Promise<void> {
  return singleton(SCHEMA_READY_KEY, () =>
    runMigrations(pool ?? getPool())
      .then(() => undefined)
      .catch((error: unknown) => {
        resetSingleton(SCHEMA_READY_KEY);
        throw error;
      }),
  );
}

/** Forgets the memoised run. Tests only. */
export function resetSchemaMemo(): void {
  resetSingleton(SCHEMA_READY_KEY);
}
