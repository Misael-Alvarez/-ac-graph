import { PRESENCE_PALETTE, colorForUser } from '@/lib/collab/colors';
import type { User } from '@/lib/domain';
import { singleton } from '../globals';

/**
 * Who is looking at which diagram, right now.
 *
 * Kept in process memory: presence is ephemeral by nature and a restart losing
 * it costs nothing. Every replica holds the merged roster — its own viewers and
 * the ones other replicas announce over the bus (`collaboration.ts`) — and the
 * TTL retires whoever stops being heard from, including everyone behind a
 * replica that died.
 */
export const PRESENCE_TTL_MS = 15_000;

export { PRESENCE_PALETTE, colorForUser };

export interface Cursor {
  x: number;
  y: number;
}

export interface PresenceEntry {
  user: User;
  color: string;
  cursor: Cursor | null;
  editing: boolean;
  lastSeen: number;
}

/** What subscribers receive: one row per session, flagged `self` client-side. */
export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  cursor: Cursor | null;
  editing: boolean;
  /** Distinguishes two tabs of the same person. */
  sessionKey: string;
}

export class PresenceRegistry {
  private readonly rooms = new Map<string, Map<string, PresenceEntry>>();

  constructor(
    private readonly ttlMs = PRESENCE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a heartbeat; unspecified fields keep their previous value. */
  touch(
    diagramId: string,
    sessionKey: string,
    user: User,
    patch: { cursor?: Cursor | null; editing?: boolean } = {},
  ): PresenceEntry {
    const room = this.room(diagramId);
    const previous = room.get(sessionKey);
    const entry: PresenceEntry = {
      user,
      color: colorForUser(user.id),
      cursor: patch.cursor === undefined ? (previous?.cursor ?? null) : patch.cursor,
      editing: patch.editing ?? previous?.editing ?? false,
      lastSeen: this.now(),
    };
    room.set(sessionKey, entry);
    return entry;
  }

  /** One viewer's current entry, or nothing when unknown or expired. */
  peek(diagramId: string, sessionKey: string): PresenceEntry | undefined {
    const entry = this.rooms.get(diagramId)?.get(sessionKey);
    if (!entry) return undefined;
    return entry.lastSeen < this.now() - this.ttlMs ? undefined : entry;
  }

  leave(diagramId: string, sessionKey: string): boolean {
    const room = this.rooms.get(diagramId);
    if (!room) return false;
    const removed = room.delete(sessionKey);
    if (room.size === 0) this.rooms.delete(diagramId);
    return removed;
  }

  /** Everyone still within the TTL, oldest arrival first. Expired rows are dropped on the way. */
  list(diagramId: string): PresenceUser[] {
    const room = this.rooms.get(diagramId);
    if (!room) return [];
    const cutoff = this.now() - this.ttlMs;
    const users: PresenceUser[] = [];
    for (const [sessionKey, entry] of room) {
      if (entry.lastSeen < cutoff) {
        room.delete(sessionKey);
        continue;
      }
      users.push({
        id: entry.user.id,
        name: entry.user.name,
        color: entry.color,
        cursor: entry.cursor,
        editing: entry.editing,
        sessionKey,
      });
    }
    if (room.size === 0) this.rooms.delete(diagramId);
    return users;
  }

  /** Drops every expired entry in every room. */
  sweep(): void {
    for (const diagramId of [...this.rooms.keys()]) this.list(diagramId);
  }

  private room(diagramId: string): Map<string, PresenceEntry> {
    let room = this.rooms.get(diagramId);
    if (!room) {
      room = new Map();
      this.rooms.set(diagramId, room);
    }
    return room;
  }
}

/** The one registry every route in this process shares. */
export function presence(): PresenceRegistry {
  return singleton('presence', () => new PresenceRegistry());
}
