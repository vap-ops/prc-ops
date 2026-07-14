# Spec 315 — Technician document self-service (ID-card renewal + bank-change passbook evidence)

**Status:** 🔨 BUILDING (operator-approved 2026-07-14)
**Requested by:** operator, 2026-07-14 — "technician user cannot request change bank
document or id card. 1. id card can expire 2. they may want to change receiving bank."
**Operator decisions (2026-07-14, in-chat):**

- ID-card re-submit = **self-serve supersede** (no approval queue; old photo kept
  forever in the append-only chain).
- Bank-change request = **passbook photo REQUIRED** (matches the spec 296 signup
  floor; the approver verifies the typed account number against the photo).

## Problem

A technician's signup documents freeze at approval. `add_staff_registration_doc`
refuses any upload once `staff_registrations.status ≠ 'pending'`, so:

1. An **expired ID card** can never be renewed — the registration keeps the stale
   photo forever.
2. The **bank-change flow** (spec 170 U4c-2 — typed fields → PM decide) carries no
   passbook photo, so the approver decides blind and the registration's
   `book_bank` document goes stale the moment a change is approved.

## What already exists (verified live 2026-07-14)

- `submit_worker_bank_change(text,text,text)` / `decide_worker_bank_change(uuid,bool)`
  — staged typed-fields change, decide gate `is_manager() OR procurement_manager`
  (075783). Form on `/technician` (`WorkerBankChangeForm`), queue on
  `/contacts/bank-changes` (admin-read behind `requireRole([...PM_ROLES,
'procurement_manager'])`).
- Storage policies `staff doc uploads/reads by applicant` — owner-scoped
  `technician/<uid>/<purpose>/…`, **no status gate**. No storage changes needed.
- `staff_registration_attachments` supersede chain (new row `superseded_by` → prior
  current; current = anti-join). Own reads via `getOwnRegistrationDocuments`
  (newest `created_at` per purpose).

## U1 — ID-card re-submit on an approved registration (schema + UI, one PR)

**Migration `20260813075786_spec315u1_id_card_resubmit.sql`:**

- `CREATE OR REPLACE add_staff_registration_doc` (same signature — ACL preserved;
  body sourced from LIVE, verified identical to 075700). Gate change only:
  allow when `status = 'pending'` (any purpose, as today) **OR**
  (`status = 'approved'` AND `p_purpose = 'id_card'`). Everything else —
  rejected registrations, `book_bank`/`profile_photo` on approved — still refused.
  (`book_bank` on an approved registration flips ONLY via U2's decide-approve, so
  the photo can never contradict the live `workers.bank_*`.)

**UI (`/technician`):** an เอกสาร section in the worker portal — current ID-card
photo (already loaded via `getOwnRegistrationDocuments`) + an upload control
reusing the registration form's machinery (`preparePhotoForUpload` →
storage upload at `buildTechnicianDocPath(uid,'id_card',…)` →
`addStaffRegistrationDoc` action). Copy explains: update when the card is renewed.
Rendered only when the caller's registration is `approved`.

**pgTAP `315-id-card-resubmit.test.sql`:** approved+id_card succeeds and chains
(`superseded_by` = prior current); approved+book_bank refused; approved+profile_photo
refused; rejected refused; pending still accepts all purposes.

## U2 — passbook photo on the worker bank-change request (schema + UI, one PR)

**Migration `20260813075787_spec315u2_bank_change_passbook.sql`:**

1. `worker_bank_change_requests` + nullable `book_bank_path text` (length ≤ 500;
   nullable so pre-existing pending rows stay decidable).
2. `DROP FUNCTION submit_worker_bank_change(text,text,text)`; recreate 4-arg
   `(p_bank_name, p_bank_account_number, p_bank_account_name, p_book_bank_path)`.
   New validations: `p_book_bank_path` **required**; path must be the caller's own
   folder + purpose (`foldername` length 3, `[1]='technician'`,
   `[2]=auth.uid()::text`, `[3]='book_bank'` — mirrors
   `add_staff_registration_doc`'s spec-296 hardening). Explicit
   `revoke … from public, anon` + grant authenticated on the NEW signature
   (the 229 anon-EXECUTE class).
3. `CREATE OR REPLACE decide_worker_bank_change` (LIVE body verbatim + addition):
   on approve, after the `workers.bank_*` write, supersede-insert the request's
   `book_bank_path` into the worker's registration chain
   (`workers.user_id → staff_registrations.user_id`; skip gracefully when the
   worker has no registration or the request has no photo). `uploaded_by` =
   `v_req.requested_by`. The registration's book_bank document therefore always
   matches the live payout bank. Reject writes nothing.

**UI:** `WorkerBankChangeForm` gains a required photo picker (same upload
machinery; new storage object per attempt). `submitWorkerBankChange` action takes
`{attachmentId, ext}`, rebuilds the path server-side (never trusts a client path),
calls the 4-arg RPC. Queue page: worker cards render the passbook photo via an
admin-client signed URL (TTL 120s — same exposure model as registration docs,
spec 296 U3); contractor cards unchanged.

**pgTAP:** update `201-worker-bank-change.test.sql` call sites to the 4-arg form;
new `315-bank-change-passbook.test.sql` — photo-less submit refused; forged-folder
path refused; valid submit lands path; approve updates `workers.bank_*` AND chains
the registration book_bank doc; reject chains nothing; photo-less legacy pending
row still decidable; anon cannot execute the new signature.

**Deploy window (accepted):** between `db:push` and the Vercel deploy the OLD
deployed form calls the dropped 3-arg signature and errors — bank-change submits
brick for minutes. Same class as spec 279 F2b's re-signature; surface is
low-traffic. Noted in the PR body.

## U2 hardening (fresh-eyes review, 2026-07-14)

- **Existence check:** `submit_worker_bank_change` refuses a well-formed path whose
  object was never uploaded (P0001) — a dangling path could otherwise ride an
  approve into the evidence chain. Applicants have no storage DELETE policy, so
  existence at submit holds thereafter.
- **Approved-registration filter** on the decide chain-write (a bound worker could
  carry a rejected registration via `claim_worker_invite`).
- **Queue marker:** a declared-but-unsignable photo renders an explicit amber
  warning, never a silent no-photo card.
- Accepted: orphaned storage objects on failed/retried submits (owner-only folder,
  no DELETE policy — evidence-friendly litter).

## Accepted seams (fresh-eyes review, 2026-07-14)

- **Role-agnostic renewal:** ANY approved staff registration (office roles too, spec
  286 is role-neutral) may renew their own id_card via the RPC. Self-scoped +
  append-only + no status change — intended; only `/technician` surfaces the UI today.
- **Orphaned blob on action failure:** storage upload succeeds → record action fails
  → unreferenced photo stays in the private, owner-scoped bucket. Parity with the
  registration form's DocRow; retry mints a new path.
- **Concurrent-renewal double-head:** two devices re-submitting simultaneously can
  each chain onto the same prior (no serialization in the RPC; pre-existing spec-296
  seam). Readers already fall back to newest `created_at`, so display survives.

## Out of scope (surfaced, not built)

- `profile_photo` self-update on an approved registration.
- Contractor (`contact_bank`) flow — photo evidence there is a separate follow-up.
- ID-card expiry-date tracking/reminders.
- Notifying back-office on an ID-card re-submit (self-serve per operator decision).

## Verification checklist

- [ ] pgTAP: new files green, `201` updated green, zero collateral (known reds 200/221 only).
- [ ] Vitest suite green (form requires photo; action path rebuild; queue photo render; portal doc section).
- [ ] Browser: technician re-uploads ID card on `/technician` and sees the new photo; submits a bank change with photo; approver sees photo on `/contacts/bank-changes`, approves; `workers.bank_*` + registration `book_bank` chain both updated.
