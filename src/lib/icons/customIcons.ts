import type { CustomIcon } from '@/lib/domain';

/** Every icon of the author's own carries this prefix in its key. */
export const CUSTOM_ICON_PREFIX = 'custom-';

/** Uploads larger than this are refused: an icon is a glyph, not a poster. */
export const MAX_ICON_BYTES = 256 * 1024;

export const ACCEPTED_ICON_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];

export function isCustomIconKey(key: string | undefined): key is string {
  return typeof key === 'string' && key.startsWith(CUSTOM_ICON_PREFIX);
}

/**
 * A key for a new icon: the name as a slug plus a short random tail, so two
 * icons named "Gateway" never collide and a renamed icon keeps its references.
 */
export function customIconKey(name: string, random: () => number = Math.random): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const tail = Math.floor(random() * 36 ** 5)
    .toString(36)
    .padStart(5, '0');
  return `${CUSTOM_ICON_PREFIX}${slug || 'icon'}-${tail}`;
}

/* What an uploaded SVG is allowed to keep. Anything that runs, loads or reaches
   outside the picture is removed; the picture itself is kept whole. */
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'style',
  'link',
  'meta',
  'base',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'audio',
  'video',
]);

export interface SanitizedSvg {
  viewBox: string;
  body: string;
}

/**
 * Takes an SVG source apart and keeps only what draws.
 *
 * Scripts, event handlers, external references and stylesheets go; `<style>`
 * goes too, because a rule inside a symbol applies to the whole page it is
 * drawn on. Every `id` inside is prefixed with the icon's key, so two uploaded
 * icons that both define a gradient called `a` do not paint each other. The
 * result is the inner markup and the viewBox, which is all a `<symbol>` needs.
 *
 * Needs a DOM (`DOMParser`); the browser has one, and the tests bring one.
 */
export function sanitizeSvg(source: string, key: string): SanitizedSvg | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
  if (doc.getElementsByTagName('parsererror').length) return null;

  const ids = new Set<string>();
  const walk = (element: Element) => {
    for (const child of [...element.children]) {
      if (FORBIDDEN_ELEMENTS.has(child.nodeName.toLowerCase())) {
        child.remove();
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith('on')) child.removeAttribute(attr.name);
        else if (name === 'href' || name === 'xlink:href') {
          if (!value.startsWith('#') && !/^data:image\//i.test(value)) {
            child.removeAttribute(attr.name);
          }
        } else if (name === 'style' && /url\(|expression\(|@import/i.test(value)) {
          child.removeAttribute(attr.name);
        } else if (name === 'id') ids.add(value);
      }
      walk(child);
    }
  };
  walk(root);

  const viewBox = root.getAttribute('viewBox')?.trim() || viewBoxFromSize(root) || '0 0 24 24';
  let body = root.innerHTML.trim();
  if (!body) return null;

  // Namespace the ids so icons cannot reach into one another.
  for (const id of ids) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body
      .replace(new RegExp(`id="${safe}"`, 'g'), `id="${key}-${id}"`)
      .replace(new RegExp(`url\\(#${safe}\\)`, 'g'), `url(#${key}-${id})`)
      .replace(new RegExp(`href="#${safe}"`, 'g'), `href="#${key}-${id}"`);
  }
  return { viewBox, body };
}

function viewBoxFromSize(root: Element): string | null {
  const width = parseFloat(root.getAttribute('width') ?? '');
  const height = parseFloat(root.getAttribute('height') ?? '');
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return `0 0 ${width} ${height}`;
  }
  return null;
}

/** The parts of a custom icon a form collects before the file is read. */
export interface CustomIconDraft {
  name: string;
  description?: string;
  source?: string;
  tags?: string[];
}

export type IconFileResult =
  { ok: true; icon: CustomIcon } | { ok: false; reason: 'type' | 'size' | 'invalid' };

/**
 * Reads an uploaded file into an icon.
 *
 * An SVG is sanitised and kept as vector; a raster is kept as a data URL. The
 * size limit applies to the file as uploaded, before either.
 */
export async function readIconFile(
  file: File,
  draft: CustomIconDraft,
  now: () => string = () => new Date().toISOString(),
): Promise<IconFileResult> {
  const type = file.type || (file.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : '');
  if (!ACCEPTED_ICON_TYPES.includes(type)) return { ok: false, reason: 'type' };
  if (file.size > MAX_ICON_BYTES) return { ok: false, reason: 'size' };
  const key = customIconKey(draft.name);
  const base: CustomIcon = {
    key,
    name: draft.name.trim(),
    description: draft.description?.trim() || undefined,
    source: draft.source?.trim() || undefined,
    tags: draft.tags
      ?.map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 12),
    createdAt: now(),
  };
  if (!base.tags?.length) delete base.tags;
  if (type === 'image/svg+xml') {
    const svg = sanitizeSvg(await file.text(), key);
    if (!svg) return { ok: false, reason: 'invalid' };
    return { ok: true, icon: { ...base, svg } };
  }
  const image = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  }).catch(() => null);
  if (!image?.startsWith('data:image/')) return { ok: false, reason: 'invalid' };
  return { ok: true, icon: { ...base, image } };
}

/** Whether a custom icon answers a search: by name, source or tag. */
export function customIconMatches(icon: CustomIcon, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [icon.name, icon.source ?? '', icon.description ?? '', ...(icon.tags ?? [])].some(
    (field) => field.toLowerCase().includes(needle),
  );
}
