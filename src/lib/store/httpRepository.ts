import {
  DiagramMetaSchema,
  DiagramRecordSchema,
  DiagramVersionSchema,
  type DiagramMeta,
  type DiagramModel,
  type DiagramRecord,
  type DiagramVersion,
} from '@/lib/domain';
import { DiagramConflictError } from './localRepository';
import type { CreateDiagramInput, DiagramRepository, SaveOptions, WorkspaceExport } from './types';

/**
 * The repository the editor uses in server mode.
 *
 * Exactly the `DiagramRepository` shape over `fetch`, same-origin, cookie
 * authenticated. Every mutating call carries the `x-requested-with` marker the
 * server demands, and `expectedUpdatedAt` travels as `If-Match` so a stale save
 * comes back as the same `DiagramConflictError` the local store throws.
 */
export const REQUESTED_WITH_HEADER = 'x-requested-with';
export const REQUESTED_WITH_VALUE = 'ac-graph';

/** The session is missing or expired; the UI should send the user to login. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('Sign in to continue.');
    this.name = 'UnauthenticatedError';
  }
}

/** Any other non-2xx answer, with the server's typed code. */
export class HttpRepositoryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpRepositoryError';
  }
}

/** A `DiagramConflictError` that also carries what the server has now. */
export class RemoteConflictError extends DiagramConflictError {
  constructor(readonly current: DiagramRecord | null) {
    super();
  }
}

export interface HttpRepositoryOptions {
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Prefix for every path; empty for same-origin. */
  baseUrl?: string;
}

interface RequestOptions {
  body?: unknown;
  ifMatch?: string;
}

interface ErrorPayload {
  code?: string;
  message?: string;
  current?: unknown;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class HttpDiagramRepository implements DiagramRepository {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: HttpRepositoryOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? '';
  }

  async list(): Promise<DiagramMeta[]> {
    const rows = await this.request<unknown[]>('GET', '/api/diagrams');
    return rows.map((row) => DiagramMetaSchema.parse(row));
  }

  async get(id: string): Promise<DiagramRecord | null> {
    try {
      return DiagramRecordSchema.parse(
        await this.request<unknown>('GET', `/api/diagrams/${encodeURIComponent(id)}`),
      );
    } catch (error) {
      if (error instanceof HttpRepositoryError && error.status === 404) return null;
      throw error;
    }
  }

  async create(input: CreateDiagramInput): Promise<DiagramRecord> {
    return DiagramRecordSchema.parse(
      await this.request<unknown>('POST', '/api/diagrams', { body: input }),
    );
  }

  async save(id: string, model: DiagramModel, options: SaveOptions = {}): Promise<DiagramRecord> {
    const { expectedUpdatedAt, ...rest } = options;
    return DiagramRecordSchema.parse(
      await this.request<unknown>('PUT', `/api/diagrams/${encodeURIComponent(id)}`, {
        body: { model, options: rest },
        ifMatch: expectedUpdatedAt,
      }),
    );
  }

  async updateMeta(
    id: string,
    patch: Partial<Pick<DiagramMeta, 'title' | 'description' | 'folder' | 'thumbnail'>>,
  ): Promise<DiagramRecord> {
    return DiagramRecordSchema.parse(
      await this.request<unknown>('PATCH', `/api/diagrams/${encodeURIComponent(id)}`, {
        body: patch,
      }),
    );
  }

  async duplicate(id: string): Promise<DiagramRecord> {
    return DiagramRecordSchema.parse(
      await this.request<unknown>('POST', `/api/diagrams/${encodeURIComponent(id)}/duplicate`),
    );
  }

  async delete(id: string): Promise<void> {
    await this.request<void>('DELETE', `/api/diagrams/${encodeURIComponent(id)}`);
  }

  async listVersions(diagramId: string): Promise<DiagramVersion[]> {
    const rows = await this.request<unknown[]>(
      'GET',
      `/api/diagrams/${encodeURIComponent(diagramId)}/versions`,
    );
    return rows.map((row) => DiagramVersionSchema.parse(row));
  }

  async restoreVersion(
    diagramId: string,
    versionId: string,
    options: Pick<SaveOptions, 'expectedUpdatedAt'> = {},
  ): Promise<DiagramRecord> {
    const path = `/api/diagrams/${encodeURIComponent(diagramId)}/versions/${encodeURIComponent(versionId)}/restore`;
    return DiagramRecordSchema.parse(
      await this.request<unknown>('POST', path, { ifMatch: options.expectedUpdatedAt }),
    );
  }

  async exportWorkspace(): Promise<WorkspaceExport> {
    return this.request<WorkspaceExport>('GET', '/api/workspace/export');
  }

  async importWorkspace(data: WorkspaceExport): Promise<number> {
    const result = await this.request<{ imported: number }>('POST', '/api/workspace/import', {
      body: data,
    });
    return result.imported;
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (MUTATING.has(method)) headers[REQUESTED_WITH_HEADER] = REQUESTED_WITH_VALUE;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.ifMatch) headers['If-Match'] = options.ifMatch;

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (response.status === 204) return undefined as T;
    if (response.ok) return (await response.json()) as T;

    const payload = await readErrorPayload(response);
    if (response.status === 401) throw new UnauthenticatedError();
    if (response.status === 412) {
      const current = DiagramRecordSchema.safeParse(payload.current);
      throw new RemoteConflictError(current.success ? current.data : null);
    }
    throw new HttpRepositoryError(
      response.status,
      payload.code ?? 'error',
      payload.message ?? `Request failed with status ${response.status}.`,
    );
  }
}

async function readErrorPayload(response: Response): Promise<ErrorPayload> {
  try {
    const parsed: unknown = await response.json();
    return parsed && typeof parsed === 'object' ? (parsed as ErrorPayload) : {};
  } catch {
    return {};
  }
}
