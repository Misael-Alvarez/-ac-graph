import type { NextRequest } from 'next/server';
import { parseBody } from '@/server/diagrams/routes';
import { DuplicateBodySchema } from '@/server/diagrams/schemas';
import { withUser } from '@/server/handler';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/diagrams/[id]/duplicate';

/**
 * A fresh copy, owned by the caller, titled as the body says — in the
 * interface's language — or "… copy" when the request carries no body.
 */
export function POST(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository }) => {
    const { id } = await context.params;
    const options = await parseBody(request, DuplicateBodySchema, { optional: true });
    return json(await repository.duplicate(id, options), { status: 201 });
  });
}
