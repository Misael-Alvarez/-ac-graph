import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appMetrics } from '../observability/metrics';
import { captureLogs, type LogCapture } from '../testing/logs';
import {
  BUS_CHANNEL,
  MAX_PAYLOAD_BYTES,
  MemoryBus,
  PgBus,
  decode,
  type BusMessage,
  type ListenClient,
} from './bus';

const saved: BusMessage = {
  v: 1,
  origin: 'replica-a',
  diagramId: 'dgm_1',
  kind: 'event',
  event: { type: 'saved', updatedAt: 'T1', by: { id: 'usr_ada', name: 'Ada' } },
};

let logs: LogCapture;

beforeEach(() => {
  logs = captureLogs();
});

afterEach(() => {
  logs.restore();
  vi.useRealTimers();
});

describe('decode', () => {
  it('accepts every message kind and rejects anything else', () => {
    expect(decode(JSON.stringify(saved))).toEqual(saved);
    const touch: BusMessage = {
      v: 1,
      origin: 'r',
      diagramId: 'dgm_1',
      kind: 'touch',
      sessionKey: 's1',
      user: { id: 'usr_1', name: 'A' },
      cursor: { x: 1, y: 2 },
      editing: true,
    };
    expect(decode(JSON.stringify(touch))).toEqual(touch);
    expect(decode('{"v":1,"origin":"r","diagramId":"d","kind":"leave","sessionKey":"s"}')).toEqual({
      v: 1,
      origin: 'r',
      diagramId: 'd',
      kind: 'leave',
      sessionKey: 's',
    });

    const commented: BusMessage = {
      ...saved,
      event: {
        type: 'comment',
        threadId: 'thr_1',
        action: 'replied',
        by: { id: 'usr_1', name: 'A' },
      },
    };
    expect(decode(JSON.stringify(commented))).toEqual(commented);

    expect(decode('not json')).toBeNull();
    expect(
      decode('{"v":2,"origin":"r","diagramId":"d","kind":"leave","sessionKey":"s"}'),
    ).toBeNull();
    expect(decode(JSON.stringify({ ...saved, event: { type: 'presence', users: [] } }))).toBeNull();
    expect(decode(JSON.stringify({ ...saved, origin: '' }))).toBeNull();
  });
});

describe('MemoryBus', () => {
  it('delivers to every subscriber, including the publisher, until unsubscribed', async () => {
    const bus = new MemoryBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    const stopB = bus.subscribe(b);
    await bus.publish(saved);
    expect(a).toHaveBeenCalledWith(saved);
    expect(b).toHaveBeenCalledWith(saved);
    stopB();
    await bus.publish(saved);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
    expect(appMetrics().busMessages.get({ direction: 'sent', kind: 'event' })).toBe(2);
  });

  it('one throwing subscriber does not starve the rest', async () => {
    const bus = new MemoryBus();
    const fine = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(fine);
    await bus.publish(saved);
    expect(fine).toHaveBeenCalledTimes(1);
    expect(logs.named('bus listener failed')).toHaveLength(1);
  });
});

/** A stand-in for `pg.Client`: records queries, lets the test fire events. */
class FakeClient implements ListenClient {
  queries: string[] = [];
  handlers = new Map<string, ((...args: never[]) => void)[]>();
  ended = false;

  async query(text: string): Promise<unknown> {
    this.queries.push(text);
    return {};
  }

  on(event: string, listener: (...args: never[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(listener);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.handlers.get(event) ?? []) listener(...(args as never[]));
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

describe('PgBus', () => {
  function harness(options: { failConnects?: number; backoffMs?: number[] } = {}) {
    const clients: FakeClient[] = [];
    let failures = options.failConnects ?? 0;
    const notify = vi.fn(async () => {});
    const bus = new PgBus({
      connect: async () => {
        if (failures > 0) {
          failures--;
          throw new Error('ECONNREFUSED');
        }
        const client = new FakeClient();
        clients.push(client);
        return client;
      },
      notify,
      backoffMs: options.backoffMs ?? [10, 20, 40],
    });
    return { bus, clients, notify };
  }

  it('listens on the channel and delivers decoded notifications', async () => {
    const { bus, clients } = harness();
    const received = vi.fn();
    bus.subscribe(received);
    await bus.start();
    expect(bus.connected).toBe(true);
    expect(clients[0].queries).toEqual([`listen ${BUS_CHANNEL}`]);
    expect(appMetrics().busConnected.get()).toBe(1);
    expect(logs.named('bus connected')[0]).toMatchObject({ channel: BUS_CHANNEL });

    clients[0].emit('notification', { channel: BUS_CHANNEL, payload: JSON.stringify(saved) });
    clients[0].emit('notification', { channel: 'other_channel', payload: JSON.stringify(saved) });
    clients[0].emit('notification', { channel: BUS_CHANNEL, payload: '{"junk":true}' });
    clients[0].emit('notification', { channel: BUS_CHANNEL });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(saved);
    // Transport counts what it sends; who a message came from is the coordinator's call.
    expect(appMetrics().busMessages.get({ direction: 'received', kind: 'event' })).toBe(0);
    expect(appMetrics().busDropped.get({ reason: 'invalid' })).toBe(1);
    await bus.close();
  });

  it('publishes through pg_notify as JSON and refuses oversized payloads', async () => {
    const { bus, notify } = harness();
    await bus.publish(saved);
    expect(notify).toHaveBeenCalledWith(BUS_CHANNEL, JSON.stringify(saved));
    expect(appMetrics().busMessages.get({ direction: 'sent', kind: 'event' })).toBe(1);

    const huge: BusMessage = {
      ...saved,
      event: { type: 'meta', title: 'x'.repeat(MAX_PAYLOAD_BYTES) },
    };
    await bus.publish(huge);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(appMetrics().busDropped.get({ reason: 'too_large' })).toBe(1);
    expect(logs.named('bus message too large')).toHaveLength(1);
  });

  it('logs and counts a failed publish instead of throwing', async () => {
    const bus = new PgBus({
      connect: async () => new FakeClient(),
      notify: async () => {
        throw new Error('connection terminated');
      },
    });
    await expect(bus.publish(saved)).resolves.toBeUndefined();
    expect(appMetrics().busDropped.get({ reason: 'publish_failed' })).toBe(1);
    expect(logs.named('bus publish failed')[0]).toMatchObject({
      err: { message: 'connection terminated' },
    });
  });

  it('retries a refused connection with growing delays, then connects', async () => {
    vi.useFakeTimers();
    const { bus, clients } = harness({ failConnects: 2, backoffMs: [10, 20, 40] });
    await bus.start();
    expect(bus.connected).toBe(false);
    expect(logs.named('bus could not connect')[0]).toMatchObject({ retryInMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    expect(bus.connected).toBe(false);
    expect(logs.named('bus could not connect')[1]).toMatchObject({ retryInMs: 20 });

    await vi.advanceTimersByTimeAsync(20);
    expect(bus.connected).toBe(true);
    expect(clients).toHaveLength(1);
    expect(appMetrics().busReconnects.get()).toBe(1);
    await bus.close();
  });

  it('reconnects after the listening connection errors or ends', async () => {
    vi.useFakeTimers();
    const { bus, clients } = harness({ backoffMs: [10] });
    await bus.start();
    expect(clients).toHaveLength(1);

    clients[0].emit('error', new Error('server closed the connection unexpectedly'));
    expect(bus.connected).toBe(false);
    expect(clients[0].ended).toBe(true);
    expect(appMetrics().busConnected.get()).toBe(0);
    expect(logs.named('bus disconnected')[0]).toMatchObject({
      err: { message: 'server closed the connection unexpectedly' },
      retryInMs: 10,
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(bus.connected).toBe(true);
    expect(clients).toHaveLength(2);

    // `end` without an error is a loss too, and a second event on the same client is ignored.
    clients[1].emit('end');
    clients[1].emit('error', new Error('late'));
    expect(logs.named('bus disconnected')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(clients).toHaveLength(3);
    expect(appMetrics().busReconnects.get()).toBe(2);
    await bus.close();
  });

  it('close() ends the client, stops reconnecting and drops subscribers', async () => {
    vi.useFakeTimers();
    const { bus, clients } = harness({ backoffMs: [10] });
    const received = vi.fn();
    bus.subscribe(received);
    await bus.start();
    await bus.close();
    expect(clients[0].ended).toBe(true);
    expect(bus.connected).toBe(false);

    clients[0].emit('end');
    await vi.advanceTimersByTimeAsync(50);
    expect(clients).toHaveLength(1);
    clients[0].emit('notification', { channel: BUS_CHANNEL, payload: JSON.stringify(saved) });
    expect(received).not.toHaveBeenCalled();
  });

  it('start() is idempotent while a connection attempt is in flight', async () => {
    const { bus, clients } = harness();
    await Promise.all([bus.start(), bus.start(), bus.start()]);
    expect(clients).toHaveLength(1);
    await bus.close();
  });
});
