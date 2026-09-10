import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPresence, subscribeToDiagram, throttle, type CollabStatus } from './client';

/** A scriptable EventSource: tests drive open/error/message by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const Source = FakeEventSource as unknown as typeof EventSource;

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('subscribeToDiagram', () => {
  it('opens the stream with credentials and reports its status', () => {
    const statuses: CollabStatus[] = [];
    const stop = subscribeToDiagram(
      'dgm_1',
      { onStatus: (s) => statuses.push(s) },
      { EventSource: Source, heartbeatMs: 0 },
    );
    const [source] = FakeEventSource.instances;
    expect(source.url).toBe('/api/diagrams/dgm_1/events');
    expect(source.init?.withCredentials).toBe(true);
    source.onopen?.();
    stop();
    expect(statuses).toEqual(['connecting', 'open', 'closed']);
    expect(source.closed).toBe(true);
  });

  it('dispatches each event type to its handler', () => {
    const onSaved = vi.fn();
    const onPresence = vi.fn();
    const onMeta = vi.fn();
    subscribeToDiagram(
      'dgm_1',
      { onSaved, onPresence, onMeta },
      { EventSource: Source, heartbeatMs: 0 },
    );
    const [source] = FakeEventSource.instances;
    source.emit('saved', { type: 'saved', updatedAt: 'T', by: { id: 'u', name: 'N' } });
    source.emit('presence', {
      type: 'presence',
      users: [{ id: 'u', name: 'N', color: '#000', cursor: null, editing: false, self: true }],
    });
    source.emit('meta', { type: 'meta', title: 'Renamed' });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: 'T' }));
    expect(onPresence).toHaveBeenCalledWith([expect.objectContaining({ id: 'u', self: true })]);
    expect(onMeta).toHaveBeenCalledWith(expect.objectContaining({ title: 'Renamed' }));
  });

  it('reconnects with exponential backoff after an error', () => {
    const statuses: CollabStatus[] = [];
    subscribeToDiagram(
      'dgm_1',
      { onStatus: (s) => statuses.push(s) },
      { EventSource: Source, heartbeatMs: 0, initialBackoffMs: 1_000, maxBackoffMs: 4_000 },
    );
    FakeEventSource.instances[0].onerror?.();
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    FakeEventSource.instances[1].onerror?.();
    vi.advanceTimersByTime(2_000);
    expect(FakeEventSource.instances).toHaveLength(3);

    FakeEventSource.instances[2].onerror?.();
    vi.advanceTimersByTime(4_000);
    expect(FakeEventSource.instances).toHaveLength(4);

    // Capped: the next wait is still 4s, not 8s.
    FakeEventSource.instances[3].onerror?.();
    vi.advanceTimersByTime(4_000);
    expect(FakeEventSource.instances).toHaveLength(5);

    expect(statuses.filter((s) => s === 'reconnecting')).toHaveLength(4);
  });

  it('resets the backoff once a connection opens', () => {
    subscribeToDiagram(
      'dgm_1',
      {},
      { EventSource: Source, heartbeatMs: 0, initialBackoffMs: 1_000 },
    );
    FakeEventSource.instances[0].onerror?.();
    vi.advanceTimersByTime(1_000);
    FakeEventSource.instances[1].onerror?.();
    vi.advanceTimersByTime(2_000);
    FakeEventSource.instances[2].onopen?.();
    FakeEventSource.instances[2].onerror?.();
    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it('stops for good on deleted and never reconnects', () => {
    const onDeleted = vi.fn();
    const statuses: CollabStatus[] = [];
    subscribeToDiagram(
      'dgm_1',
      { onDeleted, onStatus: (s) => statuses.push(s) },
      { EventSource: Source, heartbeatMs: 0 },
    );
    FakeEventSource.instances[0].emit('deleted', { type: 'deleted' });
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(statuses.at(-1)).toBe('closed');
  });

  it('does not reconnect after unsubscribe, even with a retry pending', () => {
    const stop = subscribeToDiagram('dgm_1', {}, { EventSource: Source, heartbeatMs: 0 });
    FakeEventSource.instances[0].onerror?.();
    stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('confirms presence periodically while open', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;
    const stop = subscribeToDiagram(
      'dgm_1',
      {},
      { EventSource: Source, fetch: fetchImpl, heartbeatMs: 5_000 },
    );
    FakeEventSource.instances[0].onopen?.();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('is a no-op where EventSource does not exist', () => {
    const original = globalThis.EventSource;
    // @ts-expect-error simulating a runtime without EventSource
    delete globalThis.EventSource;
    try {
      expect(() => subscribeToDiagram('dgm_1', {})()).not.toThrow();
    } finally {
      if (original) globalThis.EventSource = original;
    }
  });
});

describe('sendPresence', () => {
  it('posts same-origin with the marker and keepalive', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;
    await sendPresence('dgm_1', { cursor: { x: 1, y: 2 }, editing: true }, { fetch: fetchImpl });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api/diagrams/dgm_1/presence');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('x-requested-with')).toBe('ac-graph');
    expect(JSON.parse(init.body as string)).toEqual({ cursor: { x: 1, y: 2 }, editing: true });
  });

  it('swallows network failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(sendPresence('dgm_1', {}, { fetch: fetchImpl })).resolves.toBeUndefined();
  });
});

describe('throttle', () => {
  it('runs the first call at once and collapses the rest into one trailing call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled(1);
    throttled(2);
    throttled(3);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it('runs again immediately once the window has passed', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled('a');
    vi.advanceTimersByTime(150);
    throttled('b');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('can cancel or flush a pending call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled('a');
    throttled('b');
    throttled.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);

    throttled('c');
    throttled('d');
    throttled.flush();
    expect(fn).toHaveBeenLastCalledWith('d');
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
