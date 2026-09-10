import { describe, expect, it } from 'vitest';
import { PRESENCE_PALETTE, PresenceRegistry, colorForUser } from './presence';

const ada = { id: 'usr_ada', name: 'Ada' };
const bob = { id: 'usr_bob', name: 'Bob' };

function registry() {
  let now = 1_000_000;
  const reg = new PresenceRegistry(15_000, () => now);
  return { reg, advance: (ms: number) => (now += ms) };
}

describe('colorForUser', () => {
  it('is deterministic and drawn from the palette', () => {
    expect(colorForUser('usr_ada')).toBe(colorForUser('usr_ada'));
    expect(PRESENCE_PALETTE).toContain(colorForUser('usr_ada'));
    expect(PRESENCE_PALETTE).toContain(colorForUser(''));
  });

  it('spreads users across the palette', () => {
    const colours = new Set(Array.from({ length: 64 }, (_, i) => colorForUser(`usr_${i}`)));
    expect(colours.size).toBe(PRESENCE_PALETTE.length);
  });
});

describe('PresenceRegistry', () => {
  it('lists viewers with their colour, cursor and editing flag', () => {
    const { reg } = registry();
    reg.touch('dgm_1', 'sess_a', ada, { cursor: { x: 1, y: 2 }, editing: true });
    reg.touch('dgm_1', 'sess_b', bob);
    expect(reg.list('dgm_1')).toEqual([
      {
        id: 'usr_ada',
        name: 'Ada',
        color: colorForUser('usr_ada'),
        cursor: { x: 1, y: 2 },
        editing: true,
        sessionKey: 'sess_a',
      },
      {
        id: 'usr_bob',
        name: 'Bob',
        color: colorForUser('usr_bob'),
        cursor: null,
        editing: false,
        sessionKey: 'sess_b',
      },
    ]);
  });

  it('keeps fields a heartbeat leaves out and lets null hide the cursor', () => {
    const { reg } = registry();
    reg.touch('dgm_1', 'sess_a', ada, { cursor: { x: 5, y: 5 }, editing: true });
    reg.touch('dgm_1', 'sess_a', ada);
    expect(reg.list('dgm_1')[0]).toMatchObject({ cursor: { x: 5, y: 5 }, editing: true });
    reg.touch('dgm_1', 'sess_a', ada, { cursor: null });
    expect(reg.list('dgm_1')[0]).toMatchObject({ cursor: null, editing: true });
  });

  it('separates diagrams and separates two tabs of one person', () => {
    const { reg } = registry();
    reg.touch('dgm_1', 'sess_a', ada);
    reg.touch('dgm_1', 'sess_a2', ada);
    reg.touch('dgm_2', 'sess_b', bob);
    expect(reg.list('dgm_1').map((u) => u.sessionKey)).toEqual(['sess_a', 'sess_a2']);
    expect(reg.list('dgm_2').map((u) => u.id)).toEqual(['usr_bob']);
  });

  it('expires a viewer after the TTL and revives it on the next heartbeat', () => {
    const { reg, advance } = registry();
    reg.touch('dgm_1', 'sess_a', ada);
    advance(14_999);
    expect(reg.list('dgm_1')).toHaveLength(1);
    advance(2);
    expect(reg.list('dgm_1')).toEqual([]);
    reg.touch('dgm_1', 'sess_a', ada);
    expect(reg.list('dgm_1')).toHaveLength(1);
  });

  it('expires viewers independently', () => {
    const { reg, advance } = registry();
    reg.touch('dgm_1', 'sess_a', ada);
    advance(10_000);
    reg.touch('dgm_1', 'sess_b', bob);
    advance(6_000);
    expect(reg.list('dgm_1').map((u) => u.id)).toEqual(['usr_bob']);
  });

  it('reports whether leave removed anything', () => {
    const { reg } = registry();
    reg.touch('dgm_1', 'sess_a', ada);
    expect(reg.leave('dgm_1', 'sess_a')).toBe(true);
    expect(reg.leave('dgm_1', 'sess_a')).toBe(false);
    expect(reg.leave('dgm_9', 'sess_a')).toBe(false);
    expect(reg.list('dgm_1')).toEqual([]);
  });

  it('sweeps every room', () => {
    const { reg, advance } = registry();
    reg.touch('dgm_1', 'sess_a', ada);
    reg.touch('dgm_2', 'sess_b', bob);
    advance(20_000);
    reg.sweep();
    expect(reg.list('dgm_1')).toEqual([]);
    expect(reg.list('dgm_2')).toEqual([]);
  });
});
