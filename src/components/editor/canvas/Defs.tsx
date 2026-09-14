import { spriteFor } from '@/components/icons/svgIconDefs';
import type { CanvasTheme } from '@/lib/design/tokens';
import type { CustomIcon } from '@/lib/domain';
import { arrowheadIdFor } from '@/lib/editor/meta';

/**
 * Shared SVG definitions: the service icon sprite, the arrowhead marker and the
 * card shadow.
 *
 * The sprite string already carries its own `arrow` marker, so nothing else may
 * define one — the previous editor appended a second marker with the same id,
 * leaving which arrowhead won up to document order.
 */
export function Defs({
  theme,
  idPrefix = '',
  iconKeys,
  customIcons = [],
  connectorColors = [],
}: {
  theme: CanvasTheme;
  idPrefix?: string;
  /** Only these service symbols are emitted. The full set is ~300KB, and it is
   *  inlined into every exported file and every embed image. */
  iconKeys: Iterable<string>;
  /** The document's own icons; those in use are emitted as symbols too. */
  customIcons?: CustomIcon[];
  /** Colours the author gave connectors: each needs an arrowhead of its own. */
  connectorColors?: string[];
}) {
  const wanted = new Set(iconKeys);
  // A marker cannot take its colour from the path it ends, so every colour a
  // line wears gets a head to match; without one, a coloured line ends in a
  // grey point, which is the first thing anyone sees.
  const heads: [string, string][] = [
    ['arrowhead', theme.connector],
    ['arrowhead-ink', theme.titleText],
    ...connectorColors.map((color): [string, string] => [arrowheadIdFor(color), color]),
  ];
  return (
    <defs>
      <g dangerouslySetInnerHTML={{ __html: spriteFor(wanted) }} />
      {/* Uploaded icons, as symbols with the same `i-` ids the catalogue uses,
          so a card draws them with the very same `<use>`. The SVG body was
          sanitised when uploaded; a raster is wrapped as an image. */}
      {customIcons
        .filter((icon) => wanted.has(icon.key))
        .map((icon) =>
          icon.svg ? (
            <symbol
              key={icon.key}
              id={`i-${icon.key}`}
              viewBox={icon.svg.viewBox}
              dangerouslySetInnerHTML={{ __html: icon.svg.body }}
            />
          ) : icon.image ? (
            <symbol key={icon.key} id={`i-${icon.key}`} viewBox="0 0 24 24">
              <image href={icon.image} width={24} height={24} preserveAspectRatio="xMidYMid meet" />
            </symbol>
          ) : null,
        )}
      {/* Sized in user space, not in stroke widths: a data flow drawn at 2.6px
          would otherwise wear a head half again as large as its neighbours.
          The back of the head is drawn in a shallow curve, so it reads as a
          point rather than a triangle. */}
      {heads.map(([name, fill]) => (
        <marker
          key={name}
          id={`${idPrefix}${name}`}
          viewBox="0 0 12 12"
          refX="10.5"
          refY="6"
          markerWidth="11"
          markerHeight="11"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
        >
          <path d="M1.5,1.5 L11,6 L1.5,10.5 Q4,6 1.5,1.5 z" fill={fill} />
        </marker>
      ))}
      <filter id={`${idPrefix}card-shadow`} x="-10%" y="-10%" width="120%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor={theme.shadow} />
      </filter>
      {/* The material of a card: light catching its top edge, weight settling
          at its foot. Two gradients laid over the fill, faint enough that a
          card is still its colour and present enough that it is not a flat
          rectangle. On paper the white is invisible and the shade does the
          work; on the dark sheet it is the other way round. */}
      <linearGradient id={`${idPrefix}card-gloss`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.09" />
        <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id={`${idPrefix}card-shade`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.5" stopColor="#000000" stopOpacity="0" />
        <stop offset="1" stopColor="#000000" stopOpacity="0.06" />
      </linearGradient>
    </defs>
  );
}
