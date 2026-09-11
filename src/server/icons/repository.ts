import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { CustomIcon, User } from '@/lib/domain';
import { CustomIconSchema } from '@/lib/domain';
import { getPool, withTransaction } from '../db';
import { appMetrics } from '../observability/metrics';
import { IconLibraryFullError } from './errors';

export { IconLibraryFullError };

/**
 * How much the workspace's library may hold.
 *
 * Generous next to the browser's 48 icons and 3 MB, because this one is
 * everybody's: a team's vendor logos, its own services' marks and the odd
 * screenshot of something nobody has drawn yet. Still bounded, since every
 * icon here is offered to every editor in the workspace on every pick.
 */
export const MAX_WORKSPACE_ICONS = 200;
export const MAX_WORKSPACE_ICON_BYTES = 16 * 1024 * 1024;

interface IconRow {
  key: string;
  icon: unknown;
  created_by: string | null;
}

/** What identifies a picture: the drawing itself, not the name it was given. */
export function contentHashOf(icon: CustomIcon): string {
  const picture = icon.svg
    ? `svg:${icon.svg.viewBox}:${icon.svg.body}`
    : `image:${icon.image ?? ''}`;
  return createHash('sha256').update(picture).digest('hex');
}

/**
 * The workspace's icon library, in PostgreSQL.
 *
 * One library for everyone who signs in — there is one workspace — and any of
 * them may add to it or tidy it: an icon removed here is still drawn by every
 * document that embedded it, so the worst a removal can do is make somebody
 * upload it again. Uploading the same picture twice stores it once: the
 * second upload answers with the icon already there, whatever it was named,
 * and the caller uses that one.
 */
export class PgIconLibrary {
  constructor(
    readonly actor: User,
    private readonly pool: Pool = getPool(),
  ) {}

  /** Every icon, newest first. */
  async list(): Promise<CustomIcon[]> {
    const result = await this.pool.query<IconRow>(
      'select key, icon, created_by from icons order by created_at desc, key',
    );
    return result.rows.map(toIcon);
  }

  /**
   * Adds an icon, or answers with the one that already holds its picture.
   *
   * Re-uploading under an existing key replaces that icon. Otherwise the
   * library must have room — counted and weighed inside the same transaction
   * that writes, so two people uploading at once cannot both squeeze in.
   */
  async save(icon: CustomIcon): Promise<{ icon: CustomIcon; created: boolean }> {
    const { iconWrites } = appMetrics();
    try {
      const outcome = await withTransaction(async (client) => {
        // One writer at a time: uploads are rare and the count below has to
        // be exact when it is read, or two people could both squeeze in.
        await client.query('lock table icons in share row exclusive mode');
        const hash = contentHashOf(icon);
        const same = await client.query<IconRow>(
          'select key, icon, created_by from icons where content_hash = $1 and key <> $2 limit 1',
          [hash, icon.key],
        );
        if (same.rows[0]) return { icon: toIcon(same.rows[0]), created: false };

        const existing = await client.query<{ key: string }>(
          'select key from icons where key = $1',
          [icon.key],
        );
        if (!existing.rows[0]) {
          const room = await client.query<{ count: string; bytes: string | null }>(
            'select count(*)::text as count, sum(octet_length(icon::text))::text as bytes from icons',
          );
          const count = Number(room.rows[0].count);
          const bytes = Number(room.rows[0].bytes ?? 0);
          const size = Buffer.byteLength(JSON.stringify(icon));
          if (count >= MAX_WORKSPACE_ICONS || bytes + size > MAX_WORKSPACE_ICON_BYTES) {
            throw new IconLibraryFullError(count, bytes);
          }
        }
        await client.query(
          `insert into icons (key, icon, content_hash, created_by)
             values ($1, $2::jsonb, $3, $4)
           on conflict (key) do update
             set icon = excluded.icon, content_hash = excluded.content_hash`,
          [icon.key, JSON.stringify(icon), hash, this.actor.id],
        );
        return { icon, created: !existing.rows[0] };
      }, this.pool);
      iconWrites.inc({ operation: 'save', result: outcome.created ? 'ok' : 'deduplicated' });
      return outcome;
    } catch (thrown) {
      iconWrites.inc({
        operation: 'save',
        result: thrown instanceof IconLibraryFullError ? 'full' : 'error',
      });
      throw thrown;
    }
  }

  /** Forgets an icon; true when there was one. Documents that embedded it keep it. */
  async remove(key: string): Promise<boolean> {
    const { iconWrites } = appMetrics();
    try {
      const result = await this.pool.query('delete from icons where key = $1', [key]);
      iconWrites.inc({ operation: 'remove', result: 'ok' });
      return (result.rowCount ?? 0) > 0;
    } catch (thrown) {
      iconWrites.inc({ operation: 'remove', result: 'error' });
      throw thrown;
    }
  }
}

function toIcon(row: IconRow): CustomIcon {
  // Parsed on read, like every other row: a hand-edited icon fails here, not on a canvas.
  return CustomIconSchema.parse(row.icon);
}
