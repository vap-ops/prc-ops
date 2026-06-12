# Spec 49 — Photo filmstrip: horizontal strips replace growing grids

**Status:** locked — 2026-06-12. Operator (WP-detail feedback item 3):
"images get too long and scrolling down further and further is against
intuition." The per-phase photo grids (`grid grid-cols-2 sm:grid-cols-3`,
aspect-square tiles) grow the page vertically without bound — at field
photo volumes (tens per phase) the WP screen becomes one long photo
scroll and the zones below (labor, requests, facts) disappear.

## Scope

### A. Shared `PhotoStrip` primitive

New server-safe presentational module
`src/components/features/photo-strip.tsx`:

- `PhotoStrip` — the `<ul>`: one horizontal row, `flex gap-2
overflow-x-auto snap-x pb-1` (swipe sideways on phones, wheel/drag on
  desktop; bottom padding keeps the scrollbar off the tiles).
- `PHOTO_STRIP_TILE` — exported tile class constant: fixed square
  `h-28 w-28 shrink-0 snap-start overflow-hidden rounded-lg border
border-zinc-200 bg-zinc-100 relative` — both surfaces stay in lockstep
  by importing it (the PAGE_MAX_W enforcement idea at component scale).

Page height is now constant per phase regardless of photo count;
"more photos" costs horizontal swipe, not page length.

### B. Surfaces

1. **SA WP page** (`phase-uploader.tsx`): the gallery `<ul>` becomes
   `PhotoStrip`; `Thumbnail` and `PendingTile` `<li>`s take
   `PHOTO_STRIP_TILE`. Remove-button overlay, pending lifecycle,
   ConfirmDialog, queue bracketing — all untouched. Phase heading gains
   a count: `{label} ({photos.length})` so the strip's hidden tail is
   announced.
2. **PM review page** (`PhaseGallery` in
   `pm/work-packages/[workPackageId]/page.tsx`): same swap; phase `<h3>`
   gains the same count.

ZoomablePhoto stays the tap-to-enlarge mechanism — the strip changes
layout only. Empty states unchanged. The /requests detail page's small
`h-20` attachment thumbs already wrap in bounded rows — out of scope.

### Out of scope

Pagination/virtualization (volumes are tens, not thousands), a grid
toggle, lightbox swipe-between-photos (recorded seam), any data change.

## Tests

- **Failing first:** `tests/unit/photo-strip.test.tsx` — PhotoStrip
  renders a `<ul>` carrying the horizontal-scroll classes
  (`flex`, `overflow-x-auto`, `snap-x`) with children inside;
  `PHOTO_STRIP_TILE` pins the fixed-square tile geometry
  (`h-28`, `w-28`, `shrink-0`, `snap-start`).

## Verification checklist

- [ ] New test RED before the module exists, GREEN after.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass; `pnpm build`.
- [ ] Both surfaces use PhotoStrip + PHOTO_STRIP_TILE (no leftover
      `grid grid-cols-2 gap-3 sm:grid-cols-3` photo grids).
- [ ] Upload lifecycle behaviors untouched (pending tiles render inside
      the strip; remove overlay still clickable at 44px).
- [ ] No DB diff.
