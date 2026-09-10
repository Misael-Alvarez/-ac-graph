import type { NextRequest } from 'next/server';
import { withUser } from '@/server/handler';
import { HttpError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** The history of one diagram, newest first. */
export function GET(request: NextRequest, context: RouteContext<'/api/diagrams/[id]/versions'>) {
  return withUser(request, {}, async ({ repository }) => {
    const { id } = await context.params;
    if (!(await repository.get(id))) {
      throw new HttpError(404, 'not_found', `Diagram not found: ${id}`);
    }
    return json(await repository.listVersions(id));
  });
}
