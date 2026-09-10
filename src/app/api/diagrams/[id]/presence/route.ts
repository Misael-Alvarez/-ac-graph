import type { NextRequest } from 'next/server';
import { collaboration } from '@/server/collab/collaboration';
import { parseBody } from '@/server/diagrams/routes';
import { PresenceBodySchema } from '@/server/diagrams/schemas';
import { withUser } from '@/server/handler';
import { noContent } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/diagrams/[id]/presence';

/**
 * Heartbeat and cursor/editing updates for one viewer of one diagram.
 * Omitted fields keep their previous value; `cursor: null` hides the cursor.
 */
export function POST(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ user, sessionKey }) => {
    const { id } = await context.params;
    const patch = await parseBody(request, PresenceBodySchema);
    collaboration().touch(id, sessionKey, user, patch, { announce: true });
    return noContent();
  });
}
