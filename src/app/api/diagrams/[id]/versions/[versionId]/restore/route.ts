import type { NextRequest } from 'next/server';
import { publish } from '@/server/collab/events';
import { expectedRevision, withConflict } from '@/server/diagrams/routes';
import { withUser } from '@/server/handler';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * Makes a past version current. The present model is snapshotted first
 * ("before restore"), so a restore is never destructive.
 */
export function POST(
  request: NextRequest,
  context: RouteContext<'/api/diagrams/[id]/versions/[versionId]/restore'>,
) {
  return withUser(request, { mutating: true }, async ({ repository, user }) => {
    const { id, versionId } = await context.params;
    const expectedUpdatedAt = expectedRevision(request);
    return withConflict(repository, id, async () => {
      const restored = await repository.restoreVersion(id, versionId, { expectedUpdatedAt });
      publish(id, {
        type: 'saved',
        updatedAt: restored.updatedAt,
        by: { id: user.id, name: user.name },
      });
      return json(restored);
    });
  });
}
