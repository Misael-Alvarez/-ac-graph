/**
 * A PowerPoint deck: one slide per reading, each a picture of its view under
 * its name.
 *
 * The PDF export is for printing and the draw.io export for editing; this one
 * is for the meeting. An architecture review happens in somebody else's deck,
 * and a diagram that arrives as a `.pptx` gets dropped into it as it is — one
 * slide per view, already titled — where a PNG would be pasted, resized and
 * mislabelled by hand.
 *
 * The package is written by hand, like the PDF and the ZIP it sits in: a
 * PresentationML file is a dozen small XML parts and their relationships, and
 * the fixed ones are written once. The pictures are the same rasters the PNG
 * export makes, so a slide shows exactly what the screen did, in the theme the
 * export was asked for.
 *
 * Pure: takes pictures, returns bytes. No DOM, so it can be tested in Node.
 */

import {
  brandColors,
  canvasTheme,
  darkColors,
  lightColors,
  providerColors,
} from '@/lib/design/tokens';
import { zipStore, type ZipEntry } from './zip';

export interface PptxSlide {
  /** The words above the picture: the view's name, or the document's title. */
  title: string;
  png: Uint8Array;
  /** Pixel size of the PNG, which decides the picture's aspect ratio on the slide. */
  width: number;
  height: number;
}

export interface PptxOptions {
  /** The document's title, kept in the file's properties. */
  title: string;
  /** The theme the pictures were drawn on; the slides take its background. */
  dark: boolean;
  /** The creation stamp; now unless a test wants a fixed one. */
  created?: Date;
}

/* ── geometry, in EMU (914400 to the inch) ──────────────── */

/** 16:9, the widescreen default PowerPoint has used since 2013. */
export const SLIDE_W = 12192000;
export const SLIDE_H = 6858000;
/** Half an inch of air around everything on the slide. */
export const MARGIN = 457200;
/** The band the title sits in, and the gap between it and the picture. */
export const TITLE_H = 609600;
const TITLE_GAP = 228600;

/** The box a slide's picture may fill: the slide less its margins and the title band. */
export const CONTENT_BOX = {
  x: MARGIN,
  y: MARGIN + TITLE_H + TITLE_GAP,
  w: SLIDE_W - MARGIN * 2,
  h: SLIDE_H - MARGIN * 2 - TITLE_H - TITLE_GAP,
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a picture of these pixel proportions goes: as large as the content
 * box allows without distorting it, and centred in the room left over.
 */
export function fitPicture(width: number, height: number, box: Box = CONTENT_BOX): Box {
  if (width <= 0 || height <= 0) return { ...box };
  const scale = Math.min(box.w / width, box.h / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return {
    x: box.x + Math.round((box.w - w) / 2),
    y: box.y + Math.round((box.h - h) / 2),
    w,
    h,
  };
}

/* ── XML ────────────────────────────────────────────────── */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
};
const NS_DECL = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CONTENT_TYPE = {
  presentation:
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  slideMaster: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  slideLayout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
  tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
};

/** Escapes text for an XML attribute or text node, dropping what XML 1.0 forbids. */
function xml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A `#rrggbb` colour as DrawingML writes it: six upper-case hex digits. */
function rgb(hex: string): string {
  return hex.replace('#', '').toUpperCase();
}

function relationships(rels: readonly { id: string; type: string; target: string }[]): string {
  return (
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels
      .map((rel) => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"/>`)
      .join('') +
    '</Relationships>'
  );
}

/** The empty group every shape tree opens with; PowerPoint refuses a tree without it. */
const GROUP_HEAD =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

/* ── the fixed parts ────────────────────────────────────── */

function contentTypes(count: number): string {
  const overrides: [string, string][] = [
    ['/ppt/presentation.xml', CONTENT_TYPE.presentation],
    ['/ppt/slideMasters/slideMaster1.xml', CONTENT_TYPE.slideMaster],
    ['/ppt/slideLayouts/slideLayout1.xml', CONTENT_TYPE.slideLayout],
    ['/ppt/theme/theme1.xml', CONTENT_TYPE.theme],
    ['/ppt/presProps.xml', CONTENT_TYPE.presProps],
    ['/ppt/viewProps.xml', CONTENT_TYPE.viewProps],
    ['/ppt/tableStyles.xml', CONTENT_TYPE.tableStyles],
    ...Array.from({ length: count }, (_, i): [string, string] => [
      `/ppt/slides/slide${i + 1}.xml`,
      CONTENT_TYPE.slide,
    ]),
    ['/docProps/core.xml', CONTENT_TYPE.core],
    ['/docProps/app.xml', CONTENT_TYPE.app],
  ];
  return (
    XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    overrides
      .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
      .join('') +
    '</Types>'
  );
}

function coreProperties(title: string, stamp: string): string {
  return (
    XML_HEAD +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xml(title)}</dc:title><dc:creator>AC Graph</dc:creator><cp:lastModifiedBy>AC Graph</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>` +
    '</cp:coreProperties>'
  );
}

function appProperties(count: number): string {
  return (
    XML_HEAD +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    `<Application>AC Graph</Application><PresentationFormat>Widescreen</PresentationFormat>` +
    `<Slides>${count}</Slides><Notes>0</Notes><HiddenSlides>0</HiddenSlides>` +
    '<ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>' +
    '<HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion>' +
    '</Properties>'
  );
}

/**
 * The presentation part: the master, the slides in order, and the page.
 *
 * Slide ids start at 256 and master ids at 2^31, which is what PowerPoint
 * itself writes and what some readers quietly expect.
 */
function presentation(count: number): string {
  const slides = Array.from(
    { length: count },
    (_, i) => `<p:sldId id="${256 + i}" r:id="rId${2 + i}"/>`,
  ).join('');
  return (
    XML_HEAD +
    `<p:presentation ${NS_DECL} saveSubsetFonts="1">` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    `<p:sldIdLst>${slides}</p:sldIdLst>` +
    `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/>` +
    '<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>' +
    '<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">' +
    '<a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' +
    '<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>' +
    '</p:defaultTextStyle></p:presentation>'
  );
}

function presentationRels(count: number): string {
  const slides = Array.from({ length: count }, (_, i) => ({
    id: `rId${2 + i}`,
    type: `${REL}/slide`,
    target: `slides/slide${i + 1}.xml`,
  }));
  const next = 2 + count;
  return relationships([
    { id: 'rId1', type: `${REL}/slideMaster`, target: 'slideMasters/slideMaster1.xml' },
    ...slides,
    { id: `rId${next}`, type: `${REL}/presProps`, target: 'presProps.xml' },
    { id: `rId${next + 1}`, type: `${REL}/viewProps`, target: 'viewProps.xml' },
    { id: `rId${next + 2}`, type: `${REL}/theme`, target: 'theme/theme1.xml' },
    { id: `rId${next + 3}`, type: `${REL}/tableStyles`, target: 'tableStyles.xml' },
  ]);
}

const PRES_PROPS = XML_HEAD + `<p:presentationPr ${NS_DECL}/>`;

const VIEW_PROPS =
  XML_HEAD +
  `<p:viewPr ${NS_DECL}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>` +
  '<p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale>' +
  '<p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr>' +
  '<p:gridSpacing cx="76200" cy="76200"/></p:viewPr>';

const TABLE_STYLES =
  XML_HEAD + `<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;

/**
 * The master: the slide's background in the export theme's sheet colour, and
 * the colour map that makes `tx1` legible on it — swapped for the dark theme,
 * the way PowerPoint's own dark designs do it, so the title's "theme text
 * colour" is light on a dark sheet and dark on paper.
 */
function slideMaster(dark: boolean): string {
  const map = dark
    ? 'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"'
    : 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"';
  const text = (size: number, font: string) =>
    `<a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>` +
    `<a:latin typeface="+${font}-lt"/><a:ea typeface="+${font}-ea"/><a:cs typeface="+${font}-cs"/></a:defRPr>`;
  return (
    XML_HEAD +
    `<p:sldMaster ${NS_DECL}><p:cSld>` +
    `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${rgb(canvasTheme(dark).sheet)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
    `<p:spTree>${GROUP_HEAD}</p:spTree></p:cSld>` +
    `<p:clrMap ${map} accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    '<p:txStyles>' +
    `<p:titleStyle><a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${text(4400, 'mj')}</a:lvl1pPr></p:titleStyle>` +
    `<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${text(2800, 'mn')}</a:lvl1pPr></p:bodyStyle>` +
    `<p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">${text(1800, 'mn')}</a:lvl1pPr></p:otherStyle>` +
    '</p:txStyles></p:sldMaster>'
  );
}

const SLIDE_MASTER_RELS = relationships([
  { id: 'rId1', type: `${REL}/slideLayout`, target: '../slideLayouts/slideLayout1.xml' },
  { id: 'rId2', type: `${REL}/theme`, target: '../theme/theme1.xml' },
]);

/** A blank layout: the slides place their own title, so no placeholder is wanted. */
const SLIDE_LAYOUT =
  XML_HEAD +
  `<p:sldLayout ${NS_DECL} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP_HEAD}</p:spTree></p:cSld>` +
  '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';

const SLIDE_LAYOUT_RELS = relationships([
  { id: 'rId1', type: `${REL}/slideMaster`, target: '../slideMasters/slideMaster1.xml' },
]);

/**
 * A font the way DrawingML names it. `pitchFamily` 34 is "variable pitch,
 * Swiss": Office has no list of fallbacks, but when the face is missing it
 * substitutes by family, and this is what keeps a missing Geist from coming
 * back as a serif.
 */
const FONT_HINTS = 'pitchFamily="34" charset="0"';

/**
 * The theme: the app's colours — ink and sheet, the brand's purple and orange,
 * the four cloud brands the diagrams are painted with — and the app's face,
 * Geist, for headings. Body text is Calibri, which every Office has: what a
 * reader types onto a slide afterwards should not arrive in a substitute.
 * The format scheme is the schema's minimum, three of each, all plain.
 */
function theme(): string {
  const colour = (name: string, hex: string) =>
    `<a:${name}><a:srgbClr val="${rgb(hex)}"/></a:${name}>`;
  const plain = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (w: number) =>
    `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${plain}<a:prstDash val="solid"/></a:ln>`;
  const font = (typeface: string) =>
    `<a:latin typeface="${typeface}" ${FONT_HINTS}/><a:ea typeface=""/><a:cs typeface=""/>`;
  return (
    XML_HEAD +
    `<a:theme xmlns:a="${NS.a}" name="AC Graph"><a:themeElements>` +
    '<a:clrScheme name="AC Graph">' +
    colour('dk1', darkColors.canvasSheet) +
    colour('lt1', lightColors.canvasSheet) +
    colour('dk2', lightColors.textSecondary) +
    colour('lt2', darkColors.textSecondary) +
    colour('accent1', brandColors.from) +
    colour('accent2', brandColors.to) +
    colour('accent3', providerColors.aws) +
    colour('accent4', providerColors.azure) +
    colour('accent5', providerColors.gcp) +
    colour('accent6', providerColors.oci) +
    colour('hlink', lightColors.accent) +
    colour('folHlink', lightColors.accentHover) +
    '</a:clrScheme>' +
    `<a:fontScheme name="AC Graph"><a:majorFont>${font('Geist')}</a:majorFont><a:minorFont>${font('Calibri')}</a:minorFont></a:fontScheme>` +
    '<a:fmtScheme name="AC Graph">' +
    `<a:fillStyleLst>${plain}${plain}${plain}</a:fillStyleLst>` +
    `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>` +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    `<a:bgFillStyleLst>${plain}${plain}${plain}</a:bgFillStyleLst>` +
    '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'
  );
}

/* ── the slides ─────────────────────────────────────────── */

/**
 * One slide: the view's name in a text box across the top, and the picture
 * below it, as large as the room allows without stretching. The name is a
 * text box rather than a title placeholder so the layout stays blank and a
 * reader's own template, applied later, does not restyle it.
 */
function slide(entry: PptxSlide, index: number): string {
  const box = fitPicture(entry.width, entry.height);
  return (
    XML_HEAD +
    `<p:sld ${NS_DECL}><p:cSld><p:spTree>${GROUP_HEAD}` +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
    `<p:spPr><a:xfrm><a:off x="${MARGIN}" y="${MARGIN}"/><a:ext cx="${SLIDE_W - MARGIN * 2}" cy="${TITLE_H}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
    '<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"><a:normAutofit/></a:bodyPr><a:lstStyle/>' +
    '<a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-US" sz="2000" b="1" dirty="0">' +
    `<a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="Geist" ${FONT_HINTS}/></a:rPr>` +
    `<a:t>${xml(entry.title)}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:pic><p:nvPicPr><p:cNvPr id="3" name="Diagram ${index + 1}" descr="${xml(entry.title)}"/>` +
    '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    `<p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.w}" cy="${box.h}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
  );
}

function slideRels(index: number): string {
  return relationships([
    { id: 'rId1', type: `${REL}/slideLayout`, target: '../slideLayouts/slideLayout1.xml' },
    { id: 'rId2', type: `${REL}/image`, target: `../media/image${index + 1}.png` },
  ]);
}

/* ── the package ────────────────────────────────────────── */

const encoder = new TextEncoder();

/**
 * Builds the `.pptx`: every part in the order PowerPoint writes them, content
 * types first, stored in a ZIP stamped with the creation date.
 */
export function toPptx(slides: readonly PptxSlide[], options: PptxOptions): Uint8Array {
  if (!slides.length) throw new Error('A presentation needs at least one slide.');
  const created = options.created ?? new Date();
  // Whole seconds: the ZIP keeps two-second resolution and the properties
  // should not claim more precision than the archive does.
  const stamp = created.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const part = (name: string, text: string): ZipEntry => ({ name, data: encoder.encode(text) });

  const entries: ZipEntry[] = [
    part('[Content_Types].xml', contentTypes(slides.length)),
    part(
      '_rels/.rels',
      relationships([
        { id: 'rId1', type: `${REL}/officeDocument`, target: 'ppt/presentation.xml' },
        {
          id: 'rId2',
          type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
          target: 'docProps/core.xml',
        },
        { id: 'rId3', type: `${REL}/extended-properties`, target: 'docProps/app.xml' },
      ]),
    ),
    part('docProps/core.xml', coreProperties(options.title, stamp)),
    part('docProps/app.xml', appProperties(slides.length)),
    part('ppt/presentation.xml', presentation(slides.length)),
    part('ppt/_rels/presentation.xml.rels', presentationRels(slides.length)),
    part('ppt/presProps.xml', PRES_PROPS),
    part('ppt/viewProps.xml', VIEW_PROPS),
    part('ppt/tableStyles.xml', TABLE_STYLES),
    part('ppt/slideMasters/slideMaster1.xml', slideMaster(options.dark)),
    part('ppt/slideMasters/_rels/slideMaster1.xml.rels', SLIDE_MASTER_RELS),
    part('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT),
    part('ppt/slideLayouts/_rels/slideLayout1.xml.rels', SLIDE_LAYOUT_RELS),
    part('ppt/theme/theme1.xml', theme()),
  ];
  for (const [index, entry] of slides.entries()) {
    entries.push(
      part(`ppt/slides/slide${index + 1}.xml`, slide(entry, index)),
      part(`ppt/slides/_rels/slide${index + 1}.xml.rels`, slideRels(index)),
      { name: `ppt/media/image${index + 1}.png`, data: entry.png },
    );
  }
  return zipStore(entries, created);
}
