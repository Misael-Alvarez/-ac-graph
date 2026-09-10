import { performance } from 'node:perf_hooks';
import type { User } from '@/lib/domain';
import { log } from '../observability/log';
import { appMetrics } from '../observability/metrics';
import { collaboration } from './collaboration';
import { events, formatSse, type DiagramEvent } from './events';
import type { PresenceUser } from './presence';

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
  const room = collaboration();
  const encoder = new TextEncoder();
  const { sseConnections, sseConnectionsTotal } = appMetrics();
  // The request's logger, captured now: the stream outlives the request context.
  const logger = log();
  const openedAt = performance.now();

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
        // Refreshes this viewer here and on every other replica; nothing visible changed.
        room.touch(diagramId, sessionKey, user);
      }, heartbeatMs);

      sseConnections.inc();
      sseConnectionsTotal.inc();
      logger.debug('stream opened', { viewers: room.roster(diagramId).length + 1 });

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        signal.removeEventListener('abort', cleanup);
        sseConnections.dec();
        logger.debug('stream closed', {
          durationMs: Math.round(performance.now() - openedAt),
        });
        room.leave(diagramId, sessionKey);
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

      room.touch(diagramId, sessionKey, user, {}, { announce: true });
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
