# Spec 291 — Self-service: own-photo delete + profile employee ID card

Status: 🎨 DESIGN (approved by operator 2026-07-10). Two independent units.

## Problem

Two things a user cannot do about **their own** data:

1. **Delete their own uploaded photos** in a bounded way. Progress photos are
   append-only (ADR 0004/0015); a logical delete is a tombstone. Today the
   delete affordance exists on **one** surface (the SA capture-sheet) and has
   **no approval gate** — a user could tombstone a photo even after the work
   package was submitted for review, altering the evidence a reviewer is
   looking at.
2. **See their own stored information.** `/profile` shows only avatar +
   `full_name` (edit display-name). A person cannot see their own role,
   department, registration status, or PDPA-consent status — that data is
   visible only to admins (`/settings/roles/[id]`) or inside a role-specific
   portal (`/technician`, `/portal`).

Constraint: photos are per-WP **approval evidence**. Deleting must be bounded so
a submitted evidence set cannot be altered. Profile must not expose
PDPA-sensitive data.

## Decision & scope

Operator decisions (2026-07-10):

- **Delete = own uploads only** (already RLS-enforced via `uploaded_by =
auth.uid()`), **locked once submitted for approval**, affordance on the SA
  capture-sheet **and** the WP-detail gallery (option **B**), enforced at
  **RLS + server action + UI** (option **B1** — the rule lives at the data
  layer, not just the UI).
- **Profile = a compact digital employee ID card** — identity + **statuses
  only**, never PDPA values. The card is for **employees**; external roles
  (`client`, `contractor`) get the plain enriched profile without an employee
  card.
- **Deferred to a later upgrade (NOT v1):** photo-forward card layout, and QR
  identity-verify (rotating short-lived token + login-gated verify page). The
  v1 card renders no live QR.

Two units, shippable independently. Unit 1 carries a migration (RLS) and is a
danger-path PR → **held for operator merge**. Unit 2 is code-only → auto-merges.

## Design

### Unit 1 — Photo self-delete, gated at submit (RLS migration + action + UI — **held**)

**Live baseline** (verified 2026-07-10): `removePhoto`
(`src/app/projects/[projectId]/work-packages/[workPackageId]/actions.ts`)
tombstones via `buildTombstoneRow` (ADR 0015). The `photo_logs` INSERT RLS
policy pins `uploaded_by = ( select auth.uid() )` + role gate (site_admin,
project_manager, super_admin, project_director) + `can_see_wp`. The delete
affordance is wired only on `capture-sheet.tsx` via `ZoomablePhoto`'s
`canDelete`/`onDeletePhoto`. **No status gate anywhere.**

Deletable WP statuses = `not_started · in_progress · on_hold · rework`.
Locked (delete refused) = `pending_approval · complete`. (Rework = a reopened,
not-yet-resubmitted WP → still deletable.)

> **Amendment 2026-07-22 (feedback `f2096ee4`, migrations `075830`+`075831`).**
> The rule above trapped the case the reviewer themselves asks for. A
> `needs_revision` decision ("ให้แก้ไข") tells the SA to re-shoot and **leaves the
> WP at `pending_approval`**, so the wrong photo could be added-around but never
> removed; the only cure that removed it was `rejected` → rework (spec 337 F3),
> which charges a rework round to the WORK when only the PHOTO was wrong.
>
> The authority is now `photo_removal_allowed(p_wp, p_target)` (the `photo_logs`
> INSERT `WITH CHECK` calls it in place of `photo_wp_deletable`, which keeps its
> original status-only meaning as one arm). A tombstone is admitted when the WP
> is in an editable status **or** the ให้แก้ไข window is genuinely open:
>
> - `status = pending_approval`, and
> - the latest decision (`decided_at desc, id desc`) is `needs_revision`, and
> - that decision has **not** been answered by a `wp_evidence_resubmitted` audit
>   row (`resubmit_work_package_evidence` writes no `approvals` row, so a rule
>   keyed on the decision alone would never close), and
> - the caller **uploaded the photo being removed** — the reviewer asks, the
>   uploader fixes. `project_manager`/`project_director` reach the same WP-detail
>   delete affordance (only procurement is a read-only WP viewer), so without
>   this conjunct the amendment would hand the approver a way to alter the
>   evidence they are judging.
>
> TS mirrors: `isPhotoWpDeletable(status)` (unchanged) + `isRevisionWindowOpen()`
> in `src/lib/photos/deletable.ts`. The page's `canDelete` is zone-level and
> therefore carries only the WP-level arms; the per-photo uploader check lives in
> `removePhoto` (`PHOTO_DELETE_NOT_OWNER_ERROR`) and RLS. **Open question:** the
> lightbox has uploader _names_ but not ids, so inside the window a non-uploader
> is still offered a delete that then refuses — threading `uploaded_by` ids into
> `photo-lightbox` would hide it. pgTAP `291-revision-photo-unfreeze`.

Changes:

1. **RLS (migration, the authority).** Add a `SECURITY DEFINER` helper
   `photo_wp_deletable(p_wp uuid) returns boolean` = the WP's `status NOT IN
('pending_approval','complete')` (mirrors the `can_see_wp` helper idiom;
   explicit `revoke ... from anon`). Extend the tombstone-insert `WITH CHECK`
   so a **tombstone** row (`superseded_by IS NOT NULL`) additionally requires
   `photo_wp_deletable(work_package_id)`. Normal photo inserts
   (`superseded_by IS NULL`) are unchanged — this gates the delete, not the
   upload. Predicate shape:
   `... existing conditions ... AND (superseded_by IS NULL OR photo_wp_deletable(work_package_id))`.
   **Superseded by the amendment above** — the conjunct now calls
   `photo_removal_allowed(work_package_id, superseded_by)` (mig `075831`), which
   also requires the target photo to live on that same work package (`075832`).
2. **Server (`removePhoto`).** After loading the target photo, read its WP
   `status`; if `∈ {pending_approval, complete}` return a friendly Thai error
   (e.g. `"งานนี้ส่งตรวจแล้ว ลบรูปไม่ได้"`) before attempting the insert. UX
   layer; RLS is the backstop.
3. **UI.**
   - `capture-sheet.tsx`: hide the delete affordance when the WP status is
     locked.
   - WP-detail gallery (`phase-gallery.tsx`): wire `canDelete`/`onDeletePhoto`
     per photo, shown **only** where `photo.uploaded_by === currentUserId`
     **and** the WP status is deletable. Thread `currentUserId`, WP `status`,
     and an `onDeletePhoto` handler (reusing the capture engine's
     supersede/`removePhoto` path) into the gallery from the WP-detail page.

TDD: pgTAP — tombstone insert refused when the WP is `pending_approval`/
`complete`, allowed when `in_progress`/`rework`; a normal photo insert is
unaffected. Vitest — `removePhoto` returns the status error; gallery renders a
delete only for own photos on a deletable WP and hides it once submitted.

### Unit 2 — Profile → digital employee ID card (code-only, auto-merge)

**Live baseline:** `/profile` (`src/app/profile/page.tsx`) reads the current
user's `role, full_name, line_avatar_url` (RLS self-read) and offers a
display-name edit.

Changes — enrich `/profile` into a card + status sections, **all RLS-scoped
self-reads** (no admin client):

- **Account (always):** `full_name`, role label (`USER_ROLE_LABEL`),
  department name (`users.department_id → departments.name`), avatar or
  initials.
- **Employee ID:** from the person's own record (`employee_id` on
  `staff_registrations` / `workers` / `crew_registrations`) when present.
- **Registration status:** `staff_registrations.status` or
  `crew_registrations.status` (`pending · approved · rejected`) when a row
  exists for the user.
- **PDPA consent status:** `staff_consents` / `contractor_consents` —
  `given (consented_at)` / `revoked (revoked_at)` when rows exist.

Card behaviour:

- **States:** registration `approved` (or a directly-assigned internal role
  with no registration, e.g. super_admin/PM) → **issued** card; `pending` →
  **provisional** card; `rejected` → a message, no card.
- **Employees only:** the employee card renders for **internal** roles. The
  external roles `client` and `contractor`, and pre-role `visitor`, get the
  plain enriched profile (name · role · statuses) with **no** employee card.
  "External" is a role set derived from `src/lib/auth/role-home.ts` (the role
  SSOT), never a hardcoded list — a new role added there is classified
  deliberately, not silently granted a card.
- **Never rendered on profile:** `national_id`, `bank_*`, `day_rate`/salary,
  `date_of_birth`, `phone`, `emergency_contact_*`. The card proves "your
  registration is approved / your consent is on file" without echoing the
  sensitive values.
- **Visual:** compact card, flat slate (`--color-brand` #0f172a) header +
  amber (`--color-attn` #f59e0b) accent, avatar/initials, name (Thai, + En
  when available), role, department, employee-ID pill, status pills — all via
  the Field-First tokens (`globals.css`). No live QR in v1.

TDD: component tests per state (issued / provisional / rejected / external
role) asserting the right sections render **and** that no PDPA field is ever in
the DOM; loader test for the RLS self-reads (sections appear only when the
underlying row exists).

## Non-goals (v1)

- QR identity-verify, rotating token, verify page — deferred upgrade.
- Photo-forward card layout — deferred upgrade.
- Attendance / on-site check-in via QR.
- Editing profile fields beyond the existing display-name edit.
- Rendering any PDPA-sensitive value.
- Deleting non-photo uploads (purchase-request attachments, catalog images,
  feedback attachments) — out of scope.

## Schema lane (Unit 1 sequencing)

Unit 1 has one migration (the `photo_wp_deletable` helper + the `photo_logs`
tombstone policy change) → claim the schema lane (next claimant `075570+` per
LANES). RLS + migration = danger-path → the PR is **held for operator merge**.
Unit 2 is code-only and independent → auto-merges; it can land before or after
Unit 1.
