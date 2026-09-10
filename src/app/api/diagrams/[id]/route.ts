import type { NextRequest } from 'next/server';
import { collaboration } from '@/server/collab/collaboration';
import { expectedRevision, parseBody, withConflict } from '@/server/diagrams/routes';
import { MetaPatchSchema, SaveBodySchema } from '@/server/diagrams/schemas';
import { withUser } from '@/server/handler';
import { HttpError, json, noContent } from '@/server/http';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/diagrams/[id]';
type Context = RouteContext<typeof ROUTE>;

export function GET(request: NextRequest, context: Context) {
  return withUser(request, { route: ROUTE }, async ({ repository }) => {
    const { id } = await context.params;
    const record = await repository.get(id);
    if (!record) throw new HttpError(404, 'not_found', `Diagram not found: ${id}`);
    return json(record);
  });
}

/**
 * Saves the model. `If-Match` (or `options.expectedUpdatedAt`) is the revision
 * the editor last saw; a mismatch is a 412 carrying the current record.
 */
export function PUT(request: NextRequest, context: Context) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository, user }) => {
    const { id } = await context.params;
    const body = await parseBody(request, SaveBodySchema);
    const options = {
      ...body.options,
      expectedUpdatedAt: expectedRevision(request, body.options?.expectedUpdatedAt),
    };
    return withConflict(repository, id, async () => {
      const saved = await repository.save(id, body.model, options);
      collaboration().publish(id, {
        type: 'saved',
        updatedAt: saved.updatedAt,
        by: { id: user.id, name: user.name },
      });
      if (options.metadata?.title !== undefined)
        collaboration().publish(id, { type: 'meta', title: saved.title });
      return json(saved);
    });
  });
}

/** Metadata only: title, description, folder, thumbnail. */
export function PATCH(request: NextRequest, context: Context) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository, user }) => {
    const { id } = await context.params;
    const patch = await parseBody(request, MetaPatchSchema);
    const updated = await repository.updateMeta(id, patch);
    collaboration().publish(id, {
      type: 'saved',
      updatedAt: updated.updatedAt,
      by: { id: user.id, name: user.name },
    });
    if (patch.title !== undefined)
      collaboration().publish(id, { type: 'meta', title: updated.title });
    return json(updated);
  });
}

/** Idempotent: an unknown id is still a 204. History goes with the diagram. */
export function DELETE(request: NextRequest, context: Context) {
  return withUser(request, { route: ROUTE, mutating: true }, async ({ repository }) => {
    const { id } = await context.params;
    await repository.delete(id);
    collaboration().publish(id, { type: 'deleted' });
    return noContent();
  });
}
