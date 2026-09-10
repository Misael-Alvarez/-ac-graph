import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSingleton } from '../globals';
import { events, publish } from './events';
import { presence } from './presence';
import { openDiagramStream, toWire } from './stream';

const ada = { id: 'usr_ada', name: 'Ada' };
const bob = { id: 'usr_bob', name: 'Bob' };

/** Reads SSE frames off a response body until `count` complete messages arrived. */
async function readFrames(response: Response, count: number): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames: string[] = [];
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      frames.push(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\n\n');
    }
  }
  reader.releaseLock();
  return frames;
}

function parseFrame(frame: string): { event: string; data: unknown } {
  const lines = frame.split('\n');
  const event = lines.find((l) => l.startsWith('event: '))!.slice(7);
  const data = JSON.parse(lines.find((l) => l.startsWith('data: '))!.slice(6));
  return { event, data };
}

beforeEach(() => {
  resetSingleton('events');
  resetSingleton('presence');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toWire', () => {
  it('marks the connection\u2019s own entry and hides session keys', () => {
    const wire = toWire(
      {
        type: 'presence',
        users: [
          { id: 'u1', name: 'A', color: '#000', cursor: null, editing: false, sessionKey: 'me' },
          {
            id: 'u2',
            name: 'B',
            color: '#fff',
            cursor: { x: 1, y: 1 },
            editing: true,
            sessionKey: 'x',
          },
        ],
      },
      'me',
    );
    expect(wire).toEqual({
      type: 'presence',
      users: [
        { id: 'u1', name: 'A', color: '#000', cursor: null, editing: false, self: true },
        { id: 'u2', name: 'B', color: '#fff', cursor: { x: 1, y: 1 }, editing: true, self: false },
      ],
    });
    expect(JSON.stringify(wire)).not.toContain('sessionKey');
  });

  it('passes other events through untouched', () => {
    expect(toWire({ type: 'deleted' }, 'me')).toEqual({ type: 'deleted' });
  });
});

describe('openDiagramStream', () => {
  it('answers as an unbuffered event stream', () => {
    const controller = new AbortController();
    const response = openDiagramStream({
      diagramId: 'dgm_1',
      user: ada,
      sessionKey: 'sess_a',
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    controller.abort();
  });

  it('sends the roster on join, then relays published events', async () => {
    const controller = new AbortController();
    const response = openDiagramStream({
      diagramId: 'dgm_1',
      user: ada,
      sessionKey: 'sess_a',
      signal: controller.signal,
    });

    const [first] = await readFrames(response, 1);
    expect(parseFrame(first)).toEqual({
      event: 'presence',
      data: {
        type: 'presence',
        users: [expect.objectContaining({ id: 'usr_ada', name: 'Ada', self: true })],
      },
    });

    publish('dgm_1', { type: 'saved', updatedAt: 'T1', by: bob });
    publish('dgm_1', { type: 'meta', title: 'Renamed' });
    const [saved, meta] = await readFrames(response, 2);
    expect(parseFrame(saved).event).toBe('saved');
    expect(parseFrame(saved).data).toMatchObject({ updatedAt: 'T1', by: bob });
    expect(parseFrame(meta).data).toEqual({ type: 'meta', title: 'Renamed' });
    controller.abort();
  });

  it('shows a second viewer to the first, and their departure', async () => {
    const a = new AbortController();
    const b = new AbortController();
    const first = openDiagramStream({
      diagramId: 'dgm_1',
      user: ada,
      sessionKey: 'sess_a',
      signal: a.signal,
    });
    await readFrames(first, 1);

    const second = openDiagramStream({
      diagramId: 'dgm_1',
      user: bob,
      sessionKey: 'sess_b',
      signal: b.signal,
    });
    const [joined] = await readFrames(first, 1);
    const roster = parseFrame(joined).data as { users: { id: string; self: boolean }[] };
    expect(roster.users.map((u) => [u.id, u.self])).toEqual([
      ['usr_ada', true],
      ['usr_bob', false],
    ]);

    b.abort();
    const [left] = await readFrames(first, 1);
    expect((parseFrame(left).data as { users: { id: string }[] }).users.map((u) => u.id)).toEqual([
      'usr_ada',
    ]);
    expect(events().subscriberCount('dgm_1')).toBe(1);
    expect(second.body).toBeTruthy();
    a.abort();
  });

  it('cleans up on abort: unsubscribes, leaves presence, closes the body', async () => {
    const controller = new AbortController();
    const response = openDiagramStream({
      diagramId: 'dgm_1',
      user: ada,
      sessionKey: 'sess_a',
      signal: controller.signal,
    });
    await readFrames(response, 1);
    expect(events().subscriberCount('dgm_1')).toBe(1);
    expect(presence().list('dgm_1')).toHaveLength(1);

    controller.abort();
    expect(events().subscriberCount('dgm_1')).toBe(0);
    expect(presence().list('dgm_1')).toEqual([]);
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(true);
  });

  it('keeps the connection and the presence alive with heartbeats', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const response = openDiagramStream({
      diagramId: 'dgm_1',
      user: ada,
      sessionKey: 'sess_a',
      signal: controller.signal,
      heartbeatMs: 1_000,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // roster

    const before = Date.now();
    await vi.advanceTimersByTimeAsync(1_000);
    const { value } = await reader.read();
    expect(decoder.decode(value)).toBe(': ping\n\n');
    // The heartbeat re-stamped the viewer, so it survives past the original TTL.
    expect(presence().list('dgm_1')).toHaveLength(1);
    expect(Date.now()).toBeGreaterThanOrEqual(before + 1_000);
    controller.abort();
  });

  it('is a no-op stream when the request was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const response = openDiagramStream({
      diagramId: 'dgm_1',
      user: ada,
      sessionKey: 'sess_a',
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(true);
    expect(events().subscriberCount('dgm_1')).toBe(0);
  });
});
