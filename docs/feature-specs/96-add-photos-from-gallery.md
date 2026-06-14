# Spec 96 — Add work photos from the gallery, not just the camera

## Problem

Operator (2026-06-15): _"Adding images can add from gallery as well."_

The WP photo **CaptureSheet** shutter is a `<input type="file" capture="environment">`
— on mobile `capture` forces the rear camera and **removes the gallery/library
option** from the native picker. So a photo already taken (or received from
someone else) can't be attached to a work package.

The other image inputs already allow the gallery — `delivery-photo-uploader`,
`invoice-uploader`, and `purchase-request-attachment-stager` have **no** `capture`
attribute, so iOS already offers Photo Library / Take Photo / Choose File there.
Only the WP capture shutter is camera-locked.

## Decision

Keep the Field-First fast path — the 104px amber camera shutter stays
`capture="environment"` (one tap → rear camera, the design's whole point). **Add**
a secondary **"เลือกจากคลังภาพ"** (choose from gallery) control beneath it: a second
file input with the **same** `accept`/`multiple` but **no `capture`**, so it opens
the photo library. Both feed the **same** `usePhaseCapture` `handleFiles` engine —
downscale, offline queue, idempotent upload+insert are all unchanged.

"as well" = additive; the camera stays primary, the gallery is the secondary
affordance.

## Scope (exactly this)

1. `capture-sheet.tsx` — under the shutter, add a `<label>`-wrapped secondary
   button "เลือกจากคลังภาพ" (lucide `Image` icon, `BUTTON_SECONDARY_MUTED` +
   `focus-within` ring) containing
   `<input type="file" accept={PHOTO_ACCEPT_MIME} multiple>` (NO `capture`),
   `onChange` → `handleFiles`, then clear the input's own value (re-pick the same
   file). Header comment updated ("gallery detour" note corrected).
2. `tests/unit/capture-sheet.test.tsx` — engine mocked; assert (a) the gallery
   control renders, (b) its file input has no `capture` attribute while the camera
   input keeps `capture="environment"`, (c) selecting files calls `handleFiles`.

## Out of scope / preserved

- The camera shutter, the upload engine (`usePhaseCapture`), offline queue,
  downscale, phase switcher — all unchanged.
- The three attachment uploaders — already gallery-capable, untouched.

## Verification checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; the new test passes.
- [ ] `pnpm build` green.
- [ ] Acceptance = operator iPhone: open the shutter sheet → camera shutter still
      snaps to rear cam; "เลือกจากคลังภาพ" opens the photo library; a picked image
      uploads through the same pipeline (and queues offline).
