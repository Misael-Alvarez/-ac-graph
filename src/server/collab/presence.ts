import type { User } from '@/lib/domain';
import { singleton } from '../globals';

/**
 * Who is looking at which diagram, right now.
 *
 * Kept in process memory: presence is ephemeral by nature and a restart losing
 * it costs nothing. With several replicas each one only knows its own viewers,
 * which is documented as a known limit of this phase.
 */
export const PRESENCE_TTL_MS = 15_000;

/** Eight distinguishable colours that read on both the light and the dark canvas. */
export const PRESENCE_PALETTE = [
  '#e5484d', // red
  '#f76b15', // orange
  '#ffb224', // amber
  '#30a46c', // green
  '#12a594', // teal
  '#0090ff', // blue
  '#6e56cf', // violet
  '#e93d82', // pink
] as const;

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

/** Deterministic: the same person is the same colour in every tab and on every screen. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PRESENCE_PALETTE[Math.abs(hash) % PRESENCE_PALETTE.length];
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
