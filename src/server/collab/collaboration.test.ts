import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSingleton } from '../globals';
import { appMetrics } from '../observability/metrics';
import { captureLogs, type LogCapture } from '../testing/logs';
import { MemoryBus, type BusMessage } from './bus';
import { Collaboration, closeCollaboration, collaboration } from './collaboration';
import { EventHub, type DiagramEvent } from './events';
import { PresenceRegistry } from './presence';

const ada = { id: 'usr_ada', name: 'Ada', email: 'ada@example.com' };
const bob = { id: 'usr_bob', name: 'Bob' };

/**
 * Two replicas in one process: each has its own hub and registry, both share
 * the bus. What a viewer on A does must show up for a viewer on B, and A must
 * not be told twice about what it did itself.
 */
function replica(name: string, bus: MemoryBus, now: () => number = Date.now) {
  const hub = new EventHub();
  const registry = new PresenceRegistry(15_000, now);
  const room = new Collaboration({ origin: name, hub, registry, bus });
  room.start();
  const received: DiagramEvent[] = [];
  hub.subscribe('dgm_1', (event) => received.push(event));
  return { room, hub, registry, received };
}

const rosterIds = (event: DiagramEvent | undefined) =>
  event?.type === 'presence' ? event.users.map((u) => `${u.id}@${u.sessionKey}`) : null;

let logs: LogCapture;

beforeEach(() => {
  logs = captureLogs();
});

afterEach(async () => {
  logs.restore();
  await closeCollaboration();
  vi.unstubAllEnvs();
});

describe('Collaboration across two replicas', () => {
  it('relays saves, title changes and deletions once to each replica', async () => {
    const bus = new MemoryBus();
    const a = replica('A', bus);
    const b = replica('B', bus);

    a.room.publish('dgm_1', { type: 'saved', updatedAt: 'T1', by: ada });
    a.room.publish('dgm_1', { type: 'meta', title: 'Renamed' });
    b.room.publish('dgm_1', { type: 'deleted' });

    expect(a.received).toEqual([
      { type: 'saved', updatedAt: 'T1', by: ada },
      { type: 'meta', title: 'Renamed' },
      { type: 'deleted' },
    ]);
    expect(b.received).toEqual(a.received);
  });

  it('merges the roster: each replica sees its own viewers and the other\u2019s', () => {
    const bus = new MemoryBus();
    const a = replica('A', bus);
    const b = replica('B', bus);

    a.room.touch('dgm_1', 'sess_a', ada, {}, { announce: true });
    expect(rosterIds(a.received.at(-1))).toEqual(['usr_ada@sess_a']);
    expect(rosterIds(b.received.at(-1))).toEqual(['usr_ada@sess_a']);

    b.room.touch(
      'dgm_1',
      'sess_b',
      bob,
      { cursor: { x: 3, y: 4 }, editing: true },
      { announce: true },
    );
    expect(rosterIds(a.received.at(-1))).toEqual(['usr_ada@sess_a', 'usr_bob@sess_b']);
    expect(rosterIds(b.received.at(-1))).toEqual(['usr_ada@sess_a', 'usr_bob@sess_b']);
    expect(a.room.roster('dgm_1')[1]).toMatchObject({
      id: 'usr_bob',
      name: 'Bob',
      cursor: { x: 3, y: 4 },
      editing: true,
    });
    // The remote copy carries only what the roster needs.
    expect(b.registry.peek('dgm_1', 'sess_a')?.user).toEqual({ id: 'usr_ada', name: 'Ada' });
  });

  it('a heartbeat refreshes the remote TTL without announcing anything', () => {
    let clock = 1_000_000;
    const now = () => clock;
    const bus = new MemoryBus();
    const a = replica('A', bus, now);
    const b = replica('B', bus, now);

    a.room.touch('dgm_1', 'sess_a', ada, {}, { announce: true });
    const announcedBefore = b.received.length;

    clock += 10_000;
    a.room.touch('dgm_1', 'sess_a', ada); // heartbeat
    expect(b.received).toHaveLength(announcedBefore);
    expect(b.registry.peek('dgm_1', 'sess_a')?.lastSeen).toBe(clock);

    clock += 10_000; // 20 s after the join, 10 s after the heartbeat: still here
    expect(b.room.roster('dgm_1')).toHaveLength(1);
    clock += 6_000; // 16 s after the heartbeat: gone everywhere, no message needed
    expect(b.room.roster('dgm_1')).toEqual([]);
    expect(a.room.roster('dgm_1')).toEqual([]);
  });

  it('announces a remote cursor move or editing change, and a remote leave', () => {
    const bus = new MemoryBus();
    const a = replica('A', bus);
    const b = replica('B', bus);
    a.room.touch('dgm_1', 'sess_a', ada, {}, { announce: true });
    const before = b.received.length;

    a.room.touch('dgm_1', 'sess_a', ada, { cursor: { x: 1, y: 1 } });
    expect(b.received).toHaveLength(before + 1);
    expect((b.received.at(-1) as { users: { cursor: unknown }[] }).users[0].cursor).toEqual({
      x: 1,
      y: 1,
    });

    a.room.touch('dgm_1', 'sess_a', ada, { cursor: { x: 1, y: 1 } }); // same state
    expect(b.received).toHaveLength(before + 1);

    a.room.touch('dgm_1', 'sess_a', ada, { editing: true });
    expect(b.received).toHaveLength(before + 2);

    expect(a.room.leave('dgm_1', 'sess_a')).toBe(true);
    expect(rosterIds(b.received.at(-1))).toEqual([]);
    expect(b.registry.peek('dgm_1', 'sess_a')).toBeUndefined();
    // Leaving twice is harmless and silent on both sides.
    const after = b.received.length;
    expect(a.room.leave('dgm_1', 'sess_a')).toBe(false);
    expect(b.received).toHaveLength(after);
  });

  it('ignores its own messages coming back from the bus', () => {
    const bus = new MemoryBus();
    const a = replica('A', bus);
    let deliveries = 0;
    bus.subscribe(() => deliveries++);

    a.room.publish('dgm_1', { type: 'saved', updatedAt: 'T1', by: ada });
    a.room.touch('dgm_1', 'sess_a', ada, {}, { announce: true });
    expect(deliveries).toBe(2);
    expect(a.received).toEqual([
      { type: 'saved', updatedAt: 'T1', by: ada },
      expect.objectContaining({ type: 'presence' }),
    ]);
    const bus_ = appMetrics().busMessages;
    expect(bus_.get({ direction: 'echo', kind: 'event' })).toBe(1);
    expect(bus_.get({ direction: 'echo', kind: 'touch' })).toBe(1);
    expect(bus_.get({ direction: 'received', kind: 'event' })).toBe(0);
  });

  it('counts what it applies from other replicas as received', () => {
    const bus = new MemoryBus();
    const a = replica('A', bus);
    replica('B', bus);
    a.room.publish('dgm_1', { type: 'deleted' });
    expect(appMetrics().busMessages.get({ direction: 'received', kind: 'event' })).toBe(1);
    expect(appMetrics().busMessages.get({ direction: 'echo', kind: 'event' })).toBe(1);
    expect(appMetrics().busMessages.get({ direction: 'sent', kind: 'event' })).toBe(1);
  });

  it('applies a touch from a replica it never heard of before, e.g. after a missed message', () => {
    const bus = new MemoryBus();
    const b = replica('B', bus);
    const late: BusMessage = {
      v: 1,
      origin: 'A',
      diagramId: 'dgm_1',
      kind: 'touch',
      sessionKey: 'sess_a',
      user: { id: 'usr_ada', name: 'Ada' },
      cursor: null,
      editing: false,
    };
    void bus.publish(late);
    expect(rosterIds(b.received.at(-1))).toEqual(['usr_ada@sess_a']);
  });

  it('stops applying after close()', async () => {
    const bus = new MemoryBus();
    const a = replica('A', bus);
    const b = replica('B', bus);
    await b.room.close();
    a.room.publish('dgm_1', { type: 'deleted' });
    expect(b.received).toEqual([]);
  });
});

describe('collaboration() singleton', () => {
  it('is one per process, in memory outside server mode', () => {
    vi.stubEnv('DATABASE_URL', '');
    resetSingleton('collaboration');
    const first = collaboration();
    expect(collaboration()).toBe(first);
    first.publish('dgm_x', { type: 'deleted' });
    // Nothing left the process and nothing failed.
    expect(logs.records.filter((r) => r.level === 'warn')).toEqual([]);
  });
});
