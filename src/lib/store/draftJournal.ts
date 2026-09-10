import { z } from 'zod';
import { DiagramModelSchema, type DiagramRecord } from '@/lib/domain';

export interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DraftSchema = z.object({
  version: z.literal(1),
  revision: z.string(),
  baseUpdatedAt: z.string(),
  model: DiagramModelSchema,
  title: z.string().optional(),
});

export type DiagramDraft = z.infer<typeof DraftSchema>;

/** Synchronous write-ahead journal. No browser globals, and no effect on backup schemas. */
export class DraftJournal {
  readonly key: string;
  private unarchivedConflict: DiagramDraft | null = null;

  constructor(
    private readonly storage: JournalStorage,
    session: string,
    record: Pick<DiagramRecord, 'id' | 'ownerId'>,
    private readonly isActive: () => boolean = () => true,
  ) {
    this.key = `ac-graph-draft:${[session, record.ownerId, record.id].map(encodeURIComponent).join(':')}`;
  }

  read(conflict = false): DiagramDraft | null {
    if (!this.isActive()) throw new Error('The draft session lease has been released.');
    const raw = this.storage.getItem(this.key + (conflict ? ':conflict' : ''));
    if (!raw) return null;
    try {
      const parsed = DraftSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  write(draft: DiagramDraft): void {
    if (!this.isActive()) throw new Error('The draft session lease has been released.');
    this.archiveConflict();
    this.storage.setItem(this.key, JSON.stringify(draft));
  }

  recover(record: DiagramRecord): DiagramDraft | null {
    const draft = this.read();
    if (!draft || draft.baseUpdatedAt === record.updatedAt) return draft;
    // A changed base may be another tab, a restore, or a commit interrupted before
    // its acknowledgement. Keep the draft exportable, but never guess and apply it.
    this.unarchivedConflict = draft;
    this.archiveConflict();
    this.storage.removeItem(this.key);
    return null;
  }

  acknowledge(written: DiagramDraft): void {
    const current = this.read();
    if (!this.unarchivedConflict && current?.revision === written.revision) {
      this.storage.removeItem(this.key);
    }
  }

  /**
   * Drops the active draft on purpose — the person chose the other side of a
   * conflict. An unarchived conflict copy is never touched by this.
   */
  discard(): void {
    if (!this.isActive()) throw new Error('The draft session lease has been released.');
    if (this.unarchivedConflict) return;
    this.storage.removeItem(this.key);
  }

  private archiveConflict(): void {
    if (!this.unarchivedConflict) return;
    // Until this copy succeeds, the active key is the conflict's only durable
    // copy. Neither a new edit nor its acknowledgement may reuse/delete it.
    this.storage.setItem(this.key + ':conflict', JSON.stringify(this.unarchivedConflict));
    this.unarchivedConflict = null;
  }
}
