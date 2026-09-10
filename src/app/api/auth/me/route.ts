import { withUser } from '@/server/handler';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** The signed-in user, or 401. */
export function GET(request: Request) {
  return withUser(request, {}, async ({ user }) => json({ user }));
}
