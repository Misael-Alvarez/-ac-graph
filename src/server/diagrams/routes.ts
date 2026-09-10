import type { ZodType } from 'zod';
import { DiagramConflictError } from '@/lib/store/localRepository';
import type { PgDiagramRepository } from './repository';
import { HttpError, error, readJsonBody } from '../http';

/**
 * Small helpers the diagram route handlers share.
 */

/** Reads and validates a JSON body; a bad payload is a 400 with the issues listed. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const raw = await readJsonBody(request);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'bad_request', 'The request body is not valid.', {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
  }
  return parsed.data;
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
