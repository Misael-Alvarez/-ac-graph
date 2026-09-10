import type { NextRequest } from 'next/server';
import { collaboration } from '@/server/collab/collaboration';
import { parseBody } from '@/server/diagrams/routes';
import { MemberRoleSchema } from '@/server/diagrams/schemas';
import { withUser } from '@/server/handler';
import { json, noContent } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/diagrams/[id]/members/[userId]';

/** Owner only: a different role for someone already in. */
export function PATCH(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository, user }) => {
    const { id, userId } = await context.params;
    const { role } = await parseBody(request, MemberRoleSchema);
    const member = await repository.setMemberRole(id, userId, role);
    collaboration().publish(id, {
      type: 'access',
      userId,
      role: member.role,
      by: { id: user.id, name: user.name },
    });
    return json(member);
  });
}

/** The owner removes someone, or someone leaves. The owner cannot be removed. */
export function DELETE(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository, user }) => {
    const { id, userId } = await context.params;
    if (await repository.removeMember(id, userId)) {
      collaboration().publish(id, {
        type: 'access',
        userId,
        role: null,
        by: { id: user.id, name: user.name },
      });
    }
    return noContent();
  });
}
