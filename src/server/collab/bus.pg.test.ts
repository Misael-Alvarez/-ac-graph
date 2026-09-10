import { Client, Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { poolConfig } from '../db';
import { captureLogs, type LogCapture } from '../testing/logs';
import { TEST_DATABASE_URL, pgAvailable } from '../testing/pg';
import { PgBus, type BusMessage } from './bus';
import { Collaboration } from './collaboration';
import { EventHub, type DiagramEvent } from './events';
import { PresenceRegistry } from './presence';

/**
 * Two real `LISTEN` connections on one database — what two replicas have.
 * `NOTIFY` channels are database-wide, so this file uses a channel of its own.
 */
const CHANNEL = 't_bus_channel';

function realBus(pool: Pool): PgBus {
  return new PgBus({
    connect: async () => {
      const client = new Client({ connectionString: TEST_DATABASE_URL, keepAlive: true });
      await client.connect();
      return client;
    },
    notify: async (channel, payload) => {
      await pool.query('select pg_notify($1, $2)', [channel, payload]);
    },
    channel: CHANNEL,
    backoffMs: [50],
  });
}

function waitFor<T>(read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const value = read();
      if (value !== undefined) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe.skipIf(!pgAvailable())('PgBus over PostgreSQL', () => {
  let pool: Pool;
  let logs: LogCapture;
  const open: PgBus[] = [];

  beforeAll(() => {
    pool = new Pool(poolConfig(TEST_DATABASE_URL!, 2));
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((bus) => bus.close()));
    logs?.restore();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('delivers a notification from one connection to every listener, sender included', async () => {
    logs = captureLogs();
    const a = realBus(pool);
    const b = realBus(pool);
    open.push(a, b);
    const seenByA: BusMessage[] = [];
    const seenByB: BusMessage[] = [];
    a.subscribe((m) => seenByA.push(m));
    b.subscribe((m) => seenByB.push(m));
    await Promise.all([a.start(), b.start()]);
    expect(a.connected && b.connected).toBe(true);

    const message: BusMessage = {
      v: 1,
      origin: 'A',
      diagramId: 'dgm_bus',
      kind: 'touch',
      sessionKey: 'sess_1',
      user: { id: 'usr_1', name: 'Ünïcödé ✓' },
      cursor: { x: 1.5, y: -2 },
      editing: true,
    };
    await a.publish(message);
    expect(await waitFor(() => seenByB[0])).toEqual(message);
    expect(await waitFor(() => seenByA[0])).toEqual(message);
  });

  it('carries the live layer between two replicas', async () => {
    logs = captureLogs();
    const busA = realBus(pool);
    const busB = realBus(pool);
    open.push(busA, busB);
    await Promise.all([busA.start(), busB.start()]);

    const hubB = new EventHub();
    const seenOnB: DiagramEvent[] = [];
    hubB.subscribe('dgm_bus', (event) => seenOnB.push(event));
    const a = new Collaboration({
      origin: 'A',
      hub: new EventHub(),
      registry: new PresenceRegistry(),
      bus: busA,
    });
    const b = new Collaboration({
      origin: 'B',
      hub: hubB,
      registry: new PresenceRegistry(),
      bus: busB,
    });
    a.start();
    b.start();

    a.touch('dgm_bus', 'sess_a', { id: 'usr_ada', name: 'Ada' }, {}, { announce: true });
    a.publish('dgm_bus', { type: 'saved', updatedAt: 'T9', by: { id: 'usr_ada', name: 'Ada' } });

    const saved = await waitFor(() => seenOnB.find((event) => event.type === 'saved'));
    expect(saved).toMatchObject({ updatedAt: 'T9' });
    const roster = await waitFor(() =>
      b.roster('dgm_bus').length ? b.roster('dgm_bus') : undefined,
    );
    expect(roster).toEqual([expect.objectContaining({ id: 'usr_ada', sessionKey: 'sess_a' })]);

    a.leave('dgm_bus', 'sess_a');
    await waitFor(() => (b.roster('dgm_bus').length === 0 ? true : undefined));
    expect(logs.records.filter((r) => r.level === 'warn')).toEqual([]);
  });

  it('comes back after the server drops the listening connection', async () => {
    logs = captureLogs();
    const bus = realBus(pool);
    open.push(bus);
    const seen: BusMessage[] = [];
    bus.subscribe((m) => seen.push(m));
    await bus.start();

    await pool.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where pid <> pg_backend_pid() and query ilike 'listen ${CHANNEL}%'`,
    );
    await waitFor(() => (bus.connected ? undefined : true));
    await waitFor(() => (bus.connected ? true : undefined));
    expect(logs.named('bus disconnected')).toHaveLength(1);

    const message: BusMessage = {
      v: 1,
      origin: 'X',
      diagramId: 'dgm_bus',
      kind: 'leave',
      sessionKey: 's',
    };
    await bus.publish(message);
    expect(await waitFor(() => seen.find((m) => m.kind === 'leave'))).toEqual(message);
  });
});
