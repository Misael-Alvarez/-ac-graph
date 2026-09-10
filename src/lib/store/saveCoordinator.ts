import type { DiagramModel, DiagramRecord } from '@/lib/domain';
import { uid } from '@/lib/engine';
import { DraftJournal, type DiagramDraft } from './draftJournal';
import { DiagramConflictError } from './localRepository';
import type { DiagramRepository, SaveOptions } from './types';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

/**
 * Another editor saved a newer revision while this one held unsaved changes.
 *
 * `theirs` is what the server has now when the repository could tell us; the
 * interface offers to load it or to download the local copy. Nothing is merged
 * automatically: a diagram is not a text file, and a silent merge that moved
 * somebody's boxes would be worse than asking.
 */
export interface RemoteConflict {
  theirs: DiagramRecord | null;
  mine: DiagramModel;
}
export const AUTOSAVE_DEBOUNCE_MS = 1200;
const SNAPSHOT_INTERVAL_MS = 5 * 60_000;

/** One writer per open document. Failed writes never put an older model back in pending. */
export class SaveCoordinator {
  status: SaveStatus = 'saved';
  recoveryConflict: DiagramDraft | null = null;
  remoteConflict: RemoteConflict | null = null;
  private pending: DiagramDraft | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  // Zero, so the first confirmed edit of a session snapshots the state that was
  // opened: the history always offers a way back to what the reader started from.
  private lastSnapshot = 0;
  private generation = 0;
  private journalFailed = false;

  constructor(
    private readonly repository: Pick<DiagramRepository, 'save' | 'restoreVersion'>,
    private confirmed: DiagramRecord,
    private readonly journal: DraftJournal | null,
    private readonly onChange: () => void = () => {},
  ) {
    try {
      this.pending = journal?.recover(confirmed) ?? null;
      this.recoveryConflict = journal?.read(true) ?? null;
      if (this.pending) this.status = 'pending';
    } catch {
      this.status = 'error';
      try {
        // Archiving can itself hit quota. The original is still in the journal
        // and must remain available to download, even if it cannot be moved.
        this.recoveryConflict = journal?.read() ?? null;
      } catch {
        // Storage access itself may be denied.
      }
    }
  }

  get record(): DiagramRecord {
    return this.pending
      ? {
          ...this.confirmed,
          model: this.pending.model,
          title: this.pending.title ?? this.confirmed.title,
        }
      : this.confirmed;
  }

  save(model: DiagramModel): void {
    this.stage(model, this.pending?.title);
    this.schedule();
  }

  rename(title: string): Promise<void> {
    this.stage(this.record.model, title);
    return this.flush();
  }

  snapshot(model: DiagramModel): Promise<void> {
    this.stage(model, this.pending?.title);
    const snapshotModel = structuredClone(model);
    this.cancelTimer();
    return this.enqueue(async () => {
      // An earlier queued save may already have committed a newer edit. Snapshot
      // the click's model without rolling that newer document back to it.
      await this.write(this.pending ?? this.draft(this.confirmed.model), { snapshotModel });
    });
  }

  restore(versionId: string, model: DiagramModel): Promise<DiagramRecord> {
    this.stage(model, this.pending?.title);
    const generation = this.generation;
    this.cancelTimer();
    return this.enqueue(async () => {
      if (this.pending) await this.write(this.pending, { snapshot: false });
      if (generation !== this.generation) throw new Error('The diagram changed during restore.');
      const restored = await this.repository.restoreVersion(this.confirmed.id, versionId, {
        expectedUpdatedAt: this.confirmed.updatedAt,
      });
      this.confirmed = restored;
      this.lastSnapshot = Date.now();
      if (this.pending) {
        this.pending = { ...this.pending, baseUpdatedAt: restored.updatedAt };
        this.persistDraft();
      }
      if (generation !== this.generation) throw new Error('The diagram changed during restore.');
      return restored;
    });
  }

  /** Also used on navigation/pagehide. The journal has already been written by stage(). */
  flush(): Promise<void> {
    this.cancelTimer();
    return this.enqueue(async () => {
      if (this.pending) await this.write(this.pending);
    });
  }

  /** Whether an unsaved local edit exists. */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** The revision this editor believes the store holds. */
  get confirmedUpdatedAt(): string {
    return this.confirmed.updatedAt;
  }

  /**
   * Takes a revision somebody else saved as the new baseline.
   *
   * `adopted` means the baseline moved and the caller should show the record.
   * `same` means this editor already holds that revision — its own save echoed
   * back — and nothing should change; treating that as new is how an editor
   * once saved the same diagram in a loop. With a local edit in flight the
   * remote change becomes a `conflict` for the person to resolve, never a
   * silent overwrite of either side.
   */
  adoptRemote(record: DiagramRecord): 'adopted' | 'same' | 'conflict' | 'foreign' {
    if (record.id !== this.confirmed.id) return 'foreign';
    if (record.updatedAt === this.confirmed.updatedAt) return 'same';
    if (this.pending) {
      this.remoteConflict = { theirs: record, mine: this.pending.model };
      this.status = 'conflict';
      this.onChange();
      return 'conflict';
    }
    this.confirmed = record;
    this.remoteConflict = null;
    this.status = 'saved';
    this.onChange();
    return 'adopted';
  }

  /**
   * Resolves a conflict by taking the other side's revision and dropping the
   * local edit. The caller has already offered to download the local copy.
   */
  acceptRemote(): DiagramRecord | null {
    const theirs = this.remoteConflict?.theirs ?? null;
    if (!theirs) return null;
    this.cancelTimer();
    this.pending = null;
    try {
      this.journal?.discard();
    } catch {
      // Storage may be denied; the draft is stale against the new base anyway.
    }
    this.confirmed = theirs;
    this.remoteConflict = null;
    this.status = 'saved';
    this.onChange();
    return theirs;
  }

  private draft(model: DiagramModel, title?: string): DiagramDraft {
    return {
      version: 1,
      revision: uid('edit'),
      baseUpdatedAt: this.confirmed.updatedAt,
      model: structuredClone(model),
      ...(title === undefined ? {} : { title }),
    };
  }

  private stage(model: DiagramModel, title?: string): void {
    this.generation++;
    this.pending = this.draft(model, title);
    this.journalFailed = !this.persistDraft();
    this.status = this.journalFailed ? 'error' : 'pending';
    this.onChange();
  }

  private persistDraft(): boolean {
    if (!this.pending) return true;
    try {
      if (!this.journal) return false;
      this.journal.write(this.pending);
      return true;
    } catch {
      return false;
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.cancelTimer();
    // If journalling is unavailable, try IndexedDB without a debounce window.
    this.timer = setTimeout(
      () => void this.flush().catch(() => {}),
      this.status === 'error' ? 0 : AUTOSAVE_DEBOUNCE_MS,
    );
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      this.status = 'saving';
      this.onChange();
      try {
        const value = await operation();
        this.status = this.pending ? (this.journalFailed ? 'error' : 'pending') : 'saved';
        this.onChange();
        return value;
      } catch (error) {
        if (error instanceof DiagramConflictError) {
          const theirs = (error as { current?: DiagramRecord | null }).current ?? null;
          this.remoteConflict = { theirs, mine: this.pending?.model ?? this.confirmed.model };
          this.status = 'conflict';
        } else {
          this.status = 'error';
        }
        this.onChange();
        throw error;
      }
    });
    // Rejections are returned to explicit callers, but cannot poison the queue.
    this.tail = result.catch(() => {});
    return result;
  }

  private async write(draft: DiagramDraft, options: SaveOptions = {}): Promise<void> {
    this.journalFailed = !this.persistDraft();
    // An automatic snapshot keeps the content about to be replaced. A blank
    // canvas holds nothing to go back to, so it earns no row in the history and
    // the interval stays open until there is something worth keeping.
    const worthKeeping =
      this.confirmed.model.shapes.length > 0 || this.confirmed.model.connectors.length > 0;
    const snapshot =
      options.snapshot ??
      (!options.snapshotModel &&
        worthKeeping &&
        Date.now() - this.lastSnapshot >= SNAPSHOT_INTERVAL_MS);
    const saved = await this.repository.save(this.confirmed.id, draft.model, {
      ...options,
      snapshot,
      metadata: draft.title === undefined ? undefined : { title: draft.title },
      expectedUpdatedAt: this.confirmed.updatedAt,
    });
    this.confirmed = saved;
    if (snapshot || options.snapshotModel) this.lastSnapshot = Date.now();
    if (this.pending?.revision === draft.revision) {
      this.pending = null;
    } else if (this.pending) {
      this.pending = { ...this.pending, baseUpdatedAt: saved.updatedAt };
    }
    try {
      this.journal?.acknowledge(draft);
    } catch {
      // The DB commit is confirmed. A leftover journal is checked against its
      // base on reload, never blindly replayed over this or a later restore.
    }
    this.journalFailed = !this.persistDraft();
  }
}
