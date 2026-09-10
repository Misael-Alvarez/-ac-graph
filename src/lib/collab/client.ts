/**
 * Browser side of the collaboration channel.
 *
 * One `EventSource` per open diagram receives `saved`, `meta`, `deleted`,
 * `access` and `presence` events; cursor and editing state go up through a small POST. The
 * transport is deliberately dumb — no operational transform, no CRDT — because
 * this phase only needs to tell an editor that somebody else saved, and to show
 * who else is looking.
 */
export interface Cursor {
  x: number;
  y: number;
}

export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  cursor?: Cursor | null;
  editing: boolean;
  /** True for the entry that is this very browser tab. */
  self?: boolean;
}

export interface SavedEvent {
  updatedAt: string;
  by: { id: string; name: string };
}

export interface MetaEvent {
  title: string;
}

/** Someone's access to the diagram changed; `role: null` means they were removed. */
export interface AccessEvent {
  userId: string;
  role: 'owner' | 'editor' | 'viewer' | null;
  by: { id: string; name: string };
}

export type CollabStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SubscriptionHandlers {
  onSaved?: (event: SavedEvent) => void;
  onPresence?: (users: PresenceUser[]) => void;
  onDeleted?: () => void;
  onMeta?: (event: MetaEvent) => void;
  onAccess?: (event: AccessEvent) => void;
  onStatus?: (status: CollabStatus) => void;
}

export interface PresencePayload {
  cursor?: Cursor | null;
  editing?: boolean;
}

export interface SubscribeOptions {
  /** Injected in tests. */
  EventSource?: typeof EventSource;
  fetch?: typeof fetch;
  baseUrl?: string;
  /** First retry delay; doubles up to `maxBackoffMs`. */
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** How often an open subscription confirms it is still here; 0 disables. */
  heartbeatMs?: number;
}

export interface SendPresenceOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

const REQUESTED_WITH_HEADER = 'x-requested-with';
const REQUESTED_WITH_VALUE = 'ac-graph';

export const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
export const DEFAULT_MAX_BACKOFF_MS = 30_000;
export const DEFAULT_HEARTBEAT_MS = 10_000;

function parseData<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Opens the event stream and keeps it open.
 *
 * The native `EventSource` reconnects on its own only for some failures and
 * never after an HTTP error, so reconnection is handled here: every error
 * closes the source and schedules a fresh one with exponential backoff. A
 * `deleted` event ends the subscription for good. Returns the unsubscribe.
 */
export function subscribeToDiagram(
  diagramId: string,
  handlers: SubscriptionHandlers,
  options: SubscribeOptions = {},
): () => void {
  const Source = options.EventSource ?? globalThis.EventSource;
  if (!Source) return () => {};
  const baseUrl = options.baseUrl ?? '';
  const initialBackoff = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  const maxBackoff = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const url = `${baseUrl}/api/diagrams/${encodeURIComponent(diagramId)}/events`;

  let source: EventSource | null = null;
  let backoff = initialBackoff;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const setStatus = (status: CollabStatus) => handlers.onStatus?.(status);

  const stopHeartbeat = () => {
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
  };

  const closeSource = () => {
    stopHeartbeat();
    if (!source) return;
    source.close();
    source = null;
  };

  const scheduleReconnect = () => {
    if (stopped || retryTimer !== null) return;
    setStatus('reconnecting');
    retryTimer = setTimeout(() => {
      retryTimer = null;
      backoff = Math.min(backoff * 2, maxBackoff);
      connect();
    }, backoff);
  };

  const connect = () => {
    if (stopped) return;
    closeSource();
    setStatus('connecting');
    const next = new Source(url, { withCredentials: true });
    source = next;

    next.onopen = () => {
      if (stopped || source !== next) return;
      backoff = initialBackoff;
      setStatus('open');
      if (heartbeatMs > 0) {
        stopHeartbeat();
        heartbeat = setInterval(() => {
          void sendPresence(diagramId, {}, { fetch: options.fetch, baseUrl });
        }, heartbeatMs);
      }
    };

    next.onerror = () => {
      if (stopped || source !== next) return;
      closeSource();
      scheduleReconnect();
    };

    next.addEventListener('saved', (event) => {
      const data = parseData<SavedEvent>((event as MessageEvent).data);
      if (data) handlers.onSaved?.(data);
    });
    next.addEventListener('presence', (event) => {
      const data = parseData<{ users: PresenceUser[] }>((event as MessageEvent).data);
      if (data && Array.isArray(data.users)) handlers.onPresence?.(data.users);
    });
    next.addEventListener('meta', (event) => {
      const data = parseData<MetaEvent>((event as MessageEvent).data);
      if (data) handlers.onMeta?.(data);
    });
    next.addEventListener('access', (event) => {
      const data = parseData<AccessEvent>((event as MessageEvent).data);
      if (data && typeof data.userId === 'string') handlers.onAccess?.(data);
    });
    next.addEventListener('deleted', () => {
      stop();
      handlers.onDeleted?.();
    });
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    closeSource();
    setStatus('closed');
  };

  connect();
  return stop;
}

/**
 * Reports this tab's cursor and editing state. Best effort: presence that
 * fails to send is simply stale for a moment, so errors are swallowed.
 * `keepalive` lets the last update (e.g. `editing: false` on unload) survive
 * the page going away.
 */
export async function sendPresence(
  diagramId: string,
  payload: PresencePayload,
  options: SendPresenceOptions = {},
): Promise<void> {
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const baseUrl = options.baseUrl ?? '';
  try {
    await fetchImpl(`${baseUrl}/api/diagrams/${encodeURIComponent(diagramId)}/presence`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [REQUESTED_WITH_HEADER]: REQUESTED_WITH_VALUE,
      },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify(payload),
    });
  } catch {
    // Presence is advisory; the next update supersedes this one.
  }
}

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  /** Drops a pending trailing call. */
  cancel(): void;
  /** Runs a pending trailing call now. */
  flush(): void;
}

/**
 * Leading-and-trailing throttle: the first call runs at once, later calls
 * within the window collapse into one that runs with the latest arguments when
 * the window ends. Cursor traffic at 60 Hz becomes a handful of posts a second.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): Throttled<A> {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const run = (args: A) => {
    last = Date.now();
    fn(...args);
  };

  const throttled = ((...args: A) => {
    const elapsed = Date.now() - last;
    if (timer === null && elapsed >= waitMs) {
      run(args);
      return;
    }
    pending = args;
    if (timer === null) {
      timer = setTimeout(
        () => {
          timer = null;
          if (pending) {
            const args = pending;
            pending = null;
            run(args);
          }
        },
        Math.max(0, waitMs - elapsed),
      );
    }
  }) as Throttled<A>;

  throttled.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  throttled.flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pending) {
      const args = pending;
      pending = null;
      run(args);
    }
  };
  return throttled;
}
