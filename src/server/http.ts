import { ZodError } from 'zod';
import { DiagramConflictError } from '@/lib/store/localRepository';
import { DiagramNotFoundError, VersionNotFoundError } from './diagrams/errors';

/**
 * HTTP helpers shared by every route handler.
 *
 * Errors travel as `HttpError` and are turned into one JSON shape at the edge
 * (`{ code, message, ...details }`), so the browser client can switch on `code`
 * and never has to parse a message.
 */
export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'bad_request'
  | 'payload_too_large'
  | 'server_mode_off'
  | 'internal';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Upper bound for any request body; a 50-shape diagram is ~17 KB. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', NO_STORE['Cache-Control']);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function noContent(init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', NO_STORE['Cache-Control']);
  return new Response(null, { ...init, status: 204, headers });
}

export function error(
  status: number,
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
  init: ResponseInit = {},
): Response {
  return json({ code, message, ...details }, { ...init, status });
}

export function serverModeOff(): Response {
  return error(
    404,
    'server_mode_off',
    'This deployment runs in local mode; there is no server API.',
  );
}

/** Maps any thrown value to a response, hiding everything that is not ours. */
export function errorResponse(thrown: unknown): Response {
  if (thrown instanceof HttpError) {
    return error(thrown.status, thrown.code, thrown.message, thrown.details);
  }
  if (thrown instanceof DiagramConflictError) {
    return error(412, 'conflict', thrown.message);
  }
  if (thrown instanceof DiagramNotFoundError || thrown instanceof VersionNotFoundError) {
    return error(404, 'not_found', thrown.message);
  }
  if (thrown instanceof ZodError) {
    return error(400, 'bad_request', 'The request body is not valid.', {
      issues: thrown.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  // Name and message only: never the request, the body or a stack with values in it.
  console.error(
    '[api] unhandled error:',
    thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : 'non-error thrown',
  );
  return error(500, 'internal', 'Something went wrong on the server.');
}

/**
 * Reads a JSON body without buffering more than `maxBytes`.
 *
 * The `Content-Length` header is checked first so an honest oversized upload is
 * refused before a single byte is read; the stream is then counted anyway
 * because the header is optional and untrusted.
 */
export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, 'payload_too_large', `The request body exceeds ${maxBytes} bytes.`);
  }
  if (!request.body) {
    throw new HttpError(400, 'bad_request', 'The request has no body.');
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, 'payload_too_large', `The request body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }

  const text = new TextDecoder().decode(concat(chunks, total));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'bad_request', 'The request body is not valid JSON.');
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
