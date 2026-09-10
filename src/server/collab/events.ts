import { singleton } from '../globals';
import { appMetrics } from '../observability/metrics';
import type { PresenceUser } from './presence';

/**
 * Per-diagram fan-out for the SSE stream.
 *
 * A saved commit, a title change, a deletion or a presence update is published
 * once and delivered to every open `/events` connection for that diagram in
 * this process. Cross-replica delivery is a known limit of this phase.
 */
export type DiagramEvent =
  | { type: 'saved'; updatedAt: string; by: { id: string; name: string } }
  | { type: 'presence'; users: PresenceUser[] }
  | { type: 'deleted' }
  | { type: 'meta'; title: string };

export type Subscriber = (event: DiagramEvent) => void;

export class EventHub {
  private readonly rooms = new Map<string, Set<Subscriber>>();

  subscribe(diagramId: string, subscriber: Subscriber): () => void {
    let room = this.rooms.get(diagramId);
    if (!room) {
      room = new Set();
      this.rooms.set(diagramId, room);
    }
    room.add(subscriber);
    return () => {
      const current = this.rooms.get(diagramId);
      if (!current) return;
      current.delete(subscriber);
      if (current.size === 0) this.rooms.delete(diagramId);
    };
  }

  /** Delivers to every subscriber; one throwing listener cannot starve the rest. */
  publish(diagramId: string, event: DiagramEvent): number {
    appMetrics().sseEvents.inc({ type: event.type });
    const room = this.rooms.get(diagramId);
    if (!room) return 0;
    let delivered = 0;
    for (const subscriber of [...room]) {
      try {
        subscriber(event);
        delivered++;
      } catch {
        // A closed stream throws on write; it will unsubscribe itself.
      }
    }
    return delivered;
  }

  subscriberCount(diagramId: string): number {
    return this.rooms.get(diagramId)?.size ?? 0;
  }
}

export function events(): EventHub {
  return singleton('events', () => new EventHub());
}

export function publish(diagramId: string, event: DiagramEvent): number {
  return events().publish(diagramId, event);
}

/** Wire format of one SSE message: the event name, then the whole object as JSON. */
export function formatSse(event: { type: string; [key: string]: unknown }): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
