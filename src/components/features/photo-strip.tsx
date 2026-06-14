// Spec 49 — photo filmstrip. One horizontal scroll row replaces the
// vertically-growing photo grids: page height stays constant per phase,
// "more photos" costs sideways swipe, not page length (operator: long
// image columns scroll "against intuition"). Server-safe presentational
// — layout only; ZoomablePhoto/overlays/lifecycles live at call sites.
//
// PHOTO_STRIP_TILE is exported so every surface's tiles share one
// geometry — the PAGE_MAX_W lockstep idea at component scale. Tiles are
// fixed squares that refuse to shrink (shrink-0) so the row scrolls
// instead of wrapping.

import type { ReactNode } from "react";

export const PHOTO_STRIP_TILE =
  "relative h-28 w-28 shrink-0 snap-start overflow-hidden rounded-lg border border-edge bg-sunk";

export function PhotoStrip({ children }: { children: ReactNode }) {
  return <ul className="flex snap-x gap-2 overflow-x-auto pb-1">{children}</ul>;
}
