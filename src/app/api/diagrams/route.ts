import { withUser } from '@/server/handler';
import { json } from '@/server/http';
import { parseBody } from '@/server/diagrams/routes';
import { CreateDiagramBodySchema } from '@/server/diagrams/schemas';

export const dynamic = 'force-dynamic';

/** The library: every diagram's metadata, most recently updated first. */
export function GET(request: Request) {
  return withUser(request, { route: '/api/diagrams' }, async ({ repository }) =>
    json(await repository.list()),
  );
}

/** Creates a diagram owned by the caller. */
export function POST(request: Request) {
  return withUser(request, { route: '/api/diagrams', mutating: true }, async ({ repository }) => {
    const input = await parseBody(request, CreateDiagramBodySchema);
    const record = await repository.create(input);
    return json(record, { status: 201 });
  });
}
