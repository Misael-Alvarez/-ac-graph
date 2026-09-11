import type { Pool, PoolClient } from 'pg';
import {
  CommentThreadSchema,
  DiagramMemberSchema,
  DiagramMetaSchema,
  DiagramRecordSchema,
  DiagramVersionSchema,
  type CommentAnchor,
  type CommentAuthor,
  type CommentThread,
  type DiagramMember,
  type DiagramMeta,
  type DiagramModel,
  type DiagramRecord,
  type DiagramVersion,
  type Role,
  type User,
} from '@/lib/domain';
import { uid } from '@/lib/engine';
import { DiagramConflictError, MAX_VERSIONS_PER_DIAGRAM } from '@/lib/store/localRepository';
import { renderThumbnail } from '@/lib/store/thumbnail';
import type {
  CreateDiagramInput,
  DiagramRepository,
  SaveOptions,
  WorkspaceExport,
} from '@/lib/store/types';
import { toUser, type UserRow } from '../auth/session';
import { serverClock, type Clock } from '../clock';
import { getPool, withTransaction } from '../db';
import { log } from '../observability/log';
import { appMetrics } from '../observability/metrics';
import {
  DiagramForbiddenError,
  DiagramNotFoundError,
  MembershipError,
  ThreadForbiddenError,
  ThreadNotFoundError,
  UserNotFoundError,
  VersionNotFoundError,
} from './errors';

/**
 * PostgreSQL implementation of the repository the editor already speaks.
 *
 * One instance per request, bound to the signed-in `actor`. A diagram is seen
 * by its members only: the owner (`ownerId`, who created it), the editors and
 * the viewers the owner invited. Every read joins the actor's membership and
 * every write reads it in the same transaction that locks the row, so there is
 * no moment where a revoked person still has a lock. Each mutation checks the
 * caller's `expectedUpdatedAt`, writes the model, history and thumbnail, and
 * stamps a strictly increasing `updatedAt` — the same contract as the IndexedDB
 * store, so `SaveCoordinator` needs no changes.
 */
interface DiagramRow {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  folder: string | null;
  created_at: string;
  updated_at: string;
  thumbnail: string | null;
  template: boolean;
  model: unknown;
  /** The actor's role, from the membership join; null when not a member. */
  role: Role | null;
  owner_name: string | null;
}

type MetaRow = Omit<DiagramRow, 'model'>;

interface VersionRow {
  id: string;
  diagram_id: string;
  created_at: string;
  label: string | null;
  model: unknown;
}

interface MemberRow extends UserRow {
  role: Role;
  created_at: Date;
}

interface ThreadRow {
  id: string;
  diagram_id: string;
  anchor: unknown;
  created_at: string;
  resolved_at: string | null;
  resolved_by: unknown;
  comments: unknown;
}

const THREAD_COLUMNS = 'id, diagram_id, anchor, created_at, resolved_at, resolved_by, comments';

function toThread(row: ThreadRow): CommentThread {
  return CommentThreadSchema.parse({
    id: row.id,
    diagramId: row.diagram_id,
    anchor: row.anchor,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    comments: row.comments,
  });
}

const META_COLUMNS =
  'd.id, d.owner_id, d.title, d.description, d.folder, d.created_at, d.updated_at, d.thumbnail, d.template';
const RECORD_COLUMNS = `${META_COLUMNS}, d.model`;
const ACCESS_COLUMNS = 'm.role, (select u.name from users u where u.id = d.owner_id) as owner_name';
const VERSION_COLUMNS = 'id, diagram_id, created_at, label, model';

/** `diagrams d` with the actor's membership (parameter `$n`) on the side. */
const withMembership = (actorParam: string) =>
  `from diagrams d left join diagram_members m on m.diagram_id = d.id and m.user_id = ${actorParam}`;

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export function roleAllows(role: Role | null | undefined, required: Role): boolean {
  return role !== null && role !== undefined && RANK[role] >= RANK[required];
}

function toMeta(row: MetaRow): DiagramMeta {
  return DiagramMetaSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    folder: row.folder,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    thumbnail: row.thumbnail,
    template: row.template,
    role: row.role ?? undefined,
  });
}

function toRecord(row: DiagramRow): DiagramRecord {
  // Parse on read, like the local store: a stale or hand-edited row fails here.
  return DiagramRecordSchema.parse({ ...toMeta(row), model: row.model });
}

function toVersion(row: VersionRow): DiagramVersion {
  return DiagramVersionSchema.parse({
    id: row.id,
    diagramId: row.diagram_id,
    createdAt: row.created_at,
    label: row.label,
    model: row.model,
  });
}

function toMember(row: MemberRow): DiagramMember {
  return DiagramMemberSchema.parse({
    user: toUser(row),
    role: row.role,
    addedAt: row.created_at.toISOString(),
  });
}

type Queryable = Pick<PoolClient, 'query'>;

export class PgDiagramRepository implements DiagramRepository {
  constructor(
    readonly actor: User,
    private readonly pool: Pool = getPool(),
    private readonly clock: Clock = serverClock(),
  ) {}

  /** The diagrams this person is a member of, most recently updated first. */
  async list(): Promise<DiagramMeta[]> {
    const result = await this.pool.query<MetaRow>(
      `select ${META_COLUMNS}, m.role, null as owner_name
         from diagrams d join diagram_members m on m.diagram_id = d.id and m.user_id = $1
        order by d.updated_at desc`,
      [this.actor.id],
    );
    return result.rows.map(toMeta);
  }

  /** Null when there is no such diagram; a `DiagramForbiddenError` when there is and the actor is not in. */
  async get(id: string): Promise<DiagramRecord | null> {
    const result = await this.pool.query<DiagramRow>(
      `select ${RECORD_COLUMNS}, ${ACCESS_COLUMNS} ${withMembership('$2')} where d.id = $1`,
      [id, this.actor.id],
    );
    const row = result.rows[0];
    if (!row) return null;
    this.require(row, 'viewer');
    return toRecord(row);
  }

  /** The actor's role on a diagram, or null when not a member (or no such diagram). */
  async roleOf(id: string): Promise<Role | null> {
    const result = await this.pool.query<{ role: Role }>(
      'select role from diagram_members where diagram_id = $1 and user_id = $2',
      [id, this.actor.id],
    );
    return result.rows[0]?.role ?? null;
  }

  async create(input: CreateDiagramInput): Promise<DiagramRecord> {
    const ts = this.clock();
    const record = DiagramRecordSchema.parse({
      id: uid('dgm'),
      ownerId: this.actor.id,
      title: input.title,
      description: input.description ?? '',
      folder: input.folder ?? null,
      createdAt: ts,
      updatedAt: ts,
      thumbnail: null,
      template: input.template ?? false,
      model: input.model,
      role: 'owner',
    });
    await withTransaction(async (client) => {
      await insertDiagram(client, record);
      await insertMember(client, record.id, this.actor.id, 'owner', this.actor.id);
    }, this.pool);
    return record;
  }

  async save(id: string, model: DiagramModel, options: SaveOptions = {}): Promise<DiagramRecord> {
    return this.counted('save', () =>
      this.change(id, 'editor', async (existing, client) => {
        if (options.expectedUpdatedAt && options.expectedUpdatedAt !== existing.updatedAt) {
          throw new DiagramConflictError();
        }
        const updated = DiagramRecordSchema.parse({ ...existing, ...options.metadata, model });
        updated.thumbnail = renderThumbnail(updated.model);
        if (options.snapshotModel || options.snapshot) {
          await this.snapshot(
            client,
            options.snapshotModel ? { ...updated, model: options.snapshotModel } : existing,
            options.label ?? null,
          );
        }
        return { ...updated, updatedAt: this.clock(existing.updatedAt) };
      }),
    );
  }

  async updateMeta(
    id: string,
    patch: Partial<Pick<DiagramMeta, 'title' | 'description' | 'folder' | 'thumbnail'>>,
  ): Promise<DiagramRecord> {
    return this.change(id, 'editor', async (existing) => ({
      ...existing,
      ...patch,
      updatedAt: this.clock(existing.updatedAt),
    }));
  }

  /** Anyone who can read a diagram can take a copy of their own. */
  async duplicate(id: string): Promise<DiagramRecord> {
    const source = await this.get(id);
    if (!source) throw new DiagramNotFoundError(id);
    return this.create({
      title: `${source.title} copy`,
      description: source.description,
      folder: source.folder,
      model: structuredClone(source.model),
    });
  }

  /** Owner only. Idempotent: deleting an unknown id is not an error. Versions and members cascade. */
  async delete(id: string): Promise<void> {
    await withTransaction(async (client) => {
      const locked = await client.query<MetaRow>(
        `select ${META_COLUMNS}, ${ACCESS_COLUMNS} ${withMembership('$2')} where d.id = $1 for update of d`,
        [id, this.actor.id],
      );
      const row = locked.rows[0];
      if (!row) return;
      this.require(row, 'owner');
      await client.query('delete from diagrams where id = $1', [id]);
    }, this.pool);
  }

  async listVersions(diagramId: string): Promise<DiagramVersion[]> {
    await this.access(diagramId, 'viewer');
    const result = await this.pool.query<VersionRow>(
      `select ${VERSION_COLUMNS} from diagram_versions
        where diagram_id = $1 order by created_at desc`,
      [diagramId],
    );
    return result.rows.map(toVersion);
  }

  async restoreVersion(
    diagramId: string,
    versionId: string,
    options: Pick<SaveOptions, 'expectedUpdatedAt'> = {},
  ): Promise<DiagramRecord> {
    return this.counted('restore', () =>
      this.change(diagramId, 'editor', async (existing, client) => {
        if (options.expectedUpdatedAt && options.expectedUpdatedAt !== existing.updatedAt) {
          throw new DiagramConflictError();
        }
        const found = await client.query<VersionRow>(
          `select ${VERSION_COLUMNS} from diagram_versions where id = $1 and diagram_id = $2`,
          [versionId, diagramId],
        );
        const row = found.rows[0];
        if (!row) throw new VersionNotFoundError(versionId);
        const version = toVersion(row);
        await this.snapshot(client, existing, 'before restore');
        return {
          ...existing,
          model: version.model,
          thumbnail: renderThumbnail(version.model),
          updatedAt: this.clock(existing.updatedAt),
        };
      }),
    );
  }

  /** Everyone with access, the owner first. Any member may see who else is in. */
  async listMembers(diagramId: string): Promise<DiagramMember[]> {
    await this.access(diagramId, 'viewer');
    const result = await this.pool.query<MemberRow>(
      `select u.id, u.name, u.email, u.picture, m.role, m.created_at
         from diagram_members m join users u on u.id = m.user_id
        where m.diagram_id = $1
        order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, u.name, u.id`,
      [diagramId],
    );
    return result.rows.map(toMember);
  }

  /**
   * Owner only. Adds a person by e-mail, or changes their role. The person must
   * have signed in at least once — accounts come from the identity provider,
   * never from an invitation — and the owner's own row cannot be touched here.
   */
  async setMember(
    diagramId: string,
    email: string,
    role: Exclude<Role, 'owner'>,
  ): Promise<DiagramMember> {
    const diagram = await this.access(diagramId, 'owner');
    const found = await this.pool.query<UserRow>(
      `select id, name, email, picture from users
        where lower(email) = lower($1)
        order by updated_at desc limit 1`,
      [email.trim()],
    );
    const user = found.rows[0];
    if (!user) throw new UserNotFoundError(email.trim());
    if (user.id === diagram.owner_id) {
      throw new MembershipError('The owner already has every permission.');
    }
    const written = await this.pool.query<MemberRow>(
      `insert into diagram_members (diagram_id, user_id, role, added_by)
       values ($1, $2, $3, $4)
       on conflict (diagram_id, user_id) do update set role = excluded.role, added_by = excluded.added_by
       returning role, created_at`,
      [diagramId, user.id, role, this.actor.id],
    );
    return toMember({ ...user, ...written.rows[0] });
  }

  /** Owner only. Changes the role of someone already in; the owner's own row is off limits. */
  async setMemberRole(
    diagramId: string,
    userId: string,
    role: Exclude<Role, 'owner'>,
  ): Promise<DiagramMember> {
    const diagram = await this.access(diagramId, 'owner');
    if (userId === diagram.owner_id) {
      throw new MembershipError('The owner already has every permission.');
    }
    const written = await this.pool.query<MemberRow>(
      `update diagram_members m set role = $3, added_by = $4
         from users u
        where m.diagram_id = $1 and m.user_id = $2 and u.id = m.user_id
        returning u.id, u.name, u.email, u.picture, m.role, m.created_at`,
      [diagramId, userId, role, this.actor.id],
    );
    const row = written.rows[0];
    if (!row) throw new MembershipError('That person is not a member of this diagram.');
    return toMember(row);
  }

  /**
   * Removes a person. The owner may remove anyone but themself; anyone else may
   * only leave. Returns whether a row went away.
   */
  async removeMember(diagramId: string, userId: string): Promise<boolean> {
    const leaving = userId === this.actor.id;
    const diagram = await this.access(diagramId, leaving ? 'viewer' : 'owner');
    if (userId === diagram.owner_id) {
      throw new MembershipError('The owner cannot be removed from their own diagram.');
    }
    const result = await this.pool.query(
      'delete from diagram_members where diagram_id = $1 and user_id = $2',
      [diagramId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /* ── comments ─────────────────────────────────────────── */

  /** Whoever may read the diagram may read, and join, its conversations. */
  async listThreads(diagramId: string): Promise<CommentThread[]> {
    await this.access(diagramId, 'viewer');
    const result = await this.pool.query<ThreadRow>(
      `select ${THREAD_COLUMNS} from comment_threads where diagram_id = $1 order by created_at, id`,
      [diagramId],
    );
    return result.rows.map(toThread);
  }

  // Signed by the session's user: the only name the server trusts.
  async createThread(
    diagramId: string,
    input: { anchor: CommentAnchor; body: string },
  ): Promise<CommentThread> {
    await this.access(diagramId, 'viewer');
    const ts = this.clock();
    const author = this.signature();
    const thread = CommentThreadSchema.parse({
      id: uid('thr'),
      diagramId,
      anchor: input.anchor,
      createdAt: ts,
      resolvedAt: null,
      resolvedBy: null,
      comments: [{ id: uid('cmt'), author, body: input.body.trim(), createdAt: ts }],
    });
    await this.countedComment('create', () =>
      this.pool.query(
        `insert into comment_threads
           (id, diagram_id, anchor, created_by, created_at, resolved_at, resolved_by, comments)
         values ($1, $2, $3::jsonb, $4, $5, null, null, $6::jsonb)`,
        [
          thread.id,
          diagramId,
          JSON.stringify(thread.anchor),
          this.actor.id,
          ts,
          JSON.stringify(thread.comments),
        ],
      ),
    );
    return thread;
  }

  async reply(
    diagramId: string,
    threadId: string,
    input: { body: string },
  ): Promise<CommentThread> {
    const author = this.signature();
    return this.countedComment('reply', () =>
      this.changeThread(diagramId, threadId, (thread) => ({
        ...thread,
        comments: [
          ...thread.comments,
          { id: uid('cmt'), author, body: input.body.trim(), createdAt: this.clock() },
        ],
      })),
    );
  }

  async setThreadResolved(
    diagramId: string,
    threadId: string,
    resolved: boolean,
  ): Promise<CommentThread> {
    const by = this.signature();
    return this.countedComment('resolve', () =>
      this.changeThread(diagramId, threadId, (thread) => ({
        ...thread,
        resolvedAt: resolved ? this.clock() : null,
        resolvedBy: resolved ? by : null,
      })),
    );
  }

  /** The author's to take back, or the owner's to tidy; nobody else's. */
  async deleteThread(diagramId: string, threadId: string): Promise<void> {
    const diagram = await this.access(diagramId, 'viewer');
    await this.countedComment('delete', () =>
      withTransaction(async (client) => {
        const found = await client.query<ThreadRow>(
          `select ${THREAD_COLUMNS} from comment_threads
            where id = $1 and diagram_id = $2 for update`,
          [threadId, diagramId],
        );
        const row = found.rows[0];
        if (!row) throw new ThreadNotFoundError(threadId);
        const thread = toThread(row);
        const author = thread.comments[0].author.id;
        if (author !== this.actor.id && diagram.owner_id !== this.actor.id) {
          throw new ThreadForbiddenError(threadId);
        }
        await client.query('delete from comment_threads where id = $1', [threadId]);
      }, this.pool),
    );
  }

  /** How the actor signs a comment: the session's id and name, nothing else. */
  private signature(): CommentAuthor {
    return { id: this.actor.id, name: this.actor.name };
  }

  /** Lock the thread, check the diagram may be read, rewrite it: one transaction. */
  private async changeThread(
    diagramId: string,
    threadId: string,
    update: (thread: CommentThread) => CommentThread,
  ): Promise<CommentThread> {
    await this.access(diagramId, 'viewer');
    return withTransaction(async (client) => {
      const found = await client.query<ThreadRow>(
        `select ${THREAD_COLUMNS} from comment_threads
          where id = $1 and diagram_id = $2 for update`,
        [threadId, diagramId],
      );
      const row = found.rows[0];
      if (!row) throw new ThreadNotFoundError(threadId);
      const next = CommentThreadSchema.parse(update(toThread(row)));
      await client.query(
        `update comment_threads
            set resolved_at = $2, resolved_by = $3::jsonb, comments = $4::jsonb
          where id = $1`,
        [
          next.id,
          next.resolvedAt,
          next.resolvedBy === null ? null : JSON.stringify(next.resolvedBy),
          JSON.stringify(next.comments),
        ],
      );
      return next;
    }, this.pool);
  }

  private async countedComment<T>(
    operation: 'create' | 'reply' | 'resolve' | 'delete',
    write: () => Promise<T>,
  ): Promise<T> {
    const { commentWrites } = appMetrics();
    try {
      const result = await write();
      commentWrites.inc({ operation, result: 'ok' });
      return result;
    } catch (thrown) {
      commentWrites.inc({
        operation,
        result:
          thrown instanceof ThreadNotFoundError || thrown instanceof ThreadForbiddenError
            ? 'refused'
            : 'error',
      });
      throw thrown;
    }
  }

  /**
   * Counts a write by outcome. A conflict is the editor holding a stale
   * revision — normal in a shared workspace and worth watching, not an error.
   */
  private async counted<T>(operation: 'save' | 'restore', write: () => Promise<T>): Promise<T> {
    const { diagramSaves } = appMetrics();
    try {
      const result = await write();
      diagramSaves.inc({ operation, result: 'ok' });
      return result;
    } catch (thrown) {
      if (thrown instanceof DiagramConflictError) {
        diagramSaves.inc({ operation, result: 'conflict' });
        log().info('stale revision refused', { operation });
      } else {
        diagramSaves.inc({ operation, result: 'error' });
      }
      throw thrown;
    }
  }

  /** Everything this person can read, and the history of exactly those diagrams. */
  async exportWorkspace(): Promise<WorkspaceExport> {
    const [diagrams, versions] = await Promise.all([
      this.pool.query<DiagramRow>(
        `select ${RECORD_COLUMNS}, m.role, null as owner_name
           from diagrams d join diagram_members m on m.diagram_id = d.id and m.user_id = $1
          order by d.created_at`,
        [this.actor.id],
      ),
      this.pool.query<VersionRow>(
        `select ${VERSION_COLUMNS} from diagram_versions
          where diagram_id in (select diagram_id from diagram_members where user_id = $1)
          order by created_at`,
        [this.actor.id],
      ),
    ]);
    return {
      exportedAt: this.clock(),
      diagrams: diagrams.rows.map(toRecord),
      versions: versions.rows.map(toVersion),
    };
  }

  /**
   * Merges an export into the workspace under new ids, owned by the importer.
   *
   * Everything is validated before anything is written and the writes share one
   * transaction, so a dump that fails halfway leaves nothing behind.
   */
  async importWorkspace(data: WorkspaceExport): Promise<number> {
    const diagrams = data.diagrams.map((raw) => DiagramRecordSchema.parse(raw));
    const versions = data.versions.map((raw) => DiagramVersionSchema.parse(raw));

    const idMap = new Map<string, string>();
    for (const parsed of diagrams) idMap.set(parsed.id, uid('dgm'));

    await withTransaction(async (client) => {
      for (const parsed of diagrams) {
        const id = idMap.get(parsed.id)!;
        await insertDiagram(client, { ...parsed, id, ownerId: this.actor.id });
        await insertMember(client, id, this.actor.id, 'owner', this.actor.id);
      }
      for (const parsed of versions) {
        const mappedDiagramId = idMap.get(parsed.diagramId);
        if (!mappedDiagramId) continue;
        await insertVersion(client, { ...parsed, id: uid('ver'), diagramId: mappedDiagramId });
      }
    }, this.pool);

    return idMap.size;
  }

  /** Throws unless the row's role covers `required`. */
  private require(row: Pick<DiagramRow, 'id' | 'role' | 'owner_name'>, required: Role): void {
    if (!roleAllows(row.role, required)) {
      throw new DiagramForbiddenError(row.id, required, row.owner_name);
    }
  }

  /** The diagram's id, owner and the actor's role — or the right error. */
  private async access(
    id: string,
    required: Role,
  ): Promise<{ id: string; owner_id: string; role: Role | null; owner_name: string | null }> {
    const result = await this.pool.query<{
      id: string;
      owner_id: string;
      role: Role | null;
      owner_name: string | null;
    }>(`select d.id, d.owner_id, ${ACCESS_COLUMNS} ${withMembership('$2')} where d.id = $1`, [
      id,
      this.actor.id,
    ]);
    const row = result.rows[0];
    if (!row) throw new DiagramNotFoundError(id);
    this.require(row, required);
    return row;
  }

  /** Lock, check the role, mutate, write: all one transaction. */
  private change(
    id: string,
    required: Role,
    update: (record: DiagramRecord, client: PoolClient) => Promise<DiagramRecord>,
  ): Promise<DiagramRecord> {
    return withTransaction(async (client) => {
      const locked = await client.query<DiagramRow>(
        `select ${RECORD_COLUMNS}, ${ACCESS_COLUMNS} ${withMembership('$2')}
          where d.id = $1 for update of d`,
        [id, this.actor.id],
      );
      const row = locked.rows[0];
      if (!row) throw new DiagramNotFoundError(id);
      this.require(row, required);
      const updated = DiagramRecordSchema.parse(await update(toRecord(row), client));
      await client.query(
        `update diagrams
            set title = $2, description = $3, folder = $4, updated_at = $5,
                thumbnail = $6, model = $7::jsonb
          where id = $1`,
        [
          updated.id,
          updated.title,
          updated.description,
          updated.folder,
          updated.updatedAt,
          updated.thumbnail,
          JSON.stringify(updated.model),
        ],
      );
      return updated;
    }, this.pool);
  }

  private async snapshot(
    client: PoolClient,
    record: DiagramRecord,
    label: string | null,
  ): Promise<void> {
    const version = DiagramVersionSchema.parse({
      id: uid('ver'),
      diagramId: record.id,
      createdAt: this.clock(record.updatedAt),
      label,
      model: record.model,
    });
    await insertVersion(client, version);
    // Keep the newest MAX_VERSIONS_PER_DIAGRAM; everything older goes.
    await client.query(
      `delete from diagram_versions
        where id in (
          select id from diagram_versions
           where diagram_id = $1
           order by created_at desc
          offset $2
        )`,
      [record.id, MAX_VERSIONS_PER_DIAGRAM],
    );
  }
}

async function insertDiagram(db: Queryable, record: DiagramRecord): Promise<void> {
  await db.query(
    `insert into diagrams
       (id, owner_id, title, description, folder, created_at, updated_at, thumbnail, template, model)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      record.id,
      record.ownerId,
      record.title,
      record.description,
      record.folder,
      record.createdAt,
      record.updatedAt,
      record.thumbnail,
      record.template,
      JSON.stringify(record.model),
    ],
  );
}

async function insertMember(
  db: Queryable,
  diagramId: string,
  userId: string,
  role: Role,
  addedBy: string,
): Promise<void> {
  await db.query(
    `insert into diagram_members (diagram_id, user_id, role, added_by) values ($1, $2, $3, $4)
     on conflict (diagram_id, user_id) do update set role = excluded.role`,
    [diagramId, userId, role, addedBy],
  );
}

async function insertVersion(db: Queryable, version: DiagramVersion): Promise<void> {
  await db.query(
    `insert into diagram_versions (id, diagram_id, created_at, label, model)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [
      version.id,
      version.diagramId,
      version.createdAt,
      version.label,
      JSON.stringify(version.model),
    ],
  );
}
