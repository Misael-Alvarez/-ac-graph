import type { DiagramModel } from '@/lib/domain';
import { serializeDsl, toMermaid } from '@/lib/dsl';
import { exportToMarkdown } from '@/lib/engine';
import { canvasTheme } from '@/lib/design/tokens';
import { diagramToSvgStringClient } from './renderSvgClient';
import { rasterToPdf, rgbaToRgb } from './pdf';
import type { DiagramDocumentProps } from '@/components/editor/canvas/DiagramDocument';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * A safe file stem from a diagram title.
 *
 * Accents are kept — they are legal in every modern filesystem — but path
 * separators, control characters and the handful of characters Windows refuses
 * are not. An empty title falls back to the generic name.
 */
export function fileStem(title: string | undefined, fallback = 'diagram'): string {
  const stem = (title ?? '')
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return stem || fallback;
}

export function downloadSvg(options: DiagramDocumentProps, filename = 'diagram.svg'): void {
  triggerDownload(
    new Blob([diagramToSvgStringClient(options)], { type: 'image/svg+xml' }),
    filename,
  );
}

export interface PngOptions extends DiagramDocumentProps {
  /** Device-pixel multiplier; 2 gives a crisp result on retina displays. */
  pixelRatio?: number;
}

/** Rasterises the SVG document onto an offscreen canvas. */
async function rasterise({ pixelRatio = 2, ...options }: PngOptions): Promise<HTMLCanvasElement> {
  const svg = diagramToSvgStringClient({ ...options, scale: pixelRatio });
  // A data URL keeps the image same-origin, so the canvas is never tainted.
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not rasterise the diagram'));
    image.src = encoded;
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(image, 0, 0);
  return canvas;
}

export async function downloadPng(options: PngOptions, filename = 'diagram.png'): Promise<void> {
  const canvas = await rasterise(options);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the PNG');
  triggerDownload(blob, filename);
}

/**
 * A one-page PDF of the diagram, rendered at print density.
 *
 * Rasterised rather than vector: the SVG leans on `<use>` symbols, filters and
 * web fonts that PDF readers disagree about, and a print is judged by whether
 * it looks like the screen. 3× pixel ratio at 216 dpi keeps text crisp on paper.
 */
export async function downloadPdf(options: PngOptions, filename = 'diagram.pdf'): Promise<void> {
  const pixelRatio = options.pixelRatio ?? 3;
  const canvas = await rasterise({ ...options, pixelRatio });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const sheet = canvasTheme(options.dark).sheet;
  const background: [number, number, number] = [
    parseInt(sheet.slice(1, 3), 16),
    parseInt(sheet.slice(3, 5), 16),
    parseInt(sheet.slice(5, 7), 16),
  ];
  const bytes = await rasterToPdf({
    width: canvas.width,
    height: canvas.height,
    rgb: rgbaToRgb(data, background),
    dpi: 72 * pixelRatio,
    title: filename.replace(/\.pdf$/i, ''),
  });
  triggerDownload(new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename);
}

export function downloadMarkdown(model: DiagramModel, filename = 'architecture.md'): void {
  triggerDownload(new Blob([exportToMarkdown(model)], { type: 'text/markdown' }), filename);
}

/** The architecture as the YAML DSL, which compiles back losslessly. */
export function downloadYaml(
  model: DiagramModel,
  filename = 'architecture.yaml',
  title?: string,
): void {
  triggerDownload(
    new Blob([serializeDsl(model, title ? { title } : {})], { type: 'application/yaml' }),
    filename,
  );
}

/** A Mermaid flowchart, which GitHub and GitLab render natively. */
export function downloadMermaid(model: DiagramModel, filename = 'architecture.mmd'): void {
  triggerDownload(new Blob([toMermaid(model)], { type: 'text/plain' }), filename);
}

export function downloadProject(model: DiagramModel, filename = 'diagram.json'): void {
  triggerDownload(
    new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' }),
    filename,
  );
}
