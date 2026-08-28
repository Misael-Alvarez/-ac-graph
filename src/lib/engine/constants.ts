/** Layout constants shared by the auto-layout and the SVG renderer. */
/**
 * Below this zoom a group stops listing its services and states how many it
 * has. Chosen where the item subtitles stop being legible: drawing text nobody
 * can read is the "two thousand nodes saying everything at once" failure, and
 * paying to render it is the reason a large diagram feels slow.
 */
export const COLLAPSE_ZOOM = 0.5;

export const G = {
  GROUP_TITLE_DX: 18,
  GROUP_TITLE_DY: 38,
  CONTAINER_DX: 18,
  CONTAINER_DY: 64,
  CONTAINER_MARGIN_R: 36,
  ITEM_DX: 16,
  ITEM_DY: 16,
  ITEM_MARGIN_R: 32,
  ITEM_H: 92,
  PITCH_TIGHT: 106,
  PITCH_WIDE: 142,
  GROUP_BOTTOM_EXTRA: 84,
  ICON_DX: 16,
  ICON_DY: 27.3,
  ICON_SIZE: 37.4,
  TITLE_DX: 69.4,
  TITLE_DY: 30,
  SUB_DY: 58,
  NOTE_DY: 78,
  BOUND_ICON_DX: 24,
  BOUND_ICON_DY: 20,
  BOUND_ICON_SIZE: 44.2,
  BOUND_TITLE_DX: 80,
  BOUND_TITLE_DY: 51,
  BOUND_NOTE_DX: 34,
  SNAP_SIZE: 18,
} as const;

/** Distance in canvas units at which a dragged edge snaps to a neighbour's edge. */
export const ALIGN_SNAP_DIST = 6;

/** Obstacles are inflated by this much before connector routing tests them. */
export const ROUTE_CLEARANCE = 12;
