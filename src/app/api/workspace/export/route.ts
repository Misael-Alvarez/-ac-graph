import { withUser } from '@/server/handler';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** The whole workspace — every diagram and every version — as one JSON document. */
export function GET(request: Request) {
  return withUser(request, {}, async ({ repository }) => json(await repository.exportWorkspace()));
}
