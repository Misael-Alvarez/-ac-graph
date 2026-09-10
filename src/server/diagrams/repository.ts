import type { Pool, PoolClient } from 'pg';
import {
  DiagramMetaSchema,
  DiagramRecordSchema,
  DiagramVersionSchema,
  type DiagramMeta,
  type DiagramModel,
  type DiagramRecord,
  type DiagramVersion,
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
import { serverClock, type Clock } from '../clock';
import { getPool, withTransaction } from '../db';
import { log } from '../observability/log';
import { appMetrics } from '../observability/metrics';
import { DiagramNotFoundError, VersionNotFoundError } from './errors';

/**
 * PostgreSQL implementation of the repository the editor already speaks.
 *
 * One instance per request, bound to the signed-in `actor`. This phase has a
 * single internal workspace: every authenticated user sees and edits every
 * diagram, and `ownerId` records who created it. Each mutation is one
 * transaction that locks the row (`select ... for update`), checks the caller's
 * `expectedUpdatedAt`, writes the model, history and thumbnail, and stamps a
 * strictly increasing `updatedAt` — the same contract as the IndexedDB store,
 * so `SaveCoordinator` needs no changes.
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
  model: unknown;
}

type MetaRow = Omit<DiagramRow, 'model'>;

interface VersionRow {
  id: string;
  diagram_id: string;
  created_at: string;
  label: string | null;
  model: unknown;
}

const META_COLUMNS = 'id, owner_id, title, description, folder, created_at, updated_at, thumbnail';
const RECORD_COLUMNS = `${META_COLUMNS}, model`;
const VERSION_COLUMNS = 'id, diagram_id, created_at, label, model';

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

type Queryable = Pick<PoolClient, 'query'>;

export class PgDiagramRepository implements DiagramRepository {
  constructor(
    readonly actor: User,
    private readonly pool: Pool = getPool(),
    private readonly clock: Clock = serverClock(),
  ) {}

  async list(): Promise<DiagramMeta[]> {
    const result = await this.pool.query<MetaRow>(
      `select ${META_COLUMNS} from diagrams order by updated_at desc`,
    );
    return result.rows.map(toMeta);
  }

  async get(id: string): Promise<DiagramRecord | null> {
    const result = await this.pool.query<DiagramRow>(
      `select ${RECORD_COLUMNS} from diagrams where id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
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
      model: input.model,
    });
    await insertDiagram(this.pool, record);
    return record;
  }

  async save(id: string, model: DiagramModel, options: SaveOptions = {}): Promise<DiagramRecord> {
    return this.counted('save', () =>
      this.change(id, async (existing, client) => {
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
    return this.change(id, async (existing) => ({
      ...existing,
      ...patch,
      updatedAt: this.clock(existing.updatedAt),
    }));
  }

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

  /** Idempotent: deleting an unknown id is not an error. Versions cascade. */
  async delete(id: string): Promise<void> {
    await this.pool.query('delete from diagrams where id = $1', [id]);
  }

  async listVersions(diagramId: string): Promise<DiagramVersion[]> {
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
      this.change(diagramId, async (existing, client) => {
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

  async exportWorkspace(): Promise<WorkspaceExport> {
    const [diagrams, versions] = await Promise.all([
      this.pool.query<DiagramRow>(`select ${RECORD_COLUMNS} from diagrams order by created_at`),
      this.pool.query<VersionRow>(
        `select ${VERSION_COLUMNS} from diagram_versions order by created_at`,
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
        await insertDiagram(client, {
          ...parsed,
          id: idMap.get(parsed.id)!,
          ownerId: this.actor.id,
        });
      }
      for (const parsed of versions) {
        const mappedDiagramId = idMap.get(parsed.diagramId);
        if (!mappedDiagramId) continue;
        await insertVersion(client, { ...parsed, id: uid('ver'), diagramId: mappedDiagramId });
      }
    }, this.pool);

    return idMap.size;
  }

  /** Lock, mutate, write: the read and the commit are one transaction. */
  private change(
    id: string,
    update: (record: DiagramRecord, client: PoolClient) => Promise<DiagramRecord>,
  ): Promise<DiagramRecord> {
    return withTransaction(async (client) => {
      const locked = await client.query<DiagramRow>(
        `select ${RECORD_COLUMNS} from diagrams where id = $1 for update`,
        [id],
      );
      const row = locked.rows[0];
      if (!row) throw new DiagramNotFoundError(id);
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
       (id, owner_id, title, description, folder, created_at, updated_at, thumbnail, model)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      record.id,
      record.ownerId,
      record.title,
      record.description,
      record.folder,
      record.createdAt,
      record.updatedAt,
      record.thumbnail,
      JSON.stringify(record.model),
    ],
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
