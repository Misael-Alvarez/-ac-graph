import type { NextRequest } from 'next/server';
import { withUser } from '@/server/handler';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/diagrams/[id]/duplicate';

/** A fresh copy, owned by the caller, titled "… copy". */
export function POST(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository }) => {
    const { id } = await context.params;
    return json(await repository.duplicate(id), { status: 201 });
  });
}
