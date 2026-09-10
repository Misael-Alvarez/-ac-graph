import { describe, expect, it, vi } from 'vitest';
import { EventHub, formatSse, type DiagramEvent } from './events';

const saved: DiagramEvent = {
  type: 'saved',
  updatedAt: '2026-01-01T00:00:00.000Z',
  by: { id: 'usr_ada', name: 'Ada' },
};

describe('EventHub', () => {
  it('delivers to every subscriber of that diagram only', () => {
    const hub = new EventHub();
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    hub.subscribe('dgm_1', a);
    hub.subscribe('dgm_1', b);
    hub.subscribe('dgm_2', other);

    expect(hub.publish('dgm_1', saved)).toBe(2);
    expect(a).toHaveBeenCalledWith(saved);
    expect(b).toHaveBeenCalledWith(saved);
    expect(other).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new EventHub();
    const a = vi.fn();
    const off = hub.subscribe('dgm_1', a);
    off();
    expect(hub.publish('dgm_1', saved)).toBe(0);
    expect(a).not.toHaveBeenCalled();
    expect(hub.subscriberCount('dgm_1')).toBe(0);
  });

  it('is safe to unsubscribe twice and to publish to nobody', () => {
    const hub = new EventHub();
    const off = hub.subscribe('dgm_1', vi.fn());
    off();
    expect(() => off()).not.toThrow();
    expect(hub.publish('dgm_nobody', { type: 'deleted' })).toBe(0);
  });

  it('survives a throwing subscriber', () => {
    const hub = new EventHub();
    const healthy = vi.fn();
    hub.subscribe('dgm_1', () => {
      throw new Error('closed stream');
    });
    hub.subscribe('dgm_1', healthy);
    expect(hub.publish('dgm_1', { type: 'meta', title: 'T' })).toBe(1);
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('lets a subscriber unsubscribe from inside a delivery', () => {
    const hub = new EventHub();
    const off = hub.subscribe('dgm_1', () => off());
    const after = vi.fn();
    hub.subscribe('dgm_1', after);
    hub.publish('dgm_1', saved);
    expect(after).toHaveBeenCalledTimes(1);
    expect(hub.subscriberCount('dgm_1')).toBe(1);
  });
});

describe('formatSse', () => {
  it('names the event and carries the whole object as JSON', () => {
    const wire = formatSse(saved);
    expect(wire).toBe(`event: saved\ndata: ${JSON.stringify(saved)}\n\n`);
  });

  it('never splits data across lines', () => {
    const wire = formatSse({ type: 'meta', title: 'line\nbreak' });
    const [, data] = wire.split('\n');
    expect(data.startsWith('data: ')).toBe(true);
    expect(JSON.parse(data.slice('data: '.length))).toEqual({ type: 'meta', title: 'line\nbreak' });
  });
});
