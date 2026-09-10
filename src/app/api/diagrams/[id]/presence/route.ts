import type { NextRequest } from 'next/server';
import { publish } from '@/server/collab/events';
import { presence } from '@/server/collab/presence';
import { parseBody } from '@/server/diagrams/routes';
import { PresenceBodySchema } from '@/server/diagrams/schemas';
import { withUser } from '@/server/handler';
import { noContent } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * Heartbeat and cursor/editing updates for one viewer of one diagram.
 * Omitted fields keep their previous value; `cursor: null` hides the cursor.
 */
export function POST(request: NextRequest, context: RouteContext<'/api/diagrams/[id]/presence'>) {
  return withUser(request, { mutating: true }, async ({ user, sessionKey }) => {
    const { id } = await context.params;
    const patch = await parseBody(request, PresenceBodySchema);
    const registry = presence();
    registry.touch(id, sessionKey, user, patch);
    publish(id, { type: 'presence', users: registry.list(id) });
    return noContent();
  });
}
