# Spec 333 — deferred-docs office approve (เข้าระบบก่อน ส่งเอกสารภายหลัง)

**Status:** approved in chat 2026-07-21 (operator: ณัฐวุฒิ is payroll staff, "allow
them access app first, then upload later"). Ships as U1 (schema) + U2 (code).

## Problem

Two real office hires (จารุวัฒน์ PRC-26-0003, ณัฐวุฒิ PRC-26-0004 — legal dept)
abandoned self-registration after step 1 (0 attachments, 0 PDPA consent, 0 bank
rows, stalled since 2026-07-08). `approve_staff_registration` enforces the
spec-296 floors unconditionally on the PRC arm — full_name + id_card attachment

- PDPA consent + book_bank attachment + declared bank row — so they cannot be
  approved, and without approval they have no working app account. The operator
  wants them working in the app now, with documents collected afterwards.

For an OFFICE role the approve RPC assigns `users.role` only — no `workers`
row is created and no bank data is copied anywhere at approve time (verified
against the live body 2026-07-21). The document floors are HR-record
completeness, not structural dependencies, so deferring them breaks nothing
downstream. For a FIELD role (technician) the same floors feed the `workers`
insert (bank columns) — deferral is NOT offered there.

**PDPA floor is deliberately KEPT.** Consent is a legal wall (spec 298
capture-blind discipline), it costs the applicant one checkbox on a form they
can already resume (a pending registration re-renders the full form), and
approving data processing without recorded consent is off-model. Same for
full_name (it identifies who is being approved). Only the three DOCUMENT
floors defer: id_card attachment, book_bank attachment, bank fields row.

## U1 — schema (mig `20260813075822`, claims schema lane `075822`)

1. `approve_staff_registration` gains `p_defer_documents boolean default false`
   (6→7 args; 328-U1 precedent: new defaulted param ⇒ DROP the old 6-arg
   arity + re-`revoke ... from anon, public` on the new one; body sourced from
   LIVE, PRC/contractor arms byte-identical when `p_defer_documents = false`).
   - `p_defer_documents = true` and `p_role = 'technician'` → refuse (mode F1).
     The contractor arm is technician-only, so this single guard also excludes
     the subcon arm.
   - `p_defer_documents = true` (office role): skip the id_card, book_bank and
     bank-row floors. full_name + PDPA floors run unchanged.
   - On success with defer: `staff_registrations.documents_deferred_at = now()`
     (new nullable timestamptz column — the queryable "docs owed" flag;
     `reviewed_by` already records who deferred) and the existing `role_change`
     audit payload gains `'documents_deferred': true`.
2. `add_staff_registration_doc`: widen the spec-315 approved carve. Current:
   approved rows accept `id_card` only. New: approved rows accept `id_card`
   (unchanged, any approved row) or `book_bank` **when
   `documents_deferred_at is not null`**. All other non-pending writes stay
   refused.
3. `record_own_staff_bank`: accept when `status = 'approved' and
documents_deferred_at is not null` (else pending-only, unchanged).
4. `record_staff_consent`: UNCHANGED (consent precedes approval by design).

## U2 — code

1. `registrationApprovalFloor` UNCHANGED (fact-check 2026-07-21): the plain
   floor evaluated on an approved deferred row already returns exactly the owed
   set (full_name + consent were enforced pre-approve, so only document items
   can be missing), and the decision sheet has no client floor gate to relax
   (the RPC is the gate; errors surface Thai-mapped).
2. `/registrations` decision sheet (`registration-decision.tsx`):
   a. **Role selector widened to the documented SSOT.** The component's local
   `QR_ROLE_OPTIONS` (technician + site_admin, operator directive
   2026-07-08, pre-dating any real office applicant) contradicts its own
   header comment ("options = STAFF_ONBOARDABLE_ROLES") and makes `legal`
   unassignable from the UI. Replace with a grouped `<select>` over
   `STAFF_ONBOARDABLE_ROLES`: optgroup `หน้างาน` = technician, site_admin;
   optgroup `ออฟฟิศ` = the rest. Default stays `technician`. The firm-picked
   rule (all non-technician options disabled) applies across both groups
   unchanged. Supersession of the 07-08 narrowing is authorized by the
   operator's 2026-07-21 directive (approve the two legal-dept hires through
   this queue).
   b. When the picked role is NOT `technician` and no firm is picked, show a
   `ส่งเอกสารภายหลัง` checkbox (default off) with helper text; ticking it
   passes `deferDocuments: true` to the approve action, which forwards
   `p_defer_documents: true` (omit-when-false, contractor-param pattern).
   The RPC is the sole gate (the sheet has no client floor gate today —
   fact-check 2026-07-21); a defer denial surfaces as the mapped Thai error.
   Picking technician or a firm hides AND clears the checkbox. (site_admin
   qualifies: the RPC mints a workers row ONLY for p_role='technician', so
   the guard is technician-based, not an office-role list.)
   c. F1's RPC error string maps to Thai in `registrationErrorToThai`
   (`src/lib/register/registration-error.ts`) — the established mapping
   layer for approve errors.
3. Register workspace (`staff-register-workspace.tsx`): an APPROVED
   registration currently always redirects to roleHome. New: if
   `documents_deferred_at` is set AND at least one of {live id_card, live
   book_bank, bank row} is missing, render the docs-owed view instead:
   `<DocsOwedCard>` (new, `src/components/features/register/docs-owed-card.tsx`)
   = heading `เอกสารที่ต้องส่งเพิ่ม`, hint that the account already works, a
   `ไปหน้าหลัก` link to roleHome, upload buttons for the missing attachments
   (existing `addStaffRegistrationDoc` action) and the bank mini-form (existing
   `recordOwnStaffBank` action) when the bank row is missing. When nothing is
   missing the redirect behaves exactly as today.
   (`getOwnTechnicianRegistration` uses `select("*")` — the new column arrives
   via `pnpm db:types` regen alone; no select-list edit. Fact-check 2026-07-21.)
4. `/registrations` queue list (`registration-queue-list.tsx`): the queue
   ALREADY renders approved/rejected rows with status badges (fact-check
   2026-07-21 — the earlier "pending-only" premise was false). Approved rows
   with `documents_deferred_at` set whose plain approval floor is still unmet
   get an `เอกสารค้าง` chip, so HR can chase the owed documents from the
   existing list. No new surface. The floor is evaluated with the invited firm
   IGNORED (fresh-eyes 2026-07-21): a deferred approval is never the contractor
   arm, so a stale advisory `invited_contractor_id` must not let the
   bank-exempt short-circuit hide owed documents.

Out of scope (open questions if wanted later): a roleHome nag banner,
extending deferral to field roles, auto-reminder pings.

Coupling guard (fact-check 2026-07-21): pgTAP `315-id-card-resubmit` and
`296-book-bank-onboarding` assert the very refusals U1.3/U1.4 partially open;
they stay green ONLY because their approved fixtures carry
`documents_deferred_at IS NULL`. Do not set the stamp on those fixtures; the
deferred `lives_ok` cases live in `334-deferred-docs-approve` with their own
fixtures.

## Negative cases / error messages / recovery (binding template)

| #   | Mode                                              | Layer                                                                                                | Exact behavior                                                          | User-facing Thai                                                                                              | Recovery                                                            |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| F1  | defer + technician                                | RPC P0001 `approve_staff_registration: deferred documents are not available for the technician role` | approve refused                                                         | `ส่งเอกสารภายหลังใช้ไม่ได้กับตำแหน่งช่าง` (via registrationErrorToThai; decision sheet is the single surface) | untick defer or pick a non-field role                               |
| F2  | defer approve, no PDPA consent                    | RPC P0001 (existing consent floor, message unchanged)                                                | approve refused                                                         | existing floor hint in decision sheet (`ยังไม่ครบตามเงื่อนไข…` list shows PDPA)                               | applicant resumes the pending form, ticks consent; approver retries |
| F3  | defer approve, blank full_name                    | RPC P0001 (existing floor)                                                                           | approve refused                                                         | existing floor hint                                                                                           | applicant fills name; retry                                         |
| F4  | book_bank upload on approved row WITHOUT deferral | RPC P0001 `registration is no longer pending` (unchanged)                                            | write refused                                                           | existing error toast (registration-error mapping)                                                             | none — by design                                                    |
| F5  | bank fields on approved row WITHOUT deferral      | RPC P0001 (unchanged)                                                                                | write refused                                                           | existing error toast                                                                                          | none — by design                                                    |
| F6  | docs-owed view, all docs since completed          | —                                                                                                    | workspace redirects to roleHome (card never renders on nothing-missing) | —                                                                                                             | self-heals                                                          |
| F7  | double upload same purpose post-approval          | supersede chain (`v_prior`) — newest wins                                                            | —                                                                       | —                                                                                                             | self-heals                                                          |

Each mode → RED-first test: F1–F5 = `throws_ok`/`lives_ok` in pgTAP
`334-deferred-docs-approve.test.sql`; F6 + the checkbox gating = RTL component
tests; floor-helper deferred mode = unit test.

## Verification checklist

- pgTAP 334 green RED-first; arity pins in **264/288/328** updated alongside
  (approve 6→7 args — the predictable guard trip, 328-U1 lesson; 282 pins
  nothing here, fact-check 2026-07-21).
- `pnpm db:types` regenerated; typecheck/lint/test green.
- Real-flow: dev-preview approves a seeded office registration with defer →
  applicant session sees docs-owed card → uploads book_bank → card shrinks →
  completes → redirect restored. (Seeded rows torn down.)
- Live fill-rate follow-up (doctrine): after the real approvals, verify
  `documents_deferred_at` set and, within a week, whether docs actually arrive
  — zero arrivals = the nag surface is too weak, revisit.
