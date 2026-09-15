'use client';

/**
 * The AC Graph mark.
 *
 * The AION isotype: an A whose right stroke runs into a C. Traced from the
 * brand artwork into two paths rather than shipped as an image, so it stays
 * sharp at any size, inherits the brand tokens, and can animate — a mark that
 * only exists as a PNG is a mark that goes soft on every retina screen and
 * cannot follow a theme.
 *
 * The artwork is 1042×700, so `size` is the height and the width follows.
 */

interface LogoProps {
  /** Height in pixels; the width follows the artwork's ratio. */
  size?: number;
  /** Plays the draw-in once on mount. */
  animate?: boolean;
  className?: string;
  title?: string;
}

const RATIO = 1042 / 700;

const A_AND_C =
  'M366.0 1.0 L603.0 457.0 L631.0 498.0 L660.0 528.0 L698.0 556.0 L739.0 576.0 L788.0 589.0 L835.0 591.0 L876.0 583.0 L914.0 566.0 L951.0 539.0 L984.0 504.0 L1041.0 597.0 L1041.0 601.0 L1028.0 617.0 L989.0 650.0 L952.0 671.0 L906.0 688.0 L851.0 698.0 L793.0 699.0 L736.0 692.0 L682.0 679.0 L638.0 660.0 L607.0 640.0 L573.0 611.0 L549.0 585.0 L521.0 547.0 L506.0 522.0 L365.0 241.0 L128.0 694.0 L1.0 694.0Z';

const C_ARC =
  'M781.0 8.0 L848.0 9.0 L904.0 20.0 L936.0 31.0 L966.0 45.0 L992.0 61.0 L1015.0 79.0 L1036.0 100.0 L1041.0 106.0 L1041.0 110.0 L996.0 210.0 L994.0 211.0 L982.0 197.0 L947.0 167.0 L899.0 138.0 L867.0 126.0 L845.0 121.0 L803.0 120.0 L742.0 131.0 L711.0 142.0 L690.0 153.0 L667.0 170.0 L645.0 193.0 L630.0 214.0 L614.0 247.0 L612.0 247.0 L554.0 144.0 L552.0 139.0 L555.0 134.0 L571.0 114.0 L598.0 87.0 L623.0 67.0 L654.0 47.0 L684.0 32.0 L720.0 19.0Z';

const A_STRIPE = 'M426.0 362.0 L485.0 477.0 L485.0 481.0 L378.0 690.0 L250.0 691.0Z';

export function AcMark({ size = 32, animate = false, className, title }: LogoProps) {
  return (
    <svg
      width={Math.round(size * RATIO)}
      height={size}
      viewBox="0 0 1042 700"
      className={`ac-mark${animate ? ' is-animated' : ''}${className ? ` ${className}` : ''}`}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {/* The A, and the sweep of the C it runs into. */}
      <path className="ac-stroke" fill="var(--brand-from)" d={A_AND_C} />
      {/* The C's opening and the A's inner stroke, in the second brand colour. */}
      <path className="ac-accent" fill="var(--brand-to)" d={C_ARC} />
      <path className="ac-accent ac-accent-stripe" fill="var(--brand-to)" d={A_STRIPE} />
    </svg>
  );
}

/** Mark plus wordmark. */
export function AcGraphLogo({ size = 26, animate = false, className }: LogoProps) {
  return (
    <span className={`ac-logo${className ? ` ${className}` : ''}`}>
      {/* The name in two tones — the company's letters in ink, the product's
          word in the accent — as the brand writes it. The mark carries the
          accessible name; the wordmark is a picture of the same thing. */}
      <AcMark size={size} animate={animate} title="AC Graph" />
      <span className="ac-wordmark" aria-hidden="true">
        AC <span className="ac-wordmark-accent">Graph</span>
      </span>
    </span>
  );
}
