import type { User } from '@/lib/domain';
import { events, formatSse, type DiagramEvent } from './events';
import { presence, type PresenceUser } from './presence';

/**
 * One SSE connection for one viewer of one diagram.
 *
 * Joining publishes the new presence list to everyone, including this
 * connection, which is how the client receives its initial roster. A heartbeat
 * comment every `HEARTBEAT_MS` keeps proxies from closing an idle stream and
 * refreshes this viewer's presence, so an open stream alone keeps a user
 * "here" even if their cursor never moves.
 */
export const HEARTBEAT_MS = 15_000;

/** What goes over the wire: `sessionKey` stays server-side, `self` is per connection. */
export interface WirePresenceUser {
  id: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  editing: boolean;
  self: boolean;
}

export type WireEvent =
  Exclude<DiagramEvent, { type: 'presence' }> | { type: 'presence'; users: WirePresenceUser[] };

export function toWire(event: DiagramEvent, sessionKey: string): WireEvent {
  if (event.type !== 'presence') return event;
  return {
    type: 'presence',
    users: event.users.map((user: PresenceUser) => ({
      id: user.id,
      name: user.name,
      color: user.color,
      cursor: user.cursor,
      editing: user.editing,
      self: user.sessionKey === sessionKey,
    })),
  };
}

export interface StreamOptions {
  diagramId: string;
  user: User;
  sessionKey: string;
  signal: AbortSignal;
  heartbeatMs?: number;
}

export function openDiagramStream(options: StreamOptions): Response {
  const { diagramId, user, sessionKey, signal } = options;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const hub = events();
  const registry = presence();
  const encoder = new TextEncoder();

  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const unsubscribe = hub.subscribe(diagramId, (event) => {
        write(formatSse(toWire(event, sessionKey)));
      });

      const heartbeat = setInterval(() => {
        write(': ping\n\n');
        registry.touch(diagramId, sessionKey, user);
      }, heartbeatMs);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        signal.removeEventListener('abort', cleanup);
        if (registry.leave(diagramId, sessionKey)) {
          hub.publish(diagramId, { type: 'presence', users: registry.list(diagramId) });
        }
        try {
          controller.close();
        } catch {
          // Already closed by the runtime when the client went away.
        }
      };

      if (signal.aborted) {
        cleanup();
        return;
      }
      signal.addEventListener('abort', cleanup);

      registry.touch(diagramId, sessionKey, user);
      hub.publish(diagramId, { type: 'presence', users: registry.list(diagramId) });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // Tells nginx-style proxies to pass events through as they are written.
      'X-Accel-Buffering': 'no',
    },
  });
}
