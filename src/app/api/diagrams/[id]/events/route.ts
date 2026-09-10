import type { NextRequest } from 'next/server';
import { openDiagramStream } from '@/server/collab/stream';
import { withUser } from '@/server/handler';
import { HttpError } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * Server-sent events for one diagram: `saved`, `meta`, `deleted`, `presence`.
 * Opening the stream joins the presence roster; closing it leaves.
 */
export function GET(request: NextRequest, context: RouteContext<'/api/diagrams/[id]/events'>) {
  return withUser(request, {}, async ({ user, repository, sessionKey }) => {
    const { id } = await context.params;
    if (!(await repository.get(id))) {
      throw new HttpError(404, 'not_found', `Diagram not found: ${id}`);
    }
    return openDiagramStream({ diagramId: id, user, sessionKey, signal: request.signal });
  });
}
