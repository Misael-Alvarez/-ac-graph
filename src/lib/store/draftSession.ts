import { uid } from '@/lib/engine';
import type { JournalStorage } from './draftJournal';

export const DRAFT_SESSION_KEY = 'ac-graph-draft-session';

export interface DraftSessionLocks {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: object | null) => Promise<void>,
  ): Promise<unknown>;
}

export interface DraftSessionLease {
  id: string;
  readonly active: boolean;
  release(): Promise<void>;
}

/** A copied sessionStorage id is only a candidate, never proof of ownership. */
export async function acquireDraftSession(
  storage: JournalStorage,
  locks?: DraftSessionLocks,
): Promise<DraftSessionLease | null> {
  // Without exclusive browser locks, do not read or replay a possibly shared journal.
  if (!locks) return null;
  for (const id of [storage.getItem(DRAFT_SESSION_KEY) || uid('session'), uid('session')]) {
    const lease = await new Promise<DraftSessionLease | null>((resolve, reject) => {
      let active = false;
      let unlock!: () => void;
      const held = new Promise<void>((release) => {
        unlock = release;
      });
      const completion = locks.request(
        `ac-graph-draft-session:${id}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolve(null);
            return;
          }
          active = true;
          resolve({
            id,
            get active() {
              return active;
            },
            async release() {
              // Revoke journal access synchronously, before another page can acquire it.
              active = false;
              unlock();
              await completion;
            },
          });
          await held;
        },
      );
      void completion.catch((error) => {
        active = false;
        unlock();
        reject(error);
      });
    });
    if (!lease) continue;
    try {
      storage.setItem(DRAFT_SESSION_KEY, lease.id);
    } catch (error) {
      await lease.release();
      throw error;
    }
    return lease;
  }
  return null;
}
