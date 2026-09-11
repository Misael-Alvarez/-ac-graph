import type { NextRequest } from 'next/server';
import { collaboration } from '@/server/collab/collaboration';
import { parseBody } from '@/server/diagrams/routes';
import { ThreadBodySchema } from '@/server/diagrams/schemas';
import { withUser } from '@/server/handler';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/diagrams/[id]/comments';

/** Every conversation on the diagram, oldest first. */
export function GET(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE }, async ({ repository }) => {
    const { id } = await context.params;
    return json(await repository.listThreads(id));
  });
}

/** Opens a thread. A viewer may: reading is enough to have something to say. */
export function POST(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository, user }) => {
    const { id } = await context.params;
    const body = await parseBody(request, ThreadBodySchema);
    const thread = await repository.createThread(id, body);
    collaboration().publish(id, {
      type: 'comment',
      threadId: thread.id,
      action: 'created',
      by: { id: user.id, name: user.name },
    });
    return json(thread, { status: 201 });
  });
}
