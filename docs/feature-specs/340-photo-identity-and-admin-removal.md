# Spec 340 — super_admin removes a wrong photo on the uploader's behalf, and every photo gets a number

**Status:** operator directives 2026-07-22, straight out of the spec 291 rollout:
(1) "Enable super Admin to delete it on their behalf." (2) "We need to have a way
to identify the images (id no.)". Two units — U1 schema, U2 code-only.

## Problem

**U1.** Spec 291's window arm ends with `uploaded_by = auth.uid()` — inside a
ให้แก้ไข window only the person who took the photo may remove it, so the approver
cannot quietly alter the evidence they are judging. Correct, but it leaves no one
able to help: an SA who cannot find the button, has left the site, or has lost the
phone strands a wrong photo in a set the reviewer is waiting on. The operator is
the natural fallback and today has no path — `super_admin` is a permitted
`photo_logs` INSERT role but is refused by that conjunct like everybody else.

Note the restriction is narrower than it looks: when the WP is in an editable
status (`not_started` / `in_progress` / `on_hold` / `rework`), `photo_wp_deletable`
already admits every permitted role, `super_admin` included. The gap is exactly
the ให้แก้ไข window — and the freeze (`pending_approval` without an outstanding
needs_revision, and `complete`), which is a separate question answered below.

**U2.** There is no way to name one photo. During the 291 rollout the operator
circled two thumbnails in a screenshot and the session could identify only one of
them from the database — three photos shared the same displayed minute. Support,
hand-off instructions, and "delete this one for me" all need a stable label. The
UUID is unusable in the field, and the display order is not even deterministic
today: `getCurrentPhotosForWorkPackage` selects with no `order by`, so tile
positions can differ between renders.

## Decisions

| #   | Decision |
| --- | -------- |
| D1  | **super_admin bypasses the uploader check, NOT the freeze** (operator call, 2026-07-22). Inside a ให้แก้ไข window `super_admin` may remove any photo on the WP. On a frozen WP (submitted-and-not-bounced, or complete) nobody deletes — including super_admin. The honest path stays: ผอ./PM press ให้แก้ไข, which puts a reviewer decision on record *before* the evidence changes. This keeps the audit story intact instead of adding a silent back door. |
| D2  | **No new role set, no new RPC.** The change is one conjunct inside `photo_removal_allowed` (`or (select public.current_user_role()) = 'super_admin'`), so RLS stays the single authority and the server action keeps mirroring it for the Thai message. |
| D3  | **The number is derived, not stored.** A per-WP-per-phase ordinal over rows with `storage_path is not null`, ordered `created_at, id`. `photo_logs` is append-only, so a removed photo's row never leaves the table: its number is retired, and no surviving photo ever renumbers. That is the property a stored column would have cost a migration and a backfill to buy. |
| D4  | **Number per phase, not per WP.** The user reads it inside one zone's grid ("ระหว่างทำ #4"); a WP-wide sequence would make the visible numbers in a zone look arbitrary (#3, #9, #14). |
| D5  | **Order the grid by that ordinal.** The current read has no `order by` at all, so the grid is nondeterministic — a number that appears in a random position is worse than no number. Sorting by the ordinal is what makes the label usable, and it fixes the pre-existing nondeterminism. |
| D6  | **The number renders on the tile and in the lightbox.** The tile is what gets screenshotted; the lightbox is where the delete happens, so the person confirming a removal sees the same label the requester quoted. |

## Unit U1 — super_admin delete-on-behalf (schema, migration `075833`)

- Replace `photo_removal_allowed(uuid, uuid)`: the window arm's ownership test
  becomes `(target.uploaded_by = auth.uid() or current_user_role() = 'super_admin')`.
  Everything else — same-WP correlation, editable-status arm, the answered-window
  close — is unchanged.
- `src/lib/photos/deletable.ts`: `isRevisionWindowOwner({ isUploader, role })` so
  the server action's friendly refusal matches RLS instead of drifting from it.
- `removePhoto`: the `PHOTO_DELETE_NOT_OWNER_ERROR` branch skips `super_admin`.

**Failure modes / recovery**

| Mode | User sees | Recovery |
| ---- | --------- | -------- |
| super_admin tries on a frozen WP | `งานนี้ส่งตรวจแล้ว ลบรูปไม่ได้` (unchanged) | ผอ./PM press ให้แก้ไข first — by design (D1) |
| non-uploader, non-super_admin, inside the window | `ระหว่างรอแก้ไข ลบได้เฉพาะรูปที่คุณถ่ายเอง` (unchanged) | ask the uploader, or the operator |
| RLS admits but the action refuses (drift) | a delete that fails after confirming | pgTAP + the shared predicate keep the two in step |

## Unit U2 — a stable number on every photo (code-only)

- `selectCurrentPhotosByPhase` returns each photo with a `seq`, assigned over the
  non-tombstone rows of its phase (`created_at`, then `id`), and returns each
  phase sorted by `seq`.
- The tile grid and the lightbox render `#<seq>`.

## Verification

- U1: pgTAP RED-first — super_admin admitted inside the window, still refused on a
  frozen WP, non-uploader non-super still refused; vitest for the predicate.
- U2: unit tests for stability (delete a middle photo → survivors keep their
  numbers) and for deterministic order.
- Real-flow: the live gate probed for a super_admin and a non-uploader on the same
  WP; the grid read back with its numbers.
