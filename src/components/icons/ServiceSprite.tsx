'use client';

import { useLayoutEffect } from 'react';
import { ALL_SYMBOLS } from './svgIconDefs';

/**
 * The whole icon sprite, in the document exactly once.
 *
 * Three surfaces offer every service — the command palette, the service browser
 * and the icon picker — and each used to inline its own copy of ~1 MB of
 * `<symbol>` markup. Open the palette over the browser and the document held
 * two copies of every id; open the picker as well and it held three. Duplicate
 * ids are invalid, and the second copy was never the one being drawn from:
 * `<use href="#i-…">` resolves against the document, not against the nearest
 * `<svg>`, which is what made the per-panel copies unnecessary in the first
 * place.
 *
 * Mounted outside React's tree, because the panels that need it come and go
 * independently and none of them owns it. The last one to close takes it away.
 */

let holder: HTMLDivElement | null = null;
let users = 0;

export function ServiceSprite() {
  // Layout effect, not an effect: the panels that mount this render hundreds of
  // icons on the same frame, and an effect would leave them all blank for one.
  useLayoutEffect(() => {
    users += 1;
    if (!holder) {
      holder = document.createElement('div');
      holder.setAttribute('aria-hidden', 'true');
      holder.dataset.serviceSprite = '';
      holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      holder.innerHTML = `<svg width="0" height="0"><defs>${ALL_SYMBOLS}</defs></svg>`;
      document.body.append(holder);
    }
    return () => {
      users -= 1;
      if (users > 0) return;
      holder?.remove();
      holder = null;
    };
  }, []);

  return null;
}
