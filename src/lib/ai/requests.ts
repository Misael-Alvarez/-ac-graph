import { nanoid } from 'nanoid';
import type { DiagramModel } from '@/lib/domain';
import type { Diagnostic } from '@/lib/dsl';
import type { Locale } from '@/lib/i18n/messages';

export type AiOperation = 'generate' | 'modify' | 'retarget';

export interface GenerateResult {
  title: string;
  summary: string;
  cloud: string;
  model: DiagramModel;
  /** Services the model named that do not exist; those nodes were left out. */
  dropped: string[];
  diagnostics: Diagnostic[];
  usage: { input: number; output: number; cacheRead: number };
}

export class AiError extends Error {
  readonly code: string;
  readonly retryAfter?: number;

  /* Fields, not constructor parameter properties: those are TypeScript-only
     sugar and Node's type stripping refuses them, which would keep this module
     out of anything running the library outside a bundler. */
  constructor(code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const SESSION_KEY = 'aion-studio-session';

/** A stable per-browser id so rate limiting can tell visitors apart behind one NAT. */
function sessionId(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = nanoid(12);
    window.localStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return 'anon';
  }
}

function headers(): HeadersInit {
  return { 'content-type': 'application/json', 'x-studio-session': sessionId() };
}

async function failure(response: Response): Promise<AiError> {
  const body = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
  } | null;
  const retryAfter = Number(response.headers.get('retry-after'));
  return new AiError(
    body?.code ?? 'unknown',
    body?.message ?? 'The request failed.',
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

export async function requestDiagram(
  operation: AiOperation,
  prompt: string,
  model: DiagramModel | undefined,
  locale: Locale,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const response = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ operation, prompt, model, locale }),
    signal,
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as GenerateResult;
}

/** Streams a prose answer, calling `onChunk` as text arrives. */
export async function requestReview(
  question: string,
  model: DiagramModel,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/ai/explain', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ question, model }),
    signal,
  });
  if (!response.ok) throw await failure(response);
  if (!response.body) throw new AiError('no_body', 'The response was empty.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}
