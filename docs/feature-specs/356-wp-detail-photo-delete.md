# Spec 356 — Delete a progress photo from the WP-detail photo viewer

**Status:** in progress (single unit, code-only, no schema)
**Origin:** operator report 2026-07-24 — on an editable WP (e.g. `in_progress` /
กำลังดำเนินการ) the SA and the operator "cannot delete images."

## The actual problem

Deletion **is** permitted. `canDeleteWpPhotos({status, latestDecision,
revisionAnswered})` returns `true` on an editable WP, the `removePhoto` server
action admits any SA/PM/PD/super, and the RLS backstop
(`photo_removal_allowed`) agrees. What is missing is a **door**: the `ลบรูป`
button lives inside `photo-lightbox-overlay.tsx` and is only ever wired up
**inside the CaptureSheet** (`capture-sheet.tsx` → `LoadedTile` →
`onDeletePhoto={handleRemoveConfirmed}`). When a user taps a photo on the
WP-detail **page** it opens the same overlay through `ZoomablePhoto`, but the
page passes no `canDelete` / `onDeletePhoto`, so the overlay renders view-only.
Users reasonably conclude they can't delete — the affordance is two levels down
inside the shutter sheet, not on the photo they're looking at.

This is a wiring gap, not a permissions gap. **No new delete logic** — thread
the pieces that already exist into the main viewer.

## What already exists (verified at HEAD `85fb4ac3` / 0.208.0)

- `ZoomablePhoto` (`src/components/features/photos/photo-lightbox.tsx:67`)
  already accepts optional `canDelete` / `onDeletePhoto` / `deletingPhotoId` and
  forwards them to `PhotoLightboxOverlay`.
- `PhotoLightboxOverlay` (`photo-lightbox-overlay.tsx`) renders the `ลบรูป`
  button + its own confirm dialog when
  `canDeleteCurrent = canDelete === true && currentPhotoId !== null &&
onDeletePhoto !== undefined && !composing`. On confirm it calls
  `onDeletePhoto(currentPhotoId)` then closes itself.
- `removePhoto` (`.../actions.ts:558`) is the tombstone action. It enforces the
  full gate: WP status (291 freeze) → revision-window arm (291 amendment) →
  uploader-or-super inside the window (340) → anti-join double-remove guard →
  append tombstone → `revalidatePath(workPackageHref(...))`.
- `PhotoCaptureZone` (`phase-uploader.tsx`) already **receives** `canDelete` from
  the page (`page.tsx:604`, `canDeleteWpPhotos({...})`) and passes it to the
  CaptureSheet — but its own on-page `ZoomablePhoto` strips are view-only.
- Spec 340 numbering (`#N`) + spec 341 removal trace both render in
  `PhotoCaptureZone` and are derived server-side over the append-only history, so
  a `router.refresh()` after a delete updates them for free.

## U1 — thread `canDelete` + `onDeletePhoto` into the WP-page strips

**Scope:** `src/app/projects/[projectId]/work-packages/[workPackageId]/phase-uploader.tsx`

- its test. No other file changes (the page already computes and passes
  `canDelete`; the overlay + action already exist).

1. Add a minimal removal handler to `PhotoCaptureZone` (a `"use client"`
   component): call the existing `removePhoto({ photoLogId })`, guard concurrent
   removals with a `removingId` state, on failure surface the action's Thai error
   in an on-zone alert, on success `startTransition(() => router.refresh())`.
   This mirrors `usePhaseCapture.handleRemoveConfirmed` exactly — same action,
   same refresh — because the overlay closes itself on confirm, so the error must
   land on the page, not in the dismissed overlay.
2. Thread `canDelete` + `onDeletePhoto={handleRemove}` + `deletingPhotoId` into:
   - the **current-phase recent strip** `ZoomablePhoto` (line ~378), and
   - the **read-only หลังแก้ไข history strip** `ZoomablePhoto` (line ~332).
     Both render the SA's own progress photos. `canDelete` governs whether the
     overlay shows `ลบรูป` at all, so no strip over-offers.
3. **Leave view-only** (out of scope — these are the reviewer's evidence the SA
   _fixes_, not deletes): the PM defect photos (`page.tsx:1010`) and the
   defect-pair reference/answer thumbnails in `PhotoCaptureZone` (lines ~199 /
   ~214). Read-only WP viewers (procurement) get `PhaseGallery`, never
   `PhotoCaptureZone`, so they never see the delete offer.

### Decision surfaced (not silent): zone-level `canDelete` in the revision window

`canDelete` is a **WP-level** flag (291). Inside an open ให้แก้ไข window a
**non-uploader** PM/PD would be OFFERED `ลบรูป`, tap it, and be REFUSED by the
action with `PHOTO_DELETE_NOT_OWNER_ERROR`. This is the exact behaviour of the
CaptureSheet today (same zone-level flag, same refuse). **We keep the
refuse-message and do not thread per-photo `uploaded_by` to hide the button**,
because:

- It matches the sibling surface (the sheet) — one photo, one behaviour.
- The window is a narrow state; the common editable case (`in_progress` /
  `rework`) has no uploader check at all, so there is **no** offer-then-refuse
  there — which is exactly the operator's reported case.
- Hiding requires the loader to fetch per-photo `uploaded_by` + the caller's
  `auth.uid()` and compute a per-photo gate — new plumbing the spec-291 note
  itself deferred as a known rough edge. Adding it here is scope creep.

If offer-then-refuse in the window ever proves confusing in the field, threading
`uploaded_by` is a clean follow-up (own unit).

### Negative cases, error messages, recovery

All Thai strings already exist in `deletable.ts` / `actions.ts` (single-sourced);
this unit adds no new strings. The overlay owns the confirm; the action owns the
refusals.

| #   | Failure mode                                                           | Thai string (source)                                                         | Recovery                                                                                                   |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | WP submitted/complete → `canDelete` false                              | (button not rendered)                                                        | The WP-page delete simply isn't offered; the WP must be recalled (spec 352) or bounced (`ให้แก้ไข`) first. |
| 2   | Delete on a WP that flipped to a locked status since page load (stale) | `งานนี้ส่งตรวจแล้ว ลบรูปไม่ได้` (`PHOTO_DELETE_LOCKED_ERROR`)                | On-zone alert; `router.refresh()` reloads the true state.                                                  |
| 3   | Non-uploader inside the ให้แก้ไข window                                | `ระหว่างรอแก้ไข ลบได้เฉพาะรูปที่คุณถ่ายเอง` (`PHOTO_DELETE_NOT_OWNER_ERROR`) | On-zone alert; the uploader (or a super_admin on their behalf, 340) does the delete.                       |
| 4   | Photo already tombstoned (double-remove race)                          | `รูปนี้ถูกลบไปแล้ว` (`actions.ts`)                                           | On-zone alert; `router.refresh()` drops the already-gone tile.                                             |
| 5   | Tombstone insert fails (transient)                                     | `ลบรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง` (`actions.ts`)                         | On-zone alert; user retries.                                                                               |
| 6   | Concurrent removal in flight                                           | (second click ignored — `removingId` guard)                                  | Wait for the first to finish.                                                                              |

One more mode, added after review: `removePhoto` is a server action, so a
transport failure **rejects** the invocation rather than returning `{ ok:false }`.
The handler wraps the `await` in `try/catch/finally` — the throw surfaces the same
`ลบรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง` fallback (row 5's message) and `finally`
resets the `removingId` guard, so a failed delete can never silently wedge every
subsequent one on this persistently-mounted page (the CaptureSheet gets away
without this because it unmounts and resets its engine on close). The error banner
also scrolls into view, because the overlay has closed and the user is looking at
the strip — a delete that fails must never read as a silent nothing.

On success: the tombstone lands, `revalidatePath` + the client `router.refresh()`
re-render the zone — the photo disappears, its `#N` is retired (340), and the
`ลบไปแล้ว N รูป` trace (341) gains a line. No optimistic UI; the server is the
source of truth.

### RED-first tests (`tests/unit/phase-uploader-delete.test.tsx`)

Mirrors `capture-sheet.test.tsx` (mock `removePhoto` from `./actions`, `useRouter`
from `next/navigation`, the markup actions, and `use-phase-capture`):

1. current-phase strip: tap a loaded thumbnail → `ลบรูป` appears when
   `canDelete=true`.
2. `canDelete=false` → overlay opens but `ลบรูป` is absent.
3. Full flow: thumbnail → `ลบรูป` → confirm → `removePhoto` called with the
   photo id, `router.refresh` called on success.
4. afterFixHistory strip: with after_fix history photos + `canDelete=true`, tap →
   `ลบรูป` appears (closes the recall-case gap where after_fix photos are shown
   read-only but the WP is deletable).
5. `removePhoto` → `{ ok:false, error }`: after confirm, the error banner renders
   on the zone.
6. Scope pin: the defect-pair reference thumbnail does **not** offer `ลบรูป`.

## Verification

- `pnpm lint && pnpm typecheck && pnpm test` green.
- Browser real-flow (dev-preview): open an editable WP's photo tab, tap a
  progress photo, `ลบรูป` → confirm → the photo disappears and the removal trace
  updates. Zero console errors.
