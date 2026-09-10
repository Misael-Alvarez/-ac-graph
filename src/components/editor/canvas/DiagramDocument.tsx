import type { DiagramModel } from '@/lib/domain';
import { canvasTheme, fontSize, fontWeight, providerColors } from '@/lib/design/tokens';
import { iconKeysIn, contentBBox } from '@/lib/engine';
import { AION_LOGO } from '@/data/aionLogo';
import type { BrandMode } from '@/lib/editor';
import { Defs } from './Defs';
import { DiagramScene } from './DiagramScene';

export interface DiagramDocumentProps {
  model: DiagramModel;
  dark?: boolean;
  brand?: BrandMode;
  padding?: number;
  /** Multiplies the pixel dimensions; the viewBox is unchanged. */
  scale?: number;
  /** The document's name, as the SVG's `<title>`. */
  title?: string;
  /** What the picture says, as the SVG's `<desc>`, for readers who cannot see it. */
  description?: string;
}

const FOOTER_H = 56;

/**
 * A complete, self-contained `<svg>` document.
 *
 * Used for file export and for server-rendered embeds. Everything it needs is
 * inline — icon symbols, the logo as a data URL, literal colours — because a
 * downloaded .svg has no stylesheet and no access to the app's /public folder.
 */
export function DiagramDocument({
  model,
  dark = false,
  brand = 'none',
  padding = 48,
  scale = 1,
  title,
  description,
}: DiagramDocumentProps) {
  const theme = canvasTheme(dark);
  const box = contentBBox(model);
  const showFooter = brand !== 'none';
  const width = box.w + padding * 2;
  const height = box.h + padding * 2 + (showFooter ? FOOTER_H : 0);
  const originX = box.x - padding;
  const originY = box.y - padding;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      viewBox={`${originX} ${originY} ${width} ${height}`}
      width={Math.round(width * scale)}
      height={Math.round(height * scale)}
      fontFamily="-apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
      role={description ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {description && <desc>{description}</desc>}
      <Defs theme={theme} iconKeys={iconKeysIn(model)} customIcons={model.customIcons} />
      <rect x={originX} y={originY} width={width} height={height} fill={theme.sheet} />
      <DiagramScene model={model} theme={theme} />
      {showFooter && (
        <BrandFooter
          x={originX}
          y={originY + height - FOOTER_H}
          width={width}
          divider={theme.divider}
        />
      )}
    </svg>
  );
}

/** The AION Cloud signature: a rule, the isotype and the name, centred. */
function BrandFooter({
  x,
  y,
  width,
  divider,
}: {
  x: number;
  y: number;
  width: number;
  divider: string;
}) {
  const centre = x + width / 2;
  const logoY = y + 16;

  return (
    <g pointerEvents="none">
      <line x1={x + 40} y1={y} x2={x + width - 40} y2={y} stroke={divider} strokeWidth={1} />
      <image
        href={AION_LOGO}
        x={centre - 52}
        y={logoY}
        width={24}
        height={24}
        preserveAspectRatio="xMidYMid meet"
      />
      <text
        x={centre - 20}
        y={logoY + 17}
        fontSize={fontSize.xs}
        fontWeight={fontWeight.medium}
        fill={providerColors.aion}
      >
        AION Cloud
      </text>
    </g>
  );
}
