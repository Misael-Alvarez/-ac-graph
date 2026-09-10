import type { NextRequest } from 'next/server';
import { withUser } from '@/server/handler';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** A fresh copy, owned by the caller, titled "… copy". */
export function POST(request: NextRequest, context: RouteContext<'/api/diagrams/[id]/duplicate'>) {
  return withUser(request, { mutating: true }, async ({ repository }) => {
    const { id } = await context.params;
    return json(await repository.duplicate(id), { status: 201 });
  });
}
