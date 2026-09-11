import type { NextRequest } from 'next/server';
import { collaboration } from '@/server/collab/collaboration';
import { parseBody } from '@/server/diagrams/routes';
import { ReplyBodySchema, ThreadPatchSchema } from '@/server/diagrams/schemas';
import { withUser } from '@/server/handler';
import { json, noContent } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/diagrams/[id]/comments/[threadId]';

/** Answers a thread. */
export function POST(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository, user }) => {
    const { id, threadId } = await context.params;
    const body = await parseBody(request, ReplyBodySchema);
    const thread = await repository.reply(id, threadId, body);
    collaboration().publish(id, {
      type: 'comment',
      threadId,
      action: 'replied',
      by: { id: user.id, name: user.name },
    });
    return json(thread);
  });
}

/** Resolves a thread, or opens it again. */
export function PATCH(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository, user }) => {
    const { id, threadId } = await context.params;
    const body = await parseBody(request, ThreadPatchSchema);
    const thread = await repository.setThreadResolved(id, threadId, body.resolved);
    collaboration().publish(id, {
      type: 'comment',
      threadId,
      action: body.resolved ? 'resolved' : 'reopened',
      by: { id: user.id, name: user.name },
    });
    return json(thread);
  });
}

/** Deletes a thread: the author's or the owner's to do. */
export function DELETE(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository, user }) => {
    const { id, threadId } = await context.params;
    await repository.deleteThread(id, threadId);
    collaboration().publish(id, {
      type: 'comment',
      threadId,
      action: 'deleted',
      by: { id: user.id, name: user.name },
    });
    return noContent();
  });
}
