import { parseBody } from '@/server/diagrams/routes';
import { WorkspaceImportSchema } from '@/server/diagrams/schemas';
import { withUser } from '@/server/handler';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Merges an exported workspace in under new ids, owned by the caller. Returns the diagram count. */
export function POST(request: Request) {
  return withUser(request, { mutating: true }, async ({ repository }) => {
    const data = await parseBody(request, WorkspaceImportSchema);
    const imported = await repository.importWorkspace(data);
    return json({ imported });
  });
}
