import { singleton } from './globals';

/**
 * Strictly increasing ISO timestamps, mirroring `LocalDiagramRepository.now`.
 *
 * Domain timestamps are plain strings and optimistic concurrency compares them
 * for exact equality, so two writes must never share a stamp. `after` lets a
 * writer guarantee the new stamp also sorts after the row it just read, which
 * is what keeps `expectedUpdatedAt` meaningful even across several replicas:
 * the row is locked while the stamp is produced, so it is always newer than
 * whatever any other process wrote before.
 */
export type Clock = (after?: string) => string;

export function createClock(now: () => number = Date.now): Clock {
  let last = 0;
  return (after?: string) => {
    const previous = after ? Date.parse(after) : 0;
    const ms = Math.max(now(), last + 1, Number.isFinite(previous) ? previous + 1 : 0);
    last = ms;
    return new Date(ms).toISOString();
  };
}

/** The one clock every writer in this process shares. */
export function serverClock(): Clock {
  return singleton('clock', () => createClock());
}
