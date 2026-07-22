# Spec 341 — the photo-removal trace: visibility instead of an approval gate

**Status:** operator decision 2026-07-22. Asked whether pre-submit photo deletion
should need approval from someone senior; chose **"keep the permission as it is,
add transparency."** One code-only unit.

## Problem

Probed live before designing: **pre-submit deletion is already open, with no
approval and no uploader check.** `photo_removal_allowed`'s editable-status arm
(`not_started` / `in_progress` / `on_hold` / `rework`) tests only the work
package, so any project member holding `site_admin` / `project_manager` /
`project_director` / `super_admin` may remove any photo on it. Verified on a real
in_progress WP: a co-member SA returned `can_see_wp = true` and gate `true`
against another SA's photo; a non-member SA was stopped by `can_see_wp`, not by
the gate. The uploader-only rule (spec 291) applies **only** inside the ให้แก้ไข
window.

Nothing about that is recorded where anyone looks. `photo_logs` is append-only,
so the tombstone has always known who removed what and when — the app simply
never showed it. The photo just disappears.

## Decisions

| #   | Decision |
| --- | -------- |
| D1  | **No approval gate on pre-submit deletion.** A pre-submit photo is a draft nobody downstream has relied on, and deleting one before submit is indistinguishable from never having taken it — an approval cannot create evidence that does not exist. It would also tax the SA's single most frequent action (photographing WPs) and create a queue nobody will staff. |
| D2  | **Accountability comes from the record, not the gate.** Surface the tombstone: which number went, who removed it, when. |
| D3  | **NOT in `/settings/integrity`.** That console reports invariant VIOLATIONS (green/amber/red from `run_integrity_checks`). A deletion is normal activity; modelled as a check it would sit amber permanently and teach people to ignore the board. The trace belongs where the deletion happened. |
| D4  | **The trace spans every zone, not just the selected one.** Found by live probe: the first cut attached it to the current phase strip, and the one real WP with removals had all six in ระหว่างทำ while the page opened on another tile — so it rendered nothing. Accountability you have to go hunting for is not accountability. Each line names its zone. |
| D5  | **Reuse spec 340's number.** The trace reports the removed photo's retired `#N`, so a screenshot taken before the deletion still matches the record afterwards. |
| D6  | **Staff-only by construction.** `WP_DETAIL_ROLES` contains no `client`, so naming the remover on this page exposes nothing to a customer. |
| D7  | **An unnamed remover still shows** (`ไม่ทราบชื่อ`). A removal by someone the app can no longer name is exactly the row that must not vanish. |

## Unit U1 (code-only)

- `selectRemovedPhotosByPhase` in `src/lib/photos/current-photos.ts`, sharing
  `numberPhotos` with `selectCurrentPhotosByPhase` so a live photo and its own
  removal trace can never disagree about which number it had. The TARGET's phase
  files the entry, never the tombstone's copy.
- `getPhotoViewForWorkPackage` returns `{ current, removed }` from the one
  existing `photo_logs` fetch — the tombstones were already being read and
  thrown away, so the trace costs no extra query.
- The loader adds `removedByPhase` and includes removers in the single
  display-names read (a remover need not be among the current uploaders).
- `PhotoCaptureZone` renders a collapsed `ลบไปแล้ว N รูป` below the strip,
  expanding to `<zone> #N · ลบโดย <name> · <time>`.

**Failure modes / recovery**

| Mode | User sees | Recovery |
| ---- | --------- | -------- |
| Remover's name unresolvable | `ลบโดย ไม่ทราบชื่อ` with number + time intact | the tombstone id is still queryable |
| Removals in a zone the page is not showing | still listed, zone-prefixed (D4) | — |
| A WP that never lost a photo | nothing renders at all | — |

## Verification

- Unit: the selector (number retired, target-phase filing, orphan tombstone
  ignored) + the rendered trace, including the non-selected-zone case; the loader
  test pins that a remover's id reaches the names read. 3 mutation-checks.
- Real-flow: a live WP with six removals renders `ลบไปแล้ว 6 รูป` and six lines
  naming the remover and the time.
