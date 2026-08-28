import { DiagramModelSchema, type DiagramModel } from '@/lib/domain';

/**
 * Packs a diagram into a URL-safe string.
 *
 * Diagrams live in the browser's IndexedDB, which a server route cannot read, so
 * a shared link has to carry the diagram itself. Deflate plus base64url gets a
 * typical diagram to a couple of kilobytes; `CompressionStream` is built into
 * both the browser and Node, so this costs no dependency.
 *
 * When the backend lands this becomes the fallback: a short id resolved
 * server-side, with the same public interface.
 */

/** Beyond this a URL starts breaking in mail clients, chat apps and proxies. */
export const MAX_PAYLOAD_LENGTH = 6000;

export class PayloadTooLargeError extends Error {
  readonly length: number;

  constructor(length: number) {
    super(`The diagram is too large to fit in a link (${length} characters).`);
    this.name = 'PayloadTooLargeError';
    this.length = length;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const source = new Blob([bytes as BlobPart]).stream();
  return new Uint8Array(await new Response(source.pipeThrough(stream)).arrayBuffer());
}

/** Compresses a diagram into a link payload. */
export async function encodeDiagram(model: DiagramModel): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(stripForSharing(model)));
  const deflated = await pipe(json, new CompressionStream('deflate-raw'));
  const payload = toBase64Url(deflated);
  if (payload.length > MAX_PAYLOAD_LENGTH) throw new PayloadTooLargeError(payload.length);
  return payload;
}

/** Reads a link payload back into a diagram. Throws on anything malformed. */
export async function decodeDiagram(payload: string): Promise<DiagramModel> {
  const inflated = await pipe(fromBase64Url(payload), new DecompressionStream('deflate-raw'));
  return DiagramModelSchema.parse(JSON.parse(new TextDecoder().decode(inflated)));
}

/** Non-throwing variant, for untrusted input arriving from a URL. */
export async function safeDecodeDiagram(payload: string): Promise<DiagramModel | null> {
  try {
    return await decodeDiagram(payload);
  } catch {
    return null;
  }
}

/**
 * Drops what a viewer does not need.
 *
 * Connector waypoints are recomputed by the router on load, and they are a large
 * share of the payload — leaving them out is the difference between a link that
 * fits and one that does not.
 */
function stripForSharing(model: DiagramModel): DiagramModel {
  return {
    ...model,
    connectors: model.connectors.map((c) => ({ ...c, waypoints: [] })),
  };
}
