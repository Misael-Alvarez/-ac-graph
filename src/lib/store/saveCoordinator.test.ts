import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramModel, DiagramRecord } from '@/lib/domain';
import { addGroup, createEmptyModel } from '@/lib/engine';
import { DraftJournal } from './draftJournal';
import { DiagramConflictError, LocalDiagramRepository } from './localRepository';
import { AUTOSAVE_DEBOUNCE_MS, SaveCoordinator } from './saveCoordinator';
import type { SaveOptions } from './types';

function model(width: number): DiagramModel {
  return { ...createEmptyModel(), canvas: { w: width, h: 1000 } };
}

/** A model with something on it, so replacing it is worth a snapshot. */
function contentModel(groups: number): DiagramModel {
  const m = createEmptyModel();
  for (let i = 0; i < groups; i++) addGroup(m, i * 500, 0);
  return m;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup() {
  const base: DiagramRecord = {
    id: 'diagram',
    ownerId: 'owner',
    title: 'Test',
    description: '',
    folder: null,
    thumbnail: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: model(100),
  };
  let stamp = Date.now();
  const saved = (content: DiagramModel, title = base.title): DiagramRecord => ({
    ...base,
    model: content,
    title,
    updatedAt: new Date(++stamp).toISOString(),
  });
  const repository = {
    save: vi.fn(async (_id: string, content: DiagramModel, options?: SaveOptions) =>
      saved(content, options?.metadata?.title),
    ),
    restoreVersion: vi.fn(async () => saved(model(50))),
  };
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
  const journal = new DraftJournal(storage, 'session', base);
  const onChange = vi.fn();
  const coordinator = new SaveCoordinator(repository, base, journal, onChange);
  return { base, repository, journal, storage, coordinator, saved, onChange };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-09-08T12:00:00.000Z');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('save coordinator', () => {
  it('journals immediately, debounces, and only reports saved after confirmation', async () => {
    const { coordinator, repository, journal, saved } = setup();
    const writing = deferred<DiagramRecord>();
    repository.save.mockReturnValueOnce(writing.promise);
    coordinator.save(model(200));
    expect(journal.read()?.model).toEqual(model(200));
    expect(coordinator.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(repository.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(coordinator.status).toBe('saving');
    writing.resolve(saved(model(200)));
    await coordinator.flush();
    expect(coordinator.status).toBe('saved');
    expect(journal.read()).toBeNull();
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst and captures immutable models', async () => {
    const { coordinator, repository } = setup();
    const latest = model(300);
    coordinator.save(model(200));
    await vi.advanceTimersByTimeAsync(600);
    coordinator.save(latest);
    latest.canvas.w = 999;
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save.mock.calls[0][1]).toEqual(model(300));
  });

  it('never overlaps writes and never calls an old acknowledgement saved while a newer edit is pending', async () => {
    const { coordinator, repository, journal, saved } = setup();
    const first = deferred<DiagramRecord>();
    const second = deferred<DiagramRecord>();
    repository.save.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    coordinator.save(model(200));
    const flushing = coordinator.flush();
    await vi.advanceTimersByTimeAsync(0);
    coordinator.save(model(300));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(repository.save).toHaveBeenCalledTimes(1);
    const acknowledged = saved(model(200));
    first.resolve(acknowledged);
    await flushing;
    expect(coordinator.status).not.toBe('saved');
    expect(journal.read()?.model).toEqual(model(300));
    expect(journal.read()?.baseUpdatedAt).toBe(acknowledged.updatedAt);
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.save).toHaveBeenCalledTimes(2);
    second.resolve(saved(model(300)));
    await coordinator.flush();
    expect(coordinator.record.model).toEqual(model(300));
    expect(coordinator.status).toBe('saved');
  });

  it('does not put an older failed write back over the latest pending draft', async () => {
    const { coordinator, repository, journal } = setup();
    const first = deferred<DiagramRecord>();
    repository.save.mockReturnValueOnce(first.promise);
    coordinator.save(model(200));
    const failed = expect(coordinator.flush()).rejects.toThrow('quota');
    await vi.advanceTimersByTimeAsync(0);
    coordinator.save(model(300));
    first.reject(new Error('quota'));
    await failed;
    expect(coordinator.status).toBe('error');
    expect(journal.read()?.model).toEqual(model(300));
    await coordinator.flush();
    expect(repository.save.mock.calls[1][1]).toEqual(model(300));
    expect(coordinator.status).toBe('saved');
  });

  it('keeps quota failures retryable without needing a new edit', async () => {
    const { coordinator, repository, journal } = setup();
    repository.save.mockRejectedValueOnce(new Error('quota'));
    coordinator.save(model(200));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(coordinator.status).toBe('error');
    expect(journal.read()?.model).toEqual(model(200));
    await coordinator.flush();
    expect(coordinator.status).toBe('saved');
    expect(journal.read()).toBeNull();
  });

  it('continues with an already-queued newer edit after an older write fails', async () => {
    const { coordinator, repository, journal } = setup();
    const first = deferred<DiagramRecord>();
    repository.save.mockReturnValueOnce(first.promise);
    coordinator.save(model(200));
    const failed = expect(coordinator.flush()).rejects.toThrow('quota');
    await vi.advanceTimersByTimeAsync(0);
    coordinator.save(model(300));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(repository.save).toHaveBeenCalledTimes(1);
    first.reject(new Error('quota'));
    await failed;
    await coordinator.flush();
    expect(repository.save.mock.calls[1][1]).toEqual(model(300));
    expect(coordinator.record.model).toEqual(model(300));
    expect(coordinator.status).toBe('saved');
    expect(journal.read()).toBeNull();
  });

  it('tries IndexedDB immediately when the synchronous journal hits quota', async () => {
    const { coordinator, repository, storage } = setup();
    storage.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    repository.save.mockRejectedValueOnce(new Error('quota'));
    coordinator.save(model(200));
    expect(coordinator.status).toBe('error');
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(coordinator.status).toBe('error');
    expect(coordinator.record.model).toEqual(model(200));
    await coordinator.flush();
    expect(coordinator.status).toBe('saved');
  });

  it('re-journals the newest edit if its first journal write failed during an older save', async () => {
    const { coordinator, repository, storage, journal, saved } = setup();
    const first = deferred<DiagramRecord>();
    repository.save.mockReturnValueOnce(first.promise);
    coordinator.save(model(200));
    const flushing = coordinator.flush();
    await vi.advanceTimersByTimeAsync(0);
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    coordinator.save(model(300));
    first.resolve(saved(model(200)));
    await flushing;
    expect(journal.read()?.model).toEqual(model(300));
    expect(journal.read()?.baseUpdatedAt).toBe(coordinator.record.updatedAt);
  });

  it('does not replay D1 when journalling larger D2 hits quota but its DB commit succeeds', async () => {
    const { coordinator, repository, storage, journal } = setup();
    const setItem = storage.setItem.getMockImplementation()!;
    storage.setItem.mockImplementation((key, value) => {
      if (value.length > 2000) throw new Error('quota');
      setItem(key, value);
    });
    coordinator.save(model(200));
    const first = journal.read()!;
    const larger: DiagramModel = {
      ...model(300),
      views: [{ id: 'large', name: 'x'.repeat(5000), kind: 'free' }],
    };
    coordinator.save(larger);
    expect(journal.read()).toEqual(first);
    await coordinator.flush();
    expect(coordinator.status).toBe('saved');
    expect(journal.read()?.baseUpdatedAt).toBe(first.baseUpdatedAt);
    const reloaded = new SaveCoordinator(repository, coordinator.record, journal);
    expect(reloaded.record.model).toEqual(larger);
    expect(reloaded.recoveryConflict?.model).toEqual(first.model);
  });

  it('flushes on departure and cancels the debounce without dropping work', async () => {
    const { coordinator, repository } = setup();
    coordinator.save(model(200));
    await coordinator.flush();
    expect(coordinator.status).toBe('saved');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('recovers the latest journal after a reload without claiming it is already saved', async () => {
    const { coordinator, repository, journal, base } = setup();
    coordinator.save(model(300));
    const reloaded = new SaveCoordinator(repository, base, journal);
    expect(reloaded.record.model).toEqual(model(300));
    expect(reloaded.status).toBe('pending');
    await reloaded.flush();
    expect(reloaded.status).toBe('saved');
  });

  it('archives ambiguous commit/ack gaps instead of replaying an old base', () => {
    const { coordinator, repository, journal, saved } = setup();
    coordinator.save(model(300));
    const committedWithoutAck = saved(model(200));
    const reloaded = new SaveCoordinator(repository, committedWithoutAck, journal);
    expect(reloaded.record.model).toEqual(model(200));
    expect(reloaded.recoveryConflict?.model).toEqual(model(300));
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('keeps a conflicting draft downloadable even if archiving it hits quota', () => {
    const { coordinator, repository, journal, storage, saved } = setup();
    coordinator.save(model(300));
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    const reloaded = new SaveCoordinator(repository, saved(model(200)), journal);
    expect(reloaded.status).toBe('error');
    expect(reloaded.record.model).toEqual(model(200));
    expect(reloaded.recoveryConflict?.model).toEqual(model(300));
    expect(journal.read()?.model).toEqual(model(300));
  });

  it('does not overwrite the only copy of a conflict when archiving fails but a smaller edit can save', async () => {
    const { coordinator, repository, journal, storage, saved, base } = setup();
    coordinator.save(model(300));
    const original = journal.read()!;
    const setItem = storage.setItem.getMockImplementation()!;
    storage.setItem.mockImplementation((key, value) => {
      if (key.endsWith(':conflict')) throw new Error('quota');
      setItem(key, value);
    });
    const reopenedJournal = new DraftJournal(storage, 'session', base);
    const reopened = new SaveCoordinator(repository, saved(model(200)), reopenedJournal);
    expect(reopened.recoveryConflict).toEqual(original);
    reopened.save(model(400));
    await reopened.flush();
    expect(reopened.record.model).toEqual(model(400));
    expect(journal.read()).toEqual(original);
    const reloaded = new SaveCoordinator(
      repository,
      reopened.record,
      new DraftJournal(storage, 'session', base),
    );
    expect(reloaded.record.model).toEqual(model(400));
    expect(reloaded.recoveryConflict).toEqual(original);
    expect(journal.read()).toEqual(original);
  });

  it('serializes a rename with a model write and journals the pending title', async () => {
    const { coordinator, repository, journal, saved } = setup();
    const first = deferred<DiagramRecord>();
    repository.save.mockReturnValueOnce(first.promise);
    coordinator.save(model(200));
    const flushing = coordinator.flush();
    await vi.advanceTimersByTimeAsync(0);
    const renamed = coordinator.rename('Newest title');
    coordinator.save(model(300));
    expect(journal.read()?.title).toBe('Newest title');
    expect(repository.save).toHaveBeenCalledTimes(1);
    first.resolve(saved(model(200)));
    await flushing;
    await renamed;
    expect(coordinator.record.title).toBe('Newest title');
    expect(coordinator.record.model).toEqual(model(300));
  });

  it('snapshots the requested model, even if a newer model is pending when its turn arrives', async () => {
    const { coordinator, repository, saved } = setup();
    const first = deferred<DiagramRecord>();
    repository.save.mockReturnValueOnce(first.promise);
    coordinator.save(model(200));
    const flushing = coordinator.flush();
    await vi.advanceTimersByTimeAsync(0);
    let confirmed = false;
    const snapshot = coordinator.snapshot(model(300)).then(() => {
      confirmed = true;
    });
    coordinator.save(model(400));
    expect(confirmed).toBe(false);
    first.resolve(saved(model(200)));
    await flushing;
    await snapshot;
    expect(repository.save.mock.calls[1][1]).toEqual(model(400));
    expect(repository.save.mock.calls[1][2]?.snapshotModel).toEqual(model(300));
    expect(coordinator.record.model).toEqual(model(400));
    expect(confirmed).toBe(true);
  });

  it('rejects explicit snapshot failures so callers cannot announce success', async () => {
    const { coordinator, repository } = setup();
    repository.save.mockRejectedValueOnce(new Error('quota'));
    await expect(coordinator.snapshot(model(300))).rejects.toThrow('quota');
    expect(coordinator.status).toBe('error');
    expect(coordinator.record.model).toEqual(model(300));
  });

  it('only advances the automatic snapshot interval after a successful commit', async () => {
    const { coordinator, repository, saved } = setup();
    // The confirmed model holds content, so replacing it is worth a snapshot.
    await coordinator.snapshot(contentModel(1));
    repository.save.mockClear();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    repository.save.mockRejectedValueOnce(new Error('quota'));
    coordinator.save(model(200));
    await expect(coordinator.flush()).rejects.toThrow();
    repository.save.mockResolvedValueOnce(saved(model(200)));
    await coordinator.flush();
    expect(repository.save.mock.calls.map((call) => call[2]?.snapshot)).toEqual([true, true]);
  });

  it('snapshots the opened content on the first confirmed edit, but never a blank canvas', async () => {
    const { coordinator, repository, saved } = setup();
    // Opened blank: the first edit replaces nothing worth keeping.
    coordinator.save(model(200));
    await coordinator.flush();
    expect(repository.save.mock.calls[0][2]?.snapshot).toBe(false);

    // Now the confirmed document has content. The next edit, even seconds later,
    // keeps that content so there is a way back to what was there.
    repository.save.mockResolvedValueOnce(saved(contentModel(1)));
    coordinator.save(contentModel(1));
    await coordinator.flush();
    coordinator.save(contentModel(2));
    await coordinator.flush();
    expect(repository.save.mock.calls[1][2]?.snapshot).toBe(false);
    expect(repository.save.mock.calls[2][2]?.snapshot).toBe(true);

    // And then the interval applies.
    coordinator.save(contentModel(3));
    await coordinator.flush();
    expect(repository.save.mock.calls[3][2]?.snapshot).toBe(false);
  });

  it('waits for pending saves before restoring and leaves no old debounce to overwrite the restore', async () => {
    const { coordinator, repository, saved, journal } = setup();
    const first = deferred<DiagramRecord>();
    repository.save.mockReturnValueOnce(first.promise);
    coordinator.save(model(200));
    const flushing = coordinator.flush();
    await vi.advanceTimersByTimeAsync(0);
    const restored = coordinator.restore('version', model(300));
    expect(repository.restoreVersion).not.toHaveBeenCalled();
    first.resolve(saved(model(200)));
    await flushing;
    expect((await restored).model).toEqual(model(50));
    expect(repository.save.mock.calls[1][1]).toEqual(model(300));
    expect(journal.read()).toBeNull();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(coordinator.record.model).toEqual(model(50));
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('does not restore if flushing the current model failed', async () => {
    const { coordinator, repository } = setup();
    repository.save.mockRejectedValueOnce(new Error('quota'));
    await expect(coordinator.restore('version', model(300))).rejects.toThrow('quota');
    expect(repository.restoreVersion).not.toHaveBeenCalled();
    expect(coordinator.record.model).toEqual(model(300));
  });

  it('cancels a restore if an edit arrived while its preliminary save was pending', async () => {
    const { coordinator, repository, saved, journal } = setup();
    const first = deferred<DiagramRecord>();
    repository.save.mockReturnValueOnce(first.promise);
    const failed = expect(coordinator.restore('version', model(200))).rejects.toThrow(
      /changed during restore/,
    );
    await vi.advanceTimersByTimeAsync(0);
    coordinator.save(model(300));
    first.resolve(saved(model(200)));
    await failed;
    expect(repository.restoreVersion).not.toHaveBeenCalled();
    expect(journal.read()?.model).toEqual(model(300));
    await coordinator.flush();
    expect(coordinator.record.model).toEqual(model(300));
  });

  it('keeps the current model when the restore transaction fails', async () => {
    const { coordinator, repository } = setup();
    repository.restoreVersion.mockRejectedValueOnce(new Error('aborted'));
    await expect(coordinator.restore('version', model(300))).rejects.toThrow('aborted');
    expect(coordinator.status).toBe('error');
    expect(coordinator.record.model).toEqual(model(300));
  });

  it('refuses to apply a stale restore result over edits made while it was in flight', async () => {
    const { coordinator, repository, saved, journal } = setup();
    const restoring = deferred<DiagramRecord>();
    repository.restoreVersion.mockReturnValueOnce(restoring.promise);
    const failed = expect(coordinator.restore('version', model(200))).rejects.toThrow(
      /changed during restore/,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.restoreVersion).toHaveBeenCalledTimes(1);
    coordinator.save(model(400));
    restoring.resolve(saved(model(50)));
    await failed;
    expect(coordinator.record.model).toEqual(model(400));
    expect(journal.read()?.model).toEqual(model(400));
    await coordinator.flush();
    expect(repository.save.mock.calls.at(-1)?.[1]).toEqual(model(400));
  });
});

describe('IndexedDB integration', () => {
  it('restores the oldest of 50 versions after the autosnapshot interval has expired', async () => {
    vi.useRealTimers();
    const repository = new LocalDiagramRepository({ dbName: 'coordinator-oldest-restore' });
    try {
      let record = await repository.create({ title: 'History', model: model(100) });
      for (let i = 0; i < 50; i++) {
        record = await repository.save(record.id, model(200 + i), { snapshot: true });
      }
      const versions = await repository.listVersions(record.id);
      const oldest = versions.at(-1)!;
      expect(versions).toHaveLength(50);
      const coordinator = new SaveCoordinator(
        repository,
        record,
        new DraftJournal(setup().storage, 'session', record),
      );
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
      const restored = await coordinator.restore(oldest.id, model(999));
      expect(restored.model).toEqual(oldest.model);
      const after = await repository.listVersions(record.id);
      expect(after).toHaveLength(50);
      expect(after[0].label).toBe('before restore');
      expect(after[0].model).toEqual(model(999));
    } finally {
      await repository.close();
    }
  });

  it('recovers and confirms a journal, snapshots the current model, then restores without pending-write races', async () => {
    vi.useRealTimers();
    const repository = new LocalDiagramRepository({ dbName: 'coordinator-integration' });
    try {
      const record = await repository.create({ title: 'Integration', model: model(100) });
      const { storage } = setup();
      const journal = new DraftJournal(storage, 'session', record);
      journal.write({
        version: 1,
        revision: 'recover',
        baseUpdatedAt: record.updatedAt,
        model: model(200),
      });
      const coordinator = new SaveCoordinator(repository, record, journal);
      await coordinator.snapshot(coordinator.record.model);
      const [version] = await repository.listVersions(record.id);
      expect(version.model).toEqual(model(200));
      coordinator.save(model(300));
      await coordinator.restore(version.id, model(300));
      expect((await repository.get(record.id))?.model).toEqual(model(200));
      expect((await repository.listVersions(record.id))[0].model).toEqual(model(300));
      expect(journal.read()).toBeNull();
    } finally {
      await repository.close();
    }
  });

  it('retains the journal and rejects confirmation on a transaction abort, then retries', async () => {
    vi.useRealTimers();
    const repository = new LocalDiagramRepository({ dbName: 'coordinator-abort-integration' });
    try {
      const record = await repository.create({ title: 'Integration', model: model(100) });
      const journal = new DraftJournal(setup().storage, 'session', record);
      const coordinator = new SaveCoordinator(repository, record, journal);
      const put = IDBObjectStore.prototype.put;
      const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value,
        key,
      ) {
        const request = put.call(this, value, key);
        if (this.name === 'diagrams') {
          request.addEventListener('success', () => this.transaction.abort(), { once: true });
        }
        return request;
      });
      await expect(coordinator.snapshot(model(300))).rejects.toThrow();
      expect(coordinator.status).toBe('error');
      expect(journal.read()?.model).toEqual(model(300));
      expect(await repository.get(record.id)).toEqual(record);
      expect(await repository.listVersions(record.id)).toEqual([]);
      failure.mockRestore();
      await coordinator.snapshot(model(300));
      expect(coordinator.status).toBe('saved');
      expect((await repository.listVersions(record.id))[0].model).toEqual(model(300));
      expect(journal.read()).toBeNull();
    } finally {
      await repository.close();
    }
  });

  it('rejects a competing editor without losing its draft or replaying it on reload', async () => {
    vi.useRealTimers();
    const repository = new LocalDiagramRepository({ dbName: 'coordinator-conflict-integration' });
    try {
      const record = await repository.create({ title: 'Integration', model: model(100) });
      const storage = setup().storage;
      const first = new SaveCoordinator(
        repository,
        record,
        new DraftJournal(storage, 'first-tab', record),
      );
      const journal = new DraftJournal(storage, 'second-tab', record);
      const second = new SaveCoordinator(repository, record, journal);
      first.save(model(200));
      await first.flush();
      second.save(model(300));
      await expect(second.flush()).rejects.toThrow(/another editor/);
      // A stale revision is a conflict, not a generic failure: the interface
      // offers the other side's copy rather than a blind retry.
      expect(second.status).toBe('conflict');
      expect(second.remoteConflict?.mine).toEqual(model(300));
      expect(journal.read()?.model).toEqual(model(300));
      const saved = (await repository.get(record.id))!;
      expect(saved.model).toEqual(model(200));
      const reloaded = new SaveCoordinator(repository, saved, journal);
      expect(reloaded.record.model).toEqual(model(200));
      expect(reloaded.recoveryConflict?.model).toEqual(model(300));
    } finally {
      await repository.close();
    }
  });
});

describe('remote revisions', () => {
  it('adopts a remote save as the new baseline when nothing is pending', () => {
    const { coordinator, saved, onChange } = setup();
    const theirs = saved(model(500));
    expect(coordinator.adoptRemote(theirs)).toBe('adopted');
    expect(coordinator.record.model).toEqual(model(500));
    expect(coordinator.confirmedUpdatedAt).toBe(theirs.updatedAt);
    expect(coordinator.status).toBe('saved');
    expect(onChange).toHaveBeenCalled();
  });

  it('turns a remote save into a conflict when a local edit is pending, without losing either', () => {
    const { coordinator, saved } = setup();
    coordinator.save(model(200));
    const theirs = saved(model(500));
    expect(coordinator.adoptRemote(theirs)).toBe('conflict');
    expect(coordinator.status).toBe('conflict');
    expect(coordinator.remoteConflict?.theirs).toEqual(theirs);
    expect(coordinator.remoteConflict?.mine).toEqual(model(200));
    // The local edit is still what this editor shows.
    expect(coordinator.record.model).toEqual(model(200));
  });

  it('accepting the remote side drops the local draft and its journal entry', () => {
    const { coordinator, saved, journal } = setup();
    coordinator.save(model(200));
    expect(journal.read()).not.toBeNull();
    const theirs = saved(model(500));
    coordinator.adoptRemote(theirs);
    expect(coordinator.acceptRemote()).toEqual(theirs);
    expect(coordinator.record.model).toEqual(model(500));
    expect(coordinator.hasPending).toBe(false);
    expect(journal.read()).toBeNull();
    expect(coordinator.status).toBe('saved');
  });

  it('reports a 412 from the store as a conflict carrying the server copy', async () => {
    const { coordinator, repository, saved } = setup();
    const theirs = saved(model(900));
    class Stale extends DiagramConflictError {
      current = theirs;
    }
    repository.save.mockRejectedValueOnce(new Stale());
    coordinator.save(model(200));
    await expect(coordinator.flush()).rejects.toBeInstanceOf(DiagramConflictError);
    expect(coordinator.status).toBe('conflict');
    expect(coordinator.remoteConflict?.theirs).toEqual(theirs);
    expect(coordinator.remoteConflict?.mine).toEqual(model(200));
  });

  it('tells an echo of its own save apart from a new revision', () => {
    // The server publishes every save to every subscriber, this editor
    // included. Its own commit coming back must not be mistaken for news —
    // that is how a diagram once re-saved itself in a loop.
    const { coordinator, base } = setup();
    expect(coordinator.adoptRemote({ ...base, id: 'other' })).toBe('foreign');
    expect(coordinator.adoptRemote(base)).toBe('same');
    expect(coordinator.status).toBe('saved');
  });
});
