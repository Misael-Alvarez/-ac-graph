import { describe, expect, it, vi } from 'vitest';
import { createEmptyModel } from '@/lib/engine';
import { DraftJournal, type DiagramDraft } from './draftJournal';
import { acquireDraftSession, DRAFT_SESSION_KEY, type DraftSessionLocks } from './draftSession';

function storage(session?: string) {
  const values = new Map<string, string>(session ? [[DRAFT_SESSION_KEY, session]] : []);
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

function locks() {
  const held = new Set<string>();
  const manager: DraftSessionLocks = {
    request: vi.fn(async (name, _options, callback) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        await callback({});
      } finally {
        held.delete(name);
      }
    }),
  };
  return { manager, held };
}

const scope = { id: 'diagram', ownerId: 'owner' };
const draft: DiagramDraft = {
  version: 1,
  revision: 'one',
  baseUpdatedAt: '2026-09-08T12:00:00.000Z',
  model: createEmptyModel(),
};

describe('draft session leases', () => {
  it('forks a copied sessionStorage id while the original live page holds its lease', async () => {
    const { manager, held } = locks();
    const originalStorage = storage();
    const original = (await acquireDraftSession(originalStorage, manager))!;
    const copiedStorage = storage(originalStorage.getItem(DRAFT_SESSION_KEY)!);
    const copied = (await acquireDraftSession(copiedStorage, manager))!;
    try {
      expect(original.active).toBe(true);
      expect(copied.active).toBe(true);
      expect(copied.id).not.toBe(original.id);
      expect(originalStorage.getItem(DRAFT_SESSION_KEY)).toBe(original.id);
      expect(copiedStorage.getItem(DRAFT_SESSION_KEY)).toBe(copied.id);
      expect(held.size).toBe(2);
    } finally {
      await original.release();
      await copied.release();
    }
    expect(held.size).toBe(0);
  });

  it('does not let either cloned page acknowledge or revive the other journal', async () => {
    const { manager } = locks();
    const local = storage();
    const first = (await acquireDraftSession(storage('copied'), manager))!;
    const second = (await acquireDraftSession(storage('copied'), manager))!;
    try {
      const a = new DraftJournal(local, first.id, scope, () => first.active);
      const b = new DraftJournal(local, second.id, scope, () => second.active);
      const newer = { ...draft, revision: 'two' };
      a.write(draft);
      b.write(newer);
      a.acknowledge(newer);
      b.acknowledge(draft);
      expect(a.read()).toEqual(draft);
      expect(b.read()).toEqual(newer);
      a.acknowledge(draft);
      expect(b.read()).toEqual(newer);
      a.write(draft);
      b.acknowledge(newer);
      expect(a.read()).toEqual(draft);
      expect(b.read()).toBeNull();
    } finally {
      await first.release();
      await second.release();
    }
  });

  it('reuses an id on reload only after release and fences late acknowledgements from the departed owner', async () => {
    const { manager } = locks();
    const session = storage();
    const local = storage();
    const first = (await acquireDraftSession(session, manager))!;
    const departed = new DraftJournal(local, first.id, scope, () => first.active);
    departed.write(draft);
    const releasing = first.release();
    expect(first.active).toBe(false);
    expect(() => departed.acknowledge(draft)).toThrow(/lease/);
    await releasing;
    const reloaded = (await acquireDraftSession(session, manager))!;
    try {
      expect(reloaded.id).toBe(first.id);
      const current = new DraftJournal(local, reloaded.id, scope, () => reloaded.active);
      // Reload may recover the very same revision, so revision equality alone is insufficient.
      current.write(draft);
      expect(() => departed.acknowledge(draft)).toThrow(/lease/);
      expect(() => departed.write({ ...draft, revision: 'stale' })).toThrow(/lease/);
      expect(current.read()).toEqual(draft);
    } finally {
      await reloaded.release();
    }
  });

  it('disables recovery without Web Locks instead of trusting a copied id', async () => {
    const session = storage('copied');
    expect(await acquireDraftSession(session)).toBeNull();
    expect(session.getItem).not.toHaveBeenCalled();
    expect(session.setItem).not.toHaveBeenCalled();
  });

  it('does not claim an id if lock acquisition is denied', async () => {
    const session = storage('copied');
    const manager: DraftSessionLocks = { request: vi.fn().mockRejectedValue(new Error('denied')) };
    await expect(acquireDraftSession(session, manager)).rejects.toThrow('denied');
    expect(session.setItem).not.toHaveBeenCalled();
  });

  it('releases the lease if persisting the new session id fails', async () => {
    const { manager, held } = locks();
    const session = storage('session');
    session.setItem.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    await expect(acquireDraftSession(session, manager)).rejects.toThrow('quota');
    expect(held.size).toBe(0);
    const next = (await acquireDraftSession(session, manager))!;
    expect(next.id).toBe('session');
    await next.release();
  });

  it('does not claim an unowned id if neither candidate can be acquired', async () => {
    const session = storage('copied');
    const manager: DraftSessionLocks = {
      request: vi.fn(async (_name, _options, callback) => callback(null)),
    };
    expect(await acquireDraftSession(session, manager)).toBeNull();
    expect(session.setItem).not.toHaveBeenCalled();
  });
});
