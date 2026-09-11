import { parseBody } from '@/server/diagrams/routes';
import { withUser } from '@/server/handler';
import { json } from '@/server/http';
import { IconBodySchema } from '@/server/icons/schemas';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/icons';

/** The workspace's icons, newest first. */
export function GET(request: Request) {
  return withUser(request, { route: ROUTE }, async ({ icons }) => json(await icons.list()));
}

/**
 * Adds an icon. 201 with the icon when it is new; 200 with the icon already
 * holding the same picture when it is not — the caller uses whichever comes
 * back, which is how the same logo uploaded by two people is stored once.
 */
export function POST(request: Request) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ icons }) => {
    const body = await parseBody(request, IconBodySchema);
    const saved = await icons.save(body);
    return json(saved.icon, { status: saved.created ? 201 : 200 });
  });
}
