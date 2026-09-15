import type { ZodType } from 'zod';
import { DiagramConflictError } from '@/lib/store/localRepository';
import type { PgDiagramRepository } from './repository';
import { HttpError, error, readJsonBody } from '../http';

/**
 * Small helpers the diagram route handlers share.
 */

/**
 * Reads and validates a JSON body; a bad payload is a 400 with the issues
 * listed. With `optional`, a request that carries no body at all is read as
 * `{}` — for the routes whose body only adds to what the URL already says.
 */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
  { optional = false }: { optional?: boolean } = {},
): Promise<T> {
  const raw = optional && !hasBody(request) ? {} : await readJsonBody(request);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'bad_request', 'The request body is not valid.', {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  return parsed.data;
}

/** A body was sent: the stream exists and is not declared empty. */
function hasBody(request: Request): boolean {
  return request.body !== null && request.headers.get('content-length') !== '0';
}

/** `If-Match` carries the revision the editor last saw; it wins over the body. */
export function expectedRevision(request: Request, fromBody?: string): string | undefined {
  const header = request.headers.get('if-match');
  if (header === null) return fromBody;
  const trimmed = header.trim();
  if (!trimmed || trimmed === '*') return fromBody;
  // Accept a quoted ETag form as well as the bare timestamp.
  return trimmed.replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
}

/**
 * Runs a guarded write. On a revision conflict the caller gets a 412 with the
 * current record, so the editor can show what changed without another round trip.
 */
export async function withConflict(
  repository: PgDiagramRepository,
  id: string,
  write: () => Promise<Response>,
): Promise<Response> {
  try {
    return await write();
  } catch (thrown) {
    if (!(thrown instanceof DiagramConflictError)) throw thrown;
    const current = await repository.get(id);
    return error(412, 'conflict', thrown.message, { current });
  }
}
