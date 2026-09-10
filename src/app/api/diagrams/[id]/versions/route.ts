import type { NextRequest } from 'next/server';
import { withUser } from '@/server/handler';
import { HttpError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/diagrams/[id]/versions';

/** The history of one diagram, newest first. */
export function GET(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE }, async ({ repository }) => {
    const { id } = await context.params;
    if (!(await repository.get(id))) {
      throw new HttpError(404, 'not_found', `Diagram not found: ${id}`);
    }
    return json(await repository.listVersions(id));
  });
}
