import type { DiagramModel } from '@/lib/domain';
import { serializeDsl, toMermaid } from '@/lib/dsl';
import { exportToMarkdown } from '@/lib/engine';
import { canvasTheme } from '@/lib/design/tokens';
import { diagramToSvgStringClient } from './renderSvgClient';
import { type RasterPage, rasterToPdf, rastersToPdf, rgbaToRgb } from './pdf';
import { type DrawioOptions, type DrawioPage, toDrawio } from './drawio';
import { type PptxSlide, toPptx } from './pptx';
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

/** Encodes the rasterised diagram as PNG, with the pixel size the encoder was given. */
async function rasterPng(
  options: PngOptions,
): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = await rasterise(options);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the PNG');
  return { blob, width: canvas.width, height: canvas.height };
}

export async function downloadPng(options: PngOptions, filename = 'diagram.png'): Promise<void> {
  triggerDownload((await rasterPng(options)).blob, filename);
}

/**
 * A one-page PDF of the diagram, rendered at print density.
 *
 * Rasterised rather than vector: the SVG leans on `<use>` symbols, filters and
 * web fonts that PDF readers disagree about, and a print is judged by whether
 * it looks like the screen. 3× pixel ratio at 216 dpi keeps text crisp on paper.
 */
export async function downloadPdf(options: PngOptions, filename = 'diagram.pdf'): Promise<void> {
  const bytes = await rasterToPdf(await rasterPage(options, filename.replace(/\.pdf$/i, '')));
  triggerDownload(new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename);
}

/**
 * One PDF, one page per reading of the diagram — every view, in order — so a
 * presentation can be handed over as a document. Each page is sized to its
 * own view, at the same print density as the single-page export.
 */
export async function downloadPdfPages(
  pages: readonly PngOptions[],
  filename = 'diagram.pdf',
): Promise<void> {
  const title = filename.replace(/\.pdf$/i, '');
  const rasters: RasterPage[] = [];
  for (const [index, options] of pages.entries()) {
    rasters.push(await rasterPage(options, options.title ?? `${title} ${index + 1}`));
  }
  const bytes = await rastersToPdf(rasters, { title });
  triggerDownload(new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename);
}

export interface PptxSlideOptions extends PngOptions {
  /** What the slide says above the picture: the view's name, or the document's. */
  heading: string;
}

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** A finished deck, as bytes, to the reader's downloads. */
export function downloadPptx(bytes: Uint8Array, filename = 'diagram.pptx'): void {
  triggerDownload(new Blob([bytes as BlobPart], { type: PPTX_TYPE }), filename);
}

/**
 * One deck, one slide per reading — every view, in order — each a picture of
 * its view under its name, so the diagram lands in a meeting's slides as it
 * is. The pictures are the PNG export's own, at its 2× density, on the theme
 * and with the metadata every other export was asked for.
 */
export async function downloadPptxSlides(
  slides: readonly PptxSlideOptions[],
  options: { title: string; dark: boolean },
  filename = 'diagram.pptx',
): Promise<void> {
  const rendered: PptxSlide[] = [];
  for (const { heading, ...page } of slides) {
    const { blob, width, height } = await rasterPng(page);
    rendered.push({ title: heading, png: new Uint8Array(await blob.arrayBuffer()), width, height });
  }
  downloadPptx(toPptx(rendered, options), filename);
}

async function rasterPage(options: PngOptions, title: string): Promise<RasterPage> {
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
  return {
    width: canvas.width,
    height: canvas.height,
    rgb: rgbaToRgb(data, background),
    dpi: 72 * pixelRatio,
    title,
  };
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

/**
 * A draw.io file, one page per reading, which diagrams.net opens for editing
 * with the service icons embedded. Plain XML rather than deflated: draw.io
 * reads both, and only one of them can be diffed.
 */
export function downloadDrawio(
  pages: readonly DrawioPage[],
  options: DrawioOptions,
  filename = 'diagram.drawio',
): void {
  triggerDownload(new Blob([toDrawio(pages, options)], { type: 'application/xml' }), filename);
}

export function downloadProject(model: DiagramModel, filename = 'diagram.json'): void {
  triggerDownload(
    new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' }),
    filename,
  );
}
