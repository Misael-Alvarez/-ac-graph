import { Pool } from 'pg';
import type { User } from '@/lib/domain';
import { uid } from '@/lib/engine';
import { poolConfig } from '../db';
import { resetSingleton } from '../globals';
import { MIGRATIONS, runMigrations } from '../schema';

/**
 * Shared plumbing for the PostgreSQL integration tests (`*.pg.test.ts`).
 *
 * They run only when `TEST_DATABASE_URL` points at a disposable database and
 * skip cleanly otherwise, so `npm test` stays green on a laptop without Docker.
 *
 * Vitest runs test files in parallel, so each file works in its own Postgres
 * schema (`search_path`) and can drop and recreate its tables freely.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export function pgAvailable(): boolean {
  return Boolean(TEST_DATABASE_URL);
}

/** The test database URL, pinned to one schema through the `options` parameter. */
export function schemaUrl(schema: string): string {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.href;
}

/** Environment that turns server mode on for the modules that read `process.env`. */
export function testEnv(schema: string) {
  return {
    DATABASE_URL: schemaUrl(schema),
    OIDC_ISSUER: 'https://auth.invalid/application/o/ac-graph/',
    OIDC_CLIENT_ID: 'ac-graph',
    APP_URL: 'https://graph.example.com',
    SESSION_TTL_HOURS: '12',
  } as const;
}

export async function testPool(schema: string): Promise<Pool> {
  const admin = new Pool(poolConfig(TEST_DATABASE_URL!, 1));
  try {
    await admin.query(`create schema if not exists ${schema}`);
  } finally {
    await admin.end();
  }
  const pool = new Pool(poolConfig(schemaUrl(schema), 4));
  pool.on('error', () => {});
  return pool;
}

/** Drops every table the migrations create, so each file starts from nothing. */
export async function dropSchema(pool: Pool): Promise<void> {
  const tables = ['diagram_versions', 'diagrams', 'auth_states', 'sessions', 'users'];
  for (const table of tables) await pool.query(`drop table if exists ${table} cascade`);
  await pool.query('drop table if exists schema_migrations');
}

export async function freshSchema(pool: Pool): Promise<void> {
  await dropSchema(pool);
  const applied = await runMigrations(pool);
  if (applied !== MIGRATIONS.length) {
    throw new Error(`Expected ${MIGRATIONS.length} migrations, applied ${applied}`);
  }
}

/** Forgets every process-wide singleton so a test file sees a clean server. */
export function resetServerSingletons(): void {
  for (const key of [
    'pgPool',
    'schemaReady',
    'clock',
    'presence',
    'events',
    'oidcConfig',
    'metrics',
    'appMetrics',
    'logger',
  ]) {
    resetSingleton(key);
  }
}

export async function insertUser(pool: Pool, name: string, subject = uid('sub')): Promise<User> {
  const id = uid('usr');
  await pool.query(
    'insert into users (id, issuer, subject, name, email) values ($1, $2, $3, $4, $5)',
    [
      id,
      'https://auth.invalid/application/o/ac-graph/',
      subject,
      name,
      `${name.toLowerCase()}@example.com`,
    ],
  );
  return { id, name, email: `${name.toLowerCase()}@example.com` };
}
