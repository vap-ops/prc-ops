# Spec 50 — Lightbox swipe between photos

**Status:** locked — 2026-06-12. Operator (feedback item 4, first half):
"Clicking the picture enlarges it, this is okay, but users should be
able to slide between pictures left and right." Closes the spec-49
recorded seam. Today each ZoomablePhoto is an island — reviewing a
phase means close → tap next → close → tap next.

## Scope

`ZoomablePhoto` gains an optional photo group:

- New props `group?: ReadonlyArray<string>` (ordered full-size URLs of
  the surrounding strip) and `groupIndex?: number` (this photo's
  position). Absent → exact current single-photo behavior.
- Open dialog tracks a current index (initialized to `groupIndex`);
  the displayed image is `group[current]`.
- Navigation, non-wrapping (ends are ends — wrap-around disorients):
  - prev/next overlay buttons (aria-labels `รูปก่อนหน้า` / `รูปถัดไป`,
    44px targets, dark-scrim style matching ปิด), hidden when the group
    has one photo; disabled at the ends;
  - `ArrowLeft` / `ArrowRight` keys;
  - horizontal swipe ≥ 48px on the dialog (pointerdown→pointerup delta);
    vertical drags ignored.
- Position counter `current+1/total` (e.g. `3/12`) in the top-left,
  same scrim plate, hidden for singletons.
- Escape/backdrop/ปิด close behavior byte-unchanged.

### Surfaces threading the group

1. SA phase-uploader: per-phase group = that phase's loaded (non-null
   URL) photos in strip order.
2. PM PhaseGallery: same per-phase group.
3. /requests/[requestId]: reference images = one group;
   delivery-confirmation photos = a separate group.

Groups never span sections — swiping stays inside the strip the user
tapped. Pending tiles and missing-URL tiles are not group members.

### Out of scope

Wrap-around, pinch-zoom, preloading, the drawing/commenting half of the
operator's feedback (spec 51).

## Tests

- **Failing first**, in `photo-lightbox.test.tsx`: opening a grouped
  photo shows ITS url and counter; next/prev buttons navigate and
  disable at the ends; ArrowRight/ArrowLeft navigate; singleton (no
  group) renders no nav buttons and no counter — existing five tests
  must stay green unchanged (the no-group contract).

## Verification checklist

- [ ] New tests RED first, GREEN after; the five existing lightbox
      tests pass unmodified.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` + `pnpm build` pass.
- [ ] All three surfaces pass groups; no surface mixes sections into
      one group.
- [ ] No DB diff.
