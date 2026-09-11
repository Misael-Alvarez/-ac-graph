import type { NextRequest } from 'next/server';
import { withUser } from '@/server/handler';
import { HttpError, noContent } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/icons/[key]';

/** Forgets an icon. Documents that embedded it keep drawing it. */
export function DELETE(request: NextRequest, context: RouteContext<typeof ROUTE>) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ icons }) => {
    const { key } = await context.params;
    if (!(await icons.remove(key))) {
      throw new HttpError(404, 'not_found', `Icon not found: ${key}`);
    }
    return noContent();
  });
}
