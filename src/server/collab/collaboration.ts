import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { User } from '@/lib/domain';
import { getPool } from '../db';
import { serverEnv, serverMode } from '../env';
import { peekSingleton, resetSingleton, singleton } from '../globals';
import { rootLogger } from '../observability/log';
import { appMetrics } from '../observability/metrics';
import { MemoryBus, PgBus, type Bus, type BusMessage, type RoomEvent } from './bus';
import { events, type EventHub } from './events';
import { presence, type Cursor, type PresenceRegistry, type PresenceUser } from './presence';

/**
 * The live layer, seen from one replica.
 *
 * Everything that happens here is applied locally first — the hub delivers to
 * this process's streams, the registry records the viewer — and then told to
 * the other replicas over the bus. What arrives from the bus is applied the
 * same way, minus the telling. Messages this replica sent come back to it too
 * (that is how `NOTIFY` works) and are recognised by `origin` and skipped.
 *
 * Presence travels as absolute state per session: "this session, this user,
 * this cursor, editing or not". A replica that missed a message is corrected
 * by the next heartbeat, and a replica that disappears takes its viewers with
 * it once the TTL runs out — no leave message required.
 */
export interface PresencePatch {
  cursor?: Cursor | null;
  editing?: boolean;
}

export interface CollaborationOptions {
  origin?: string;
  hub: EventHub;
  registry: PresenceRegistry;
  bus: Bus;
}

export class Collaboration {
  readonly origin: string;
  private readonly hub: EventHub;
  private readonly registry: PresenceRegistry;
  private readonly bus: Bus;
  private stop: (() => void) | null = null;

  constructor(options: CollaborationOptions) {
    this.origin = options.origin ?? randomUUID();
    this.hub = options.hub;
    this.registry = options.registry;
    this.bus = options.bus;
  }

  /** Starts applying what other replicas say. Idempotent. */
  start(): void {
    this.stop ??= this.bus.subscribe((message) => this.receive(message));
  }

  async close(): Promise<void> {
    this.stop?.();
    this.stop = null;
    await this.bus.close();
  }

  /** A save, a title change or a deletion: to this replica's streams, then to the rest. */
  publish(diagramId: string, event: RoomEvent): void {
    this.hub.publish(diagramId, event);
    this.send({ v: 1, origin: this.origin, diagramId, kind: 'event', event });
  }

  /**
   * A viewer is here (join, heartbeat, cursor move). `announce` sends the roster
   * to this replica's streams; heartbeats keep it false because nothing visible
   * changed. Other replicas always hear about it, so their TTL for this viewer
   * is refreshed too.
   */
  touch(
    diagramId: string,
    sessionKey: string,
    user: User,
    patch: PresencePatch = {},
    options: { announce?: boolean } = {},
  ): void {
    const entry = this.registry.touch(diagramId, sessionKey, user, patch);
    if (options.announce) this.announce(diagramId);
    this.send({
      v: 1,
      origin: this.origin,
      diagramId,
      kind: 'touch',
      sessionKey,
      user: { id: user.id, name: user.name },
      cursor: entry.cursor,
      editing: entry.editing,
    });
  }

  /** A viewer left. Returns whether the roster changed here. */
  leave(diagramId: string, sessionKey: string): boolean {
    const removed = this.registry.leave(diagramId, sessionKey);
    if (removed) this.announce(diagramId);
    this.send({ v: 1, origin: this.origin, diagramId, kind: 'leave', sessionKey });
    return removed;
  }

  roster(diagramId: string): PresenceUser[] {
    return this.registry.list(diagramId);
  }

  private announce(diagramId: string): void {
    this.hub.publish(diagramId, { type: 'presence', users: this.registry.list(diagramId) });
  }

  private send(message: BusMessage): void {
    // Best effort by design; the bus logs and counts what it cannot deliver.
    void this.bus.publish(message);
  }

  private receive(message: BusMessage): void {
    // NOTIFY hands every message back to its sender too; that is the echo.
    const own = message.origin === this.origin;
    appMetrics().busMessages.inc({ direction: own ? 'echo' : 'received', kind: message.kind });
    if (own) return;
    switch (message.kind) {
      case 'event':
        this.hub.publish(message.diagramId, message.event);
        return;
      case 'touch': {
        const before = this.registry.peek(message.diagramId, message.sessionKey);
        this.registry.touch(message.diagramId, message.sessionKey, message.user, {
          cursor: message.cursor,
          editing: message.editing,
        });
        const changed =
          !before ||
          before.editing !== message.editing ||
          !sameCursor(before.cursor, message.cursor);
        if (changed) this.announce(message.diagramId);
        return;
      }
      case 'leave':
        if (this.registry.leave(message.diagramId, message.sessionKey)) {
          this.announce(message.diagramId);
        }
        return;
    }
  }
}

function sameCursor(a: Cursor | null, b: Cursor | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

const KEY = 'collaboration';

/**
 * This process's live layer: over PostgreSQL in server mode, in memory
 * otherwise. Created on first use; the listening connection opens in the
 * background and retries on its own.
 */
export function collaboration(): Collaboration {
  return singleton(KEY, () => {
    const bus = serverMode() ? pgBus() : new MemoryBus();
    const instance = new Collaboration({ hub: events(), registry: presence(), bus });
    instance.start();
    if (bus instanceof PgBus) void bus.start();
    return instance;
  });
}

function pgBus(): PgBus {
  return new PgBus({
    connect: async () => {
      const client = new Client({
        connectionString: serverEnv().databaseUrl,
        connectionTimeoutMillis: 10_000,
        application_name: 'ac-graph-bus',
        // An idle LISTEN connection must survive NAT and proxy idle timeouts.
        keepAlive: true,
      });
      await client.connect();
      return client;
    },
    notify: async (channel, payload) => {
      await getPool().query('select pg_notify($1, $2)', [channel, payload]);
    },
    // Long-lived: the process logger, never the logger of whichever request came first.
    logger: rootLogger(),
  });
}

/** Closes the bus and forgets the instance. Tests and shutdown only. */
export async function closeCollaboration(): Promise<void> {
  const instance = peekSingleton<Collaboration>(KEY);
  resetSingleton(KEY);
  await instance?.close();
}
