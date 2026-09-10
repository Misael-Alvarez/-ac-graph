/**
 * Category glyphs for generated service marks.
 *
 * Drawn on the same 64x64 canvas as the official AWS architecture icons, in the
 * same idiom — a solid coloured square with a white symbol — so a diagram mixing
 * official artwork and generated marks still reads as one set. At the 24px these
 * render at, the icon's job is to say which kind of thing this is; the label
 * beside it says which one.
 */
export const GLYPHS = {
  compute:
    '<rect x="18" y="18" width="28" height="28" rx="4"/><path d="M25 10h3v8h-3zm11 0h3v8h-3zM25 46h3v8h-3zm11 0h3v8h-3zM10 25h8v3h-8zm0 11h8v3h-8zM46 25h8v3h-8zm0 11h8v3h-8z"/>',
  containers:
    '<path d="M14 18h15v13H14zm21 0h15v13H35zM14 35h15v13H14zm21 0h15v13H35z" opacity=".9"/>',
  serverless: '<path d="M34 12 18 36h12l-2 18 18-26H33z"/>',
  storage:
    '<ellipse cx="32" cy="19" rx="18" ry="7"/><path d="M14 25c0 3.9 8.1 7 18 7s18-3.1 18-7v8c0 3.9-8.1 7-18 7s-18-3.1-18-7z"/><path d="M14 39c0 3.9 8.1 7 18 7s18-3.1 18-7v6c0 3.9-8.1 7-18 7s-18-3.1-18-7z"/>',
  database:
    '<ellipse cx="32" cy="18" rx="17" ry="7"/><path d="M15 25v21c0 3.9 7.6 7 17 7s17-3.1 17-7V25c0 3.9-7.6 7-17 7s-17-3.1-17-7z"/>',
  analytics: '<path d="M15 42h7v10h-7zm10-14h7v24h-7zm10-10h7v34h-7zm10 20h7v14h-7z"/>',
  ai: '<path d="M32 10l4.4 11.6L48 26l-11.6 4.4L32 42l-4.4-11.6L16 26l11.6-4.4z"/><circle cx="46" cy="46" r="5"/><circle cx="19" cy="45" r="3.5"/>',
  integration:
    '<path d="M10 20h26v7H10zm0 17h26v7H10z"/><path d="m38 14 14 9.5L38 33V14zm0 17 14 9.5L38 50V31z"/>',
  networking:
    '<circle cx="32" cy="32" r="18" fill="none" stroke="#fff" stroke-width="4"/><ellipse cx="32" cy="32" rx="8.5" ry="18" fill="none" stroke="#fff" stroke-width="3.4"/><path d="M14 32h36" stroke="#fff" stroke-width="3.4"/>',
  security: '<path d="M32 10 14 17v15c0 11 7.6 20 18 22.2C42.4 52 50 43 50 32V17z"/>',
  devops: '<path d="M32 15a17 17 0 1 0 17 17h-6a11 11 0 1 1-11-11z"/><path d="M30 8h14v14H30z"/>',
  management:
    '<path d="M12 19h40v4H12zm0 11h40v4H12zm0 11h40v4H12z" opacity=".55"/><circle cx="23" cy="21" r="6"/><circle cx="41" cy="32" r="6"/><circle cx="29" cy="43" r="6"/>',
  iot: '<circle cx="32" cy="42" r="7"/><path d="M21 31a16 16 0 0 1 22 0" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><path d="M14 22a26 26 0 0 1 36 0" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>',
  other:
    '<circle cx="32" cy="32" r="15" fill="none" stroke="#fff" stroke-width="4.5"/><circle cx="32" cy="32" r="6"/>',
};

/**
 * Vendor colours.
 *
 * The square carries the provider, not the category: a diagram is usually built
 * on one cloud, and within it the glyph is what distinguishes services. Reading
 * the vendor from the colour is what makes a mixed-cloud diagram legible.
 */
export const VENDOR_COLORS = {
  aws: '#ec7211',
  azure: '#0078d4',
  gcp: '#1a73e8',
  oci: '#c74634',
  ibm: '#0f62fe',
  generic: '#5f6368',
  aion: '#6b2fa0',
};

/** One generated 64x64 symbol. */
export function renderMark(cloud, category) {
  const colour = VENDOR_COLORS[cloud] ?? VENDOR_COLORS.generic;
  const glyph = GLYPHS[category] ?? GLYPHS.other;
  return `<path fill="${colour}" d="M0 0h64v64H0z"/><g fill="#fff">${glyph}</g>`;
}
