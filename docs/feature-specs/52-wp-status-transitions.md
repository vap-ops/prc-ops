# Spec 52 — WP status transitions: during → in_progress, manual on-hold toggle

**Status:** complete (2026-06-13)
**Date:** 2026-06-13
**Origin:** operator request 2026-06-12: "in_progress when during images are
uploaded; as for on_hold, allow PM and up to toggle on/off."

## Problem

`work_packages.status` has five enum values but only two transitions are
wired (spec 03: first After photo → `pending_approval`; PM approval →
`complete`). `not_started`, `in_progress`, and `on_hold` are dead values —
nothing in the app ever sets them, so every WP reads ยังไม่เริ่ม until the
day it flips to รออนุมัติ. Status pills lie about reality.

## Scope

Two changes. Nothing else.

### A. First During photo flips `not_started` → `in_progress`

Mirror of the spec-03 After-photo transition, same option-(a) shape:

- New predicate `shouldTransitionToInProgress(phase, currentStatus)` in
  `src/lib/photos/transitions.ts`: true iff `phase === 'during'` AND
  `currentStatus === 'not_started'`.
- **From `not_started` ONLY.** A During photo must NOT release `on_hold` —
  hold is a deliberate PM flag (part B); silently un-holding on an SA
  upload would undo a PM decision. (The existing After-photo rule DOES
  transition out of `on_hold` — unchanged, spec-03 decision.)
- Never regresses `in_progress` / `on_hold` / `pending_approval` /
  `complete` (predicate + SQL guard, two independent layers).
- In `addPhoto` (SA upload action): second guarded admin-client UPDATE,
  narrow to status only — `.update({ status: 'in_progress' })
.eq('id', wp.id).eq('status', 'not_started')`. Branches are mutually
  exclusive by phase; keep them as separate `if`s, not else-if chains
  keyed on anything but the predicates.
- Offline-queue replay (spec 35/37) needs no new work: replay re-enters
  `addPhoto`, the predicate re-reads current status, the SQL guard
  no-ops on a second pass.
- No notification: the outbox capture trigger fires on
  `pending_approval` only (ADR 0037) — verified, not touched.

### B. PM-and-up manual on-hold toggle

- New pure module `src/lib/work-packages/hold.ts`:
  - `HOLDABLE_FROM_STATUSES = ['not_started', 'in_progress']`
  - `canHold(status)` — true iff status ∈ HOLDABLE_FROM_STATUSES.
    `pending_approval` and `complete` are refused: a WP in the review
    queue is the PM's own queue contract; pausing it is done by
    deciding, not hiding.
  - `canRelease(status)` — true iff status === 'on_hold'.
  - `deriveReleaseStatus(hasCurrentDuringPhotos)` — `'in_progress'` if
    true else `'not_started'`. Rationale: after part A, `in_progress`
    means exactly "current During photos exist"; release re-derives
    instead of snapshotting (no schema change, no drift).
- New server action `setHoldStatus({ workPackageId, hold })` in
  `src/app/pm/work-packages/[workPackageId]/actions.ts`:
  - Role gate PM + super_admin (mirror `recordDecision`'s explicit check).
  - **User-session client, NOT admin** — work_packages UPDATE RLS already
    admits project_manager/super_admin; RLS is the load-bearing backstop.
    (Difference from the photo path, which escalates because site_admin
    has no UPDATE policy.)
  - Hold: UPDATE `status='on_hold'` WHERE id AND
    `status IN HOLDABLE_FROM_STATUSES`; 0 rows → friendly refusal.
  - Release: read current photos under RLS
    (`getCurrentPhotosForWorkPackage`), derive target, UPDATE WHERE id
    AND `status='on_hold'`; 0 rows → friendly refusal.
  - `revalidatePath` for `/pm`, the PM WP page, and the SA WP page
    (`/sa/projects/{project_id}/work-packages/{id}` — status pill there).
- UI: `HoldToggle` client component on the **PM WP detail page** header
  zone (`'use client'` justified: useTransition submit state). Renders:
  - status holdable → outline button พักงานชั่วคราว
  - status on_hold → solid button กลับมาดำเนินการ
  - otherwise → renders nothing.
  - Error surface: inline `role="alert"` like RecordDecisionForm.
- SA page gets NO toggle (operator said "PM and up"). site_admin keeps
  read-only status.

## Recorded decisions

1. No audit_log rows for any of these transitions — consistent with the
   existing photo-driven and approval-driven flips (the photo row /
   approvals row is the record; for hold, `updated_at` records when).
   Adding an audit action = enum migration = own spec if ever wanted.
2. No schema change. No migration. No pgTAP delta — RLS posture untouched.
3. Queue-ordering interaction: `/pm` orders pending WPs by `updated_at`;
   hold is impossible on `pending_approval`, so the toggle cannot reorder
   the queue.
4. Release derivation ignores Before photos — เตรียมงาน staging is not
   "work happening" (spec 10 label semantics).

## Tests (failing first)

- `tests/unit/photo-write-helpers.test.ts`: `shouldTransitionToInProgress`
  full matrix (3 phases × 5 statuses — exactly one true cell), explicit
  no-release-of-on_hold pin, no-regress pins.
- `tests/unit/wp-hold.test.ts`: `canHold` / `canRelease` over all 5
  statuses; `deriveReleaseStatus` both branches.

## Verification checklist

1. `pnpm lint && pnpm typecheck && pnpm test` green.
2. Manual (operator phone pass, batched with specs 34/35/37): upload a
   During photo on a ยังไม่เริ่ม WP → pill flips to กำลังดำเนินการ; PM holds
   it → พักชั่วคราว; PM releases → กำลังดำเนินการ (photos still there);
   hold a fresh WP, release → ยังไม่เริ่ม.
