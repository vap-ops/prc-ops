# Spec 317 — Universal profile self-service (settings ข้อมูลของฉัน, instant vs approved tiers)

**Status:** 🔨 BUILDING (design approved in chat 2026-07-14)
**Requested by:** operator, 2026-07-14 — "All types of users can edit their information in
settings, think of enterprise app. Some information can be edited right away, some needs
to be approved."
**Operator decisions (2026-07-14, in-chat):** DOB = **approved tier** (tightens the
current worker instant-edit) · office-staff approver = **STAFF_APPROVAL_ROLES**
(procurement_manager / project_director / super_admin — who admits you approves your
changes) · contractor bank change gains the **required passbook photo** (parity with
workers, spec 315 U2).

## Problem (verified live 2026-07-14)

Self-service grew audience-by-audience and left holes:

| Audience          | Instant today                                                 | Approved today             | Locked            |
| ----------------- | ------------------------------------------------------------- | -------------------------- | ----------------- |
| Worker/technician | phone·email·emergency·**DOB**                                 | bank+passbook (315)        | name, national ID |
| Contractor        | phone·email·contact person·address                            | bank (typed, **no photo**) | name, tax ID      |
| Office staff      | **nothing** (`update_own_staff_registration` is pending-only) | **nothing**                | everything        |
| Every login       | display name (/profile)                                       | —                          | —                 |

No settings entry for "my info" exists (`src/app/settings/sections.ts` has no all-roles
identity section); `/profile` is a read-only card + display-name form.

## Field matrix (the design)

- **Instant** (contactability, cosmetic — direct DEFINER write, column-scoped):
  phone · email · emergency contact · mailing address (contractor) · profile photo ·
  display name (exists) · ID-card renewal (spec 315 U1 — already role-neutral).
- **Approved** (identity/money — staged request → queue → decide):
  legal name · national ID (workers.tax_id) · **DOB** · bank + passbook photo.

## Architecture

- **`identity_change_requests` keyed on the LOGIN (`user_id`)** — name/ID/DOB belong to
  the human, not the audience record. Typed nullable columns `proposed_full_name`,
  `proposed_national_id`, `proposed_dob` (CHECK at least one), status enum reuse
  (`contractor_change_status`), one pending per user. Approve applies IN ONE TXN to every
  linked record: `users.full_name` + `workers.{name,tax_id,date_of_birth}` (where
  `user_id`) + `staff_registrations.{full_name,date_of_birth}` (approved own row) +
  `contractors.name` (where bound). National-ID applies only where a structured column
  exists (workers.tax_id); Thai-ID checksum validated at submit.
- **Bank stays on the proven parallel tables** (OPEN-6): the two shipped
  `*_bank_change_requests` keep their flows; office staff get a third mirror
  `staff_bank_change_requests` (passbook photo REQUIRED + storage-existence check +
  approve writes `staff_registration_bank` + supersede-chains the registration
  `book_bank` doc — the 315 U2 pattern verbatim).
- **Surface:** new `/settings/my-info` + a ข้อมูลของฉัน section in
  `settings/sections.ts` visible to EVERY role (first all-roles identity entry).
  Composes per-audience blocks: display name · instant contact form (staff/worker/
  contractor as applicable) · documents (ID-card renewal) · bank display + staged form ·
  pending-request banners. `/profile` stays the display card; portals link here.
- **Queue:** `/contacts/bank-changes` grows into การเปลี่ยนข้อมูลรอการอนุมัติ —
  4 kinds (identity · worker-bank · contractor-bank · staff-bank). Decide gates:
  worker/contractor kinds = `is_manager() OR procurement_manager` (unchanged);
  staff-bank + identity kinds = STAFF_APPROVAL_ROLES. Page `requireRole` = union.
- **Notifications:** submit/decide enqueue on the existing `notification_outbox`
  (deferred unit; not blocking).

## Units

- **U1 (schema + portal code):** `update_own_staff_contact(p_phone, p_emergency_name,
p_emergency_relation, p_emergency_phone)` — own registration, `pending OR approved`,
  contact fields only (name/DOB/role-hint stay out of reach) + **`update_own_worker_profile`
  re-signatured 6→5 args (p_dob DROPPED — DOB moves to the approved tier; old signature
  dropped, brief deploy window accepted per the 315-U2/F2b class)** + worker portal form
  loses its DOB field. pgTAP `317-staff-contact-selfedit`.
- **U2 (code-only):** `/settings/my-info` + sections entry + per-audience blocks
  (consumes U1's RPC; moves the 315 ID-card card + bank forms onto the shared surface,
  /technician keeps links). ⚠ overlaps lane 316roles' settings-sections/nav-guard pins —
  SERIALIZE behind 316roles.
- **U3 (schema):** `identity_change_requests` + `submit_identity_change` +
  `decide_identity_change` (STAFF_APPROVAL_ROLES) + queue merge + my-info form + pending
  banner. pgTAP: multi-record apply (worker+staff+users in one approve), checksum,
  one-pending, anon revokes, grants.
- **U4 (schema):** `staff_bank_change_requests` mirror (photo + existence + chain) +
  my-info staff bank form + queue kind. pgTAP mirror of 315 U2.
- **U5 (schema):** contractor bank photo parity — `submit_contractor_bank_change`
  re-signature + photo column + queue render (315 U2 pattern on the contractor table;
  storage path = the contractor docs convention, verified at build).
- **U6 (deferred):** outbox notifications for submits/decisions.
- **U7 (schema + code, operator ask 2026-07-14 mid-epic):** ชื่อธนาคาร becomes a
  SELECTION sorted by usage frequency, with icons. SSOT `src/lib/banks/thai-banks.ts`
  (canonical short names + brand-color monogram chips — no trademark image assets);
  shared `BankSelect` chip picker (อื่นๆ free-text escape; a stored non-canonical
  value opens prefilled in อื่นๆ mode so legacy rows stay editable); order = live
  `bank_name_usage()` DEFINER aggregate (names+counts only across
  workers/contact_bank/staff_registration_bank — zero-grant walls intact; mig
  `075789`) with market-share rank as tiebreak. Wired into all 5 bank-name forms
  (worker change · contractor change · staff signup · PM contact bank · PM roster
  add/edit). Follow-up: the PR-#465 transcription form gets the picker once that
  rescued PR lands.

## U1 accepted seams (fresh-eyes review, 2026-07-14)

- **Clear-semantics split:** `update_own_staff_contact` is coalesce-keep (blank =
  keep; matches its sibling on the same table) while the worker RPC is blank-clear.
  The U2 UI must label staff fields "เว้นว่าง = คงค่าเดิม" and never offer a
  clear-field gesture through this RPC. pgTAP pins the keep behavior.
- Gate uses `status not in ('pending','approved')` (NOT-NULL 3-value enum today);
  the sibling's `is distinct from` idiom is the belt-and-suspenders form — noted,
  not re-pushed for a nit.

## U5 notes (fresh-eyes review, 2026-07-14)

- procurement_manager (a page viewer for the worker kinds) sees contractor
  passbook photos it cannot decide — consistent with the dcedit posture (it
  already saw the typed contractor bank fields); accepted, not decider-scoped.
- Duplicate-key (23505) from the atomic one-pending index maps to the same
  friendly มีคำขอที่รออนุมัติอยู่แล้ว message in the submit actions.
- bank_book_path length check aligned to contact_attachments' 400-char cap so a
  decide-time insert can never abort on length.

## U2 notes (fresh-eyes review, 2026-07-14)

- isStaffHome excludes contractor-bound logins too — one person never sees two
  bank homes; a staff+contractor hybrid gets the portal link + identity form.
- The invalid-account-number RPC refusal maps to a field-level Thai message.
- Orphaned passbook blobs on failed/retried submits: accepted (same posture as
  the worker/contractor forms; owner-only folders).
- Composition rule: render what has no home elsewhere, LINK to the audience
  home for the rest — office staff get their first self-service home here;
  bound workers → /technician, contractors → /portal; identity + display name
  are universal.

## Out of scope

- Address/phone for office staff beyond the registration fields (no structured address
  column exists for staff — follow-up if asked).
- Editing LINE-owned fields (`line_display_name`, avatar source) — LINE ground truth.
- Phoneless (unbound) workers — PM continues to edit them directly via `update_worker`.
- HR document types beyond id_card/book_bank/profile_photo.

## Verification checklist (per unit)

- [ ] pgTAP new files green + zero collateral (known reds 200/221 only).
- [ ] Vitest suite green; lint/typecheck clean.
- [ ] Browser real-flow per unit (dev-preview role-flip recipe; staged flows driven
      end-to-end: submit → queue → decide → records applied).
