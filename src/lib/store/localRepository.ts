import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import {
  DiagramRecordSchema,
  DiagramVersionSchema,
  type DiagramMeta,
  type DiagramModel,
  type DiagramRecord,
  type DiagramVersion,
} from '@/lib/domain';
import { uid } from '@/lib/engine';
import type { CreateDiagramInput, DiagramRepository, SaveOptions, WorkspaceExport } from './types';
import { renderThumbnail } from './thumbnail';

const DB_NAME = 'aion-architecture-studio';
const DB_VERSION = 1;

/** Key of the single-diagram autosave written by the original editor. */
export const LEGACY_LOCALSTORAGE_KEY = 'aion-arch-studio-autosave';

/** Owner of every locally created diagram until real accounts exist. */
export const LOCAL_OWNER_ID = 'local-user';

/** How many snapshots to keep per diagram before the oldest are dropped. */
export const MAX_VERSIONS_PER_DIAGRAM = 50;

interface StudioDB extends DBSchema {
  diagrams: { key: string; value: DiagramRecord };
  versions: { key: string; value: DiagramVersion; indexes: { byDiagram: string } };
  flags: { key: string; value: boolean };
}

type WriteTransaction = IDBPTransaction<StudioDB, ['diagrams', 'versions'], 'readwrite'>;

export class DiagramConflictError extends Error {
  constructor() {
    super('The diagram changed in another editor. Reload before saving over it.');
    this.name = 'DiagramConflictError';
  }
}

/** Projects a stored record onto its metadata, dropping the heavy model payload. */
function toMeta(record: DiagramRecord): DiagramMeta {
  return {
    id: record.id,
    ownerId: record.ownerId,
    title: record.title,
    description: record.description,
    folder: record.folder,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    thumbnail: record.thumbnail,
    template: record.template,
  };
}

/**
 * IndexedDB-backed store.
 *
 * IndexedDB rather than localStorage because version history quickly exceeds
 * the 5 MB localStorage quota — a single 50-shape diagram is already ~17 KB.
 */
export interface LocalRepositoryOptions {
  /** Override the IndexedDB database name. Used by tests to stay isolated. */
  dbName?: string;
}

export class LocalDiagramRepository implements DiagramRepository {
  private dbPromise: Promise<IDBPDatabase<StudioDB>> | null = null;
  private readonly dbName: string;

  private lastStamp = 0;

  constructor(options: LocalRepositoryOptions = {}) {
    this.dbName = options.dbName ?? DB_NAME;
  }

  /**
   * Strictly increasing ISO timestamp.
   *
   * Two saves inside the same millisecond would otherwise share a timestamp and
   * make the version history order non-deterministic. It also gives DynamoDB a
   * usable sort key when the store moves to AWS.
   */
  private now(after?: string): string {
    const previous = after ? Date.parse(after) : 0;
    const ms = Math.max(
      Date.now(),
      this.lastStamp + 1,
      Number.isFinite(previous) ? previous + 1 : 0,
    );
    this.lastStamp = ms;
    return new Date(ms).toISOString();
  }

  /** Releases the connection so the database can be deleted or upgraded. */
  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = null;
  }

  private db(): Promise<IDBPDatabase<StudioDB>> {
    this.dbPromise ??= openDB<StudioDB>(this.dbName, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('diagrams')) {
          db.createObjectStore('diagrams', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('versions')) {
          const store = db.createObjectStore('versions', { keyPath: 'id' });
          store.createIndex('byDiagram', 'diagramId');
        }
        if (!db.objectStoreNames.contains('flags')) db.createObjectStore('flags');
      },
    });
    return this.dbPromise;
  }

  async list(): Promise<DiagramMeta[]> {
    const db = await this.db();
    const all = await db.getAll('diagrams');
    return all
      .map(toMeta)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async get(id: string): Promise<DiagramRecord | null> {
    const db = await this.db();
    const record = await db.get('diagrams', id);
    if (!record) return null;
    // Parse on read: a hand-edited or outdated record fails here, not deep in the editor.
    return DiagramRecordSchema.parse(record);
  }

  async create(input: CreateDiagramInput): Promise<DiagramRecord> {
    const ts = this.now();
    const record: DiagramRecord = DiagramRecordSchema.parse({
      id: uid('dgm'),
      ownerId: LOCAL_OWNER_ID,
      title: input.title,
      description: input.description ?? '',
      folder: input.folder ?? null,
      createdAt: ts,
      updatedAt: ts,
      thumbnail: null,
      template: input.template ?? false,
      model: input.model,
    });
    const db = await this.db();
    await db.put('diagrams', record);
    return record;
  }

  async save(id: string, model: DiagramModel, options: SaveOptions = {}): Promise<DiagramRecord> {
    return this.change(id, async (existing, tx) => {
      if (options.expectedUpdatedAt && options.expectedUpdatedAt !== existing.updatedAt) {
        throw new DiagramConflictError();
      }
      const updated = DiagramRecordSchema.parse({
        ...existing,
        ...options.metadata,
        model,
      });
      updated.thumbnail = renderThumbnail(updated.model);
      if (options.snapshotModel || options.snapshot) {
        await this.snapshot(
          tx,
          options.snapshotModel ? { ...updated, model: options.snapshotModel } : existing,
          options.label ?? null,
        );
      }
      return { ...updated, updatedAt: this.now(existing.updatedAt) };
    });
  }

  async updateMeta(
    id: string,
    patch: Partial<Pick<DiagramMeta, 'title' | 'description' | 'folder' | 'thumbnail'>>,
  ): Promise<DiagramRecord> {
    return this.change(id, async (existing) => ({
      ...existing,
      ...patch,
      updatedAt: this.now(existing.updatedAt),
    }));
  }

  async duplicate(id: string): Promise<DiagramRecord> {
    const source = await this.get(id);
    if (!source) throw new Error(`Diagram not found: ${id}`);
    return this.create({
      title: `${source.title} copy`,
      description: source.description,
      folder: source.folder,
      model: structuredClone(source.model),
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['diagrams', 'versions'], 'readwrite');
    await tx.objectStore('diagrams').delete(id);
    const index = tx.objectStore('versions').index('byDiagram');
    for (const key of await index.getAllKeys(id)) {
      await tx.objectStore('versions').delete(key);
    }
    await tx.done;
  }

  async listVersions(diagramId: string): Promise<DiagramVersion[]> {
    const db = await this.db();
    const all = await db.getAllFromIndex('versions', 'byDiagram', diagramId);
    return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  async restoreVersion(
    diagramId: string,
    versionId: string,
    options: Pick<SaveOptions, 'expectedUpdatedAt'> = {},
  ): Promise<DiagramRecord> {
    return this.change(diagramId, async (existing, tx) => {
      if (options.expectedUpdatedAt && options.expectedUpdatedAt !== existing.updatedAt) {
        throw new DiagramConflictError();
      }
      const storedVersion = await tx.objectStore('versions').get(versionId);
      if (!storedVersion || storedVersion.diagramId !== diagramId) {
        throw new Error(`Version not found: ${versionId}`);
      }
      const version = DiagramVersionSchema.parse(storedVersion);
      await this.snapshot(tx, existing, 'before restore');
      return {
        ...existing,
        model: version.model,
        thumbnail: renderThumbnail(version.model),
        updatedAt: this.now(existing.updatedAt),
      };
    });
  }

  async exportWorkspace(): Promise<WorkspaceExport> {
    const db = await this.db();
    return {
      exportedAt: this.now(),
      diagrams: await db.getAll('diagrams'),
      versions: await db.getAll('versions'),
    };
  }

  /**
   * Merges an export into the store, giving every record a new ID.
   *
   * All or nothing, in two ways: every record is validated before any of them
   * is written, and the writes share one transaction. A dump that failed
   * halfway used to leave behind the diagrams it had already reached — the
   * reader was told the file was invalid while part of it appeared anyway.
   *
   * Returns the diagram count.
   */
  async importWorkspace(data: WorkspaceExport): Promise<number> {
    const diagrams = data.diagrams.map((raw) => DiagramRecordSchema.parse(raw));
    const versions = data.versions.map((raw) => DiagramVersionSchema.parse(raw));

    const db = await this.db();
    const idMap = new Map<string, string>();
    for (const parsed of diagrams) idMap.set(parsed.id, uid('dgm'));

    const tx = db.transaction(['diagrams', 'versions'], 'readwrite');
    for (const parsed of diagrams) {
      void tx.objectStore('diagrams').put({ ...parsed, id: idMap.get(parsed.id)! });
    }
    for (const parsed of versions) {
      const mappedDiagramId = idMap.get(parsed.diagramId);
      if (!mappedDiagramId) continue;
      void tx
        .objectStore('versions')
        .put({ ...parsed, id: uid('ver'), diagramId: mappedDiagramId });
    }
    await tx.done;

    return idMap.size;
  }

  /**
   * One-shot import of the original single-diagram localStorage autosave.
   * Safe to call on every boot: a flag makes it a no-op after the first run.
   */
  async migrateLegacyAutosave(storage: Pick<Storage, 'getItem'>): Promise<DiagramRecord | null> {
    const db = await this.db();
    if (await db.get('flags', LEGACY_LOCALSTORAGE_KEY)) return null;

    let record: DiagramRecord | null = null;
    try {
      const raw = storage.getItem(LEGACY_LOCALSTORAGE_KEY);
      if (raw) {
        const model = JSON.parse(raw);
        // Only import something that actually holds work.
        if (Array.isArray(model?.shapes) && model.shapes.length > 0) {
          record = await this.create({ title: 'Recovered diagram', model });
        }
      }
    } catch {
      // A corrupt legacy blob must not block startup; the flag below stops retries.
      record = null;
    }
    await db.put('flags', true, LEGACY_LOCALSTORAGE_KEY);
    return record;
  }

  /** The read, history/pruning, metadata and model commit are one atomic mutation. */
  private async change(
    id: string,
    update: (record: DiagramRecord, tx: WriteTransaction) => Promise<DiagramRecord>,
  ): Promise<DiagramRecord> {
    const db = await this.db();
    const tx = db.transaction(['diagrams', 'versions'], 'readwrite');
    try {
      const existing = await tx.objectStore('diagrams').get(id);
      if (!existing) throw new Error(`Diagram not found: ${id}`);
      const updated = DiagramRecordSchema.parse(await update(existing, tx));
      await tx.objectStore('diagrams').put(updated);
      await tx.done;
      return updated;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // A failed transaction may already have aborted itself.
      }
      await tx.done.catch(() => {});
      throw error;
    }
  }

  private async snapshot(
    tx: WriteTransaction,
    record: DiagramRecord,
    label: string | null,
  ): Promise<void> {
    const version: DiagramVersion = DiagramVersionSchema.parse({
      id: uid('ver'),
      diagramId: record.id,
      createdAt: this.now(record.updatedAt),
      label,
      model: record.model,
    });
    const versions = tx.objectStore('versions');
    await versions.put(version);

    const existing = await versions.index('byDiagram').getAll(record.id);
    if (existing.length <= MAX_VERSIONS_PER_DIAGRAM) return;
    const oldestFirst = existing.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    for (const stale of oldestFirst.slice(0, existing.length - MAX_VERSIONS_PER_DIAGRAM)) {
      await versions.delete(stale.id);
    }
  }
}
