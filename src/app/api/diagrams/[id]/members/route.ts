import type { NextRequest } from 'next/server';
import { collaboration } from '@/server/collab/collaboration';
import { parseBody } from '@/server/diagrams/routes';
import { MemberBodySchema } from '@/server/diagrams/schemas';
import { withUser } from '@/server/handler';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/diagrams/[id]/members';

/** Everyone with access to the diagram, the owner first. Any member may look. */
export function GET(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE }, async ({ repository }) => {
    const { id } = await context.params;
    return json(await repository.listMembers(id));
  });
}

/**
 * Owner only: lets a person in by e-mail as editor or viewer, or changes the
 * role they already have. The person must have signed in once before; the
 * room hears about it so the share dialog and the person's own editor follow.
 */
export function PUT(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository, user }) => {
    const { id } = await context.params;
    const body = await parseBody(request, MemberBodySchema);
    const member = await repository.setMember(id, body.email, body.role);
    collaboration().publish(id, {
      type: 'access',
      userId: member.user.id,
      role: member.role,
      by: { id: user.id, name: user.name },
    });
    return json(member);
  });
}
