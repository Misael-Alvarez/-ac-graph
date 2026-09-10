import type { NextRequest } from 'next/server';
import { withUser } from '@/server/handler';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/diagrams/[id]/versions';

/** The history of one diagram, newest first. */
export function GET(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE }, async ({ repository }) => {
    const { id } = await context.params;
    // Unknown diagram → 404, not a member → 403: the repository decides both.
    return json(await repository.listVersions(id));
  });
}
