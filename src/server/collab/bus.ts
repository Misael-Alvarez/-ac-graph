import { z } from 'zod';
import { log, type Logger } from '../observability/log';
import { appMetrics } from '../observability/metrics';

/**
 * The bus between replicas.
 *
 * A message published on one process reaches every process — the publisher
 * included, which filters its own by `origin`. PostgreSQL's `LISTEN/NOTIFY` is
 * the transport in server mode: the database is already the one thing every
 * replica shares, and a few hundred small notifications a second are nothing
 * to it. `MemoryBus` is the same contract inside one process, for local mode
 * and for tests that stand up two replicas side by side.
 *
 * Delivery is best effort. A notification is lost when a replica's listening
 * connection is down, and presence heals through heartbeats within the TTL;
 * saves stay correct because the database, not the bus, decides them.
 */
export const BUS_CHANNEL = 'acgraph_collab';

/** `pg_notify` refuses payloads of 8000 bytes or more; stay clear of the edge. */
export const MAX_PAYLOAD_BYTES = 7_900;

const Origin = z.string().min(1).max(64);
const Id = z.string().min(1).max(200);

const CursorSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

/** Only what a remote roster needs; e-mail and avatar stay on the replica that has the session. */
const BusUserSchema = z.object({ id: Id, name: z.string().max(200) });

const RoomEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('saved'),
    updatedAt: z.string(),
    by: z.object({ id: Id, name: z.string() }),
  }),
  z.object({ type: z.literal('deleted') }),
  z.object({ type: z.literal('meta'), title: z.string() }),
  z.object({
    type: z.literal('access'),
    userId: Id,
    role: z.enum(['owner', 'editor', 'viewer']).nullable(),
    by: z.object({ id: Id, name: z.string() }),
  }),
  z.object({
    type: z.literal('comment'),
    threadId: Id,
    action: z.enum(['created', 'replied', 'resolved', 'reopened', 'deleted']),
    by: z.object({ id: Id, name: z.string() }),
  }),
]);

export const BusMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    v: z.literal(1),
    origin: Origin,
    diagramId: Id,
    kind: z.literal('event'),
    event: RoomEventSchema,
  }),
  z.object({
    v: z.literal(1),
    origin: Origin,
    diagramId: Id,
    kind: z.literal('touch'),
    sessionKey: Id,
    user: BusUserSchema,
    /** Absolute state after the local merge, so a lost message never leaves a stale patch behind. */
    cursor: CursorSchema.nullable(),
    editing: z.boolean(),
  }),
  z.object({
    v: z.literal(1),
    origin: Origin,
    diagramId: Id,
    kind: z.literal('leave'),
    sessionKey: Id,
  }),
]);

export type BusMessage = z.infer<typeof BusMessageSchema>;
export type RoomEvent = z.infer<typeof RoomEventSchema>;
export type BusListener = (message: BusMessage) => void;

export interface Bus {
  /** Sends to every replica. Never throws: a lost message is logged and counted. */
  publish(message: BusMessage): Promise<void>;
  subscribe(listener: BusListener): () => void;
  close(): Promise<void>;
}

/** Turns a raw payload into a message, or nothing when it is not one of ours. */
export function decode(payload: string): BusMessage | null {
  try {
    const parsed = BusMessageSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function deliver(listeners: Iterable<BusListener>, message: BusMessage): void {
  for (const listener of [...listeners]) {
    try {
      listener(message);
    } catch (thrown) {
      log().warn('bus listener failed', { err: thrown, kind: message.kind });
    }
  }
}

export class MemoryBus implements Bus {
  private readonly listeners = new Set<BusListener>();

  async publish(message: BusMessage): Promise<void> {
    appMetrics().busMessages.inc({ direction: 'sent', kind: message.kind });
    deliver(this.listeners, message);
  }

  subscribe(listener: BusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.listeners.clear();
  }
}

/** The slice of a `pg.Client` the bus needs, so tests can stand in for it. */
export interface ListenClient {
  query(text: string): Promise<unknown>;
  on(
    event: 'notification',
    listener: (message: { channel: string; payload?: string }) => void,
  ): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  end(): Promise<void>;
}

export interface PgBusOptions {
  /** Opens a fresh, connected client dedicated to `LISTEN`. */
  connect: () => Promise<ListenClient>;
  /** Runs `pg_notify` on any pooled connection. */
  notify: (channel: string, payload: string) => Promise<void>;
  channel?: string;
  /** Reconnection delays in milliseconds; the last one repeats. */
  backoffMs?: readonly number[];
  logger?: Logger;
}

export const DEFAULT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;

/**
 * `LISTEN` on a dedicated connection — a pooled client cannot be reserved for
 * the lifetime of the process — and `NOTIFY` through the pool. When the
 * listening connection drops, it comes back with a growing delay; while it is
 * down, notifications from other replicas are lost, local delivery is not.
 */
export class PgBus implements Bus {
  private readonly listeners = new Set<BusListener>();
  private readonly channel: string;
  private readonly backoff: readonly number[];
  private client: ListenClient | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private connecting: Promise<void> | null = null;

  constructor(private readonly options: PgBusOptions) {
    this.channel = options.channel ?? BUS_CHANNEL;
    this.backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  private get logger(): Logger {
    return this.options.logger ?? log();
  }

  /** Opens the listening connection; resolves once `LISTEN` is active or a retry is scheduled. */
  start(): Promise<void> {
    this.connecting ??= this.connectOnce().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  /** True while a connection is listening. */
  get connected(): boolean {
    return this.client !== null;
  }

  async publish(message: BusMessage): Promise<void> {
    const { busMessages, busDropped } = appMetrics();
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
      busDropped.inc({ reason: 'too_large' });
      this.logger.warn('bus message too large', {
        kind: message.kind,
        bytes: Buffer.byteLength(payload),
      });
      return;
    }
    try {
      await this.options.notify(this.channel, payload);
      busMessages.inc({ direction: 'sent', kind: message.kind });
    } catch (thrown) {
      busDropped.inc({ reason: 'publish_failed' });
      this.logger.warn('bus publish failed', { err: thrown, kind: message.kind });
    }
  }

  subscribe(listener: BusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const client = this.client;
    this.client = null;
    appMetrics().busConnected.set(0);
    this.listeners.clear();
    await client?.end().catch(() => {});
  }

  private async connectOnce(): Promise<void> {
    if (this.closed) return;
    let client: ListenClient;
    try {
      client = await this.options.connect();
      await client.query(`listen ${this.channel}`);
    } catch (thrown) {
      this.logger.warn('bus could not connect', { err: thrown, retryInMs: this.nextDelay() });
      this.scheduleReconnect();
      return;
    }
    if (this.closed) {
      await client.end().catch(() => {});
      return;
    }

    let gone = false;
    const lost = (thrown?: Error) => {
      if (gone) return;
      gone = true;
      if (this.client === client) {
        this.client = null;
        appMetrics().busConnected.set(0);
      }
      client.end().catch(() => {});
      if (this.closed) return;
      this.logger.warn('bus disconnected', {
        err: thrown,
        retryInMs: this.nextDelay(),
      });
      this.scheduleReconnect();
    };
    client.on('error', lost);
    client.on('end', () => lost());
    client.on('notification', (notification) => {
      if (notification.channel !== this.channel || !notification.payload) return;
      const message = decode(notification.payload);
      if (!message) {
        appMetrics().busDropped.inc({ reason: 'invalid' });
        this.logger.debug('bus message ignored: not ours');
        return;
      }
      deliver(this.listeners, message);
    });

    this.client = client;
    if (this.attempt > 0) appMetrics().busReconnects.inc();
    this.attempt = 0;
    appMetrics().busConnected.set(1);
    this.logger.info('bus connected', { channel: this.channel });
  }

  private nextDelay(): number {
    return this.backoff[Math.min(this.attempt, this.backoff.length - 1)];
  }

  private scheduleReconnect(): void {
    if (this.closed || this.timer) return;
    const delay = this.nextDelay();
    this.attempt++;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.start();
    }, delay);
    // A pending reconnect must not keep a stopping process alive.
    (this.timer as { unref?: () => void }).unref?.();
  }
}
