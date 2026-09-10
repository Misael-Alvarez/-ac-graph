import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { serverEnv } from './env';
import { peekSingleton, resetSingleton, singleton } from './globals';

/** Long enough for a workspace import, short enough to stop a runaway query. */
export const STATEMENT_TIMEOUT_MS = 15_000;

const POOL_KEY = 'pgPool';

export function poolConfig(connectionString: string, max: number): PoolConfig {
  return {
    connectionString,
    max,
    // Per-connection settings, so no query can hold a lock or a client forever.
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // The connection string decides on TLS; nothing here overrides it.
    application_name: 'ac-graph',
  };
}

/**
 * The process-wide pool.
 *
 * Created on first use, never on import: a build or a local-mode deployment
 * must be able to load these modules without a database anywhere near them.
 */
export function getPool(): Pool {
  return singleton(POOL_KEY, () => {
    const env = serverEnv();
    const pool = new Pool(poolConfig(env.databaseUrl, env.pgPoolMax));
    // An idle client dropped by the server must not crash the process.
    pool.on('error', (thrown) => {
      console.error('[db] idle client error:', thrown.message);
    });
    return pool;
  });
}

/** Runs `work` in one transaction; commits on success, rolls back on any throw. */
export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  pool: Pool = getPool(),
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Closes and forgets the pool. Tests and graceful shutdown only. */
export async function closePool(): Promise<void> {
  const pool = peekSingleton<Pool>(POOL_KEY);
  resetSingleton(POOL_KEY);
  await pool?.end();
}
