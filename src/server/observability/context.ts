import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from './log';

/**
 * What the server knows about the request it is currently handling.
 *
 * Carried in `AsyncLocalStorage` so the repository, the pool and the stream can
 * log with the request id, the user and the diagram without every function
 * threading them through its signature. `fields` grows as the request learns
 * more: the user after authentication, the diagram from the route parameters.
 */
export interface RequestContext {
  requestId: string;
  method: string;
  /** The route template (`/api/diagrams/[id]`), never the concrete path. */
  route: string;
  /** Concrete path without the query string, which can carry codes and payloads. */
  path: string;
  startedAt: number;
  fields: Record<string, unknown>;
  logger: Logger;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequest<T>(context: RequestContext, run: () => T): T {
  return storage.run(context, run);
}

export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}

/** Adds fields to the current request's log lines. A no-op outside a request. */
export function annotateRequest(fields: Record<string, unknown>): void {
  const context = storage.getStore();
  if (!context) return;
  Object.assign(context.fields, fields);
}
