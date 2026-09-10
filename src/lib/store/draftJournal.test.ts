import { describe, expect, it, vi } from 'vitest';
import type { DiagramRecord } from '@/lib/domain';
import { createEmptyModel } from '@/lib/engine';
import { DraftJournal, type DiagramDraft } from './draftJournal';

const base = '2026-09-08T12:00:00.000Z';
const next = '2026-09-08T12:00:01.000Z';
const record: DiagramRecord = {
  id: 'diagram',
  ownerId: 'owner',
  title: 'Test',
  description: '',
  folder: null,
  thumbnail: null,
  createdAt: base,
  updatedAt: base,
  model: createEmptyModel(),
};
const draft: DiagramDraft = {
  version: 1,
  revision: 'one',
  baseUpdatedAt: base,
  model: record.model,
};

function setup() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  return { storage, journal: new DraftJournal(storage, 'session', record) };
}

describe('draft journal', () => {
  it('recovers a synchronous write on reload, including a pending rename', () => {
    const { storage, journal } = setup();
    journal.write({ ...draft, title: 'Renamed' });
    const reloaded = new DraftJournal(storage, 'session', record);
    expect(reloaded.recover(record)).toEqual({ ...draft, title: 'Renamed' });
  });

  it('does not recover another diagram, owner or session', () => {
    const { storage, journal } = setup();
    journal.write(draft);
    for (const [session, scope] of [
      ['another', record],
      ['session', { ...record, id: 'another' }],
      ['session', { ...record, ownerId: 'another' }],
    ] as const) {
      expect(new DraftJournal(storage, session, scope).recover({ ...record, ...scope })).toBeNull();
    }
  });

  it('never rebases or deletes a revision other than the acknowledged one', () => {
    const { journal } = setup();
    const newer = { ...draft, revision: 'two', title: 'Newer' };
    journal.write(newer);
    journal.acknowledge(draft);
    expect(journal.read()).toEqual(newer);
    journal.write(draft);
    journal.acknowledge(newer);
    expect(journal.read()).toEqual(draft);
  });

  it('clears only the acknowledged draft', () => {
    const { journal } = setup();
    journal.write(draft);
    journal.acknowledge(draft);
    expect(journal.read()).toBeNull();
  });

  it('does not replay a stale draft over a saved revision or restore', () => {
    const { storage, journal } = setup();
    journal.write(draft);
    expect(journal.recover({ ...record, updatedAt: next })).toBeNull();
    expect(journal.read()).toBeNull();
    expect(journal.read(true)).toEqual(draft);
    // The rejected draft stays exportable across another reload and new saves.
    const reloaded = new DraftJournal(storage, 'session', record);
    reloaded.write({ ...draft, revision: 'three', baseUpdatedAt: next });
    reloaded.acknowledge(reloaded.read()!);
    expect(reloaded.read(true)).toEqual(draft);
  });

  it('ignores invalid JSON, unsupported journal versions and invalid models', () => {
    const { storage, journal } = setup();
    for (const raw of [
      '{bad json',
      JSON.stringify({ ...draft, version: 2 }),
      JSON.stringify({ ...draft, model: {} }),
    ]) {
      storage.setItem(journal.key, raw);
      expect(journal.recover(record)).toBeNull();
    }
  });

  it('surfaces quota errors without deleting the previous draft', () => {
    const { storage, journal } = setup();
    journal.write(draft);
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    expect(() => journal.write({ ...draft, revision: 'two' })).toThrow('quota');
    expect(journal.read()).toEqual(draft);
  });

  it('does not remove a conflicting draft if archiving it fails', () => {
    const { storage, journal } = setup();
    journal.write(draft);
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    expect(() => journal.recover({ ...record, updatedAt: next })).toThrow('quota');
    expect(journal.read()).toEqual(draft);
  });

  it('reserves a conflicting active key until its archive is durable', () => {
    const { storage, journal } = setup();
    journal.write(draft);
    const setItem = storage.setItem.getMockImplementation()!;
    storage.setItem.mockImplementation((key, value) => {
      if (key.endsWith(':conflict')) throw new Error('quota');
      setItem(key, value);
    });
    expect(() => journal.recover({ ...record, updatedAt: next })).toThrow('quota');
    expect(() => journal.write({ ...draft, revision: 'two', baseUpdatedAt: next })).toThrow(
      'quota',
    );
    journal.acknowledge(draft);
    expect(journal.read()).toEqual(draft);
    storage.setItem.mockImplementation(setItem);
    journal.write({ ...draft, revision: 'two', baseUpdatedAt: next });
    journal.acknowledge(journal.read()!);
    expect(journal.read()).toBeNull();
    expect(new DraftJournal(storage, 'session', record).read(true)).toEqual(draft);
  });
});
