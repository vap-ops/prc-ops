# Spec 296 — Book-bank capture at staff signup

**Status:** 🎨 DESIGN (approved by operator 2026-07-11; revised after 4-lens adversarial review).
**Type:** onboarding data-capture (photo + declared bank fields).
**Class:** danger-path — migration + new table + RLS/grants + money-adjacent `workers.bank_*` write ⇒ **U1 operator-merged**.
**Parent:** spec 279 self-gov onboarding · extends the spec 264 (ADR 0072) `staff_*` flow.

Every staff applicant provides their **bank-passbook photo + declared bank fields**
(bank name / account number / account holder) during self-onboarding. Both become
**approval-floor requirements** alongside `id_card` + PDPA consent. The typed fields live
in a **dedicated zero-grant table** (mirroring `contact_bank`) so they are readable only by
the applicant (own) and the approver set — never by the in-project site_admins who can see
the registration row. On approval into a worker-creating role, the declared bank copies onto
the `workers` payee record.

> Scope note: this is the **book-bank half only** of the operator's 2026-07-11 "technician
> onboarding" ask. The **QR site check-in/out** half is a separate epic (scannable worker
> identity token + camera scanner + timestamped attendance model + a `site_owner` surface) —
> NOT in this spec.

## Doctrine anchors (read these; they shape the mechanism)

- **ADR 0072** — Staff self-onboarding: one role-parametric internal-staff flow;
  `approve_staff_registration(p_role)` with a per-role side-effect; in-app PDPA consent
  record (§7). This spec extends that flow; it does not fork it.
- **ADR 0079** — Self-governance crew onboarding + **money-governance split**: money-adjacent
  data is set/confirmed by PM/PD/super, never self-set and **not exposed to field roles**.
  Bank payee data is money-adjacent → (a) the write onto `workers` happens only at approval,
  by a `STAFF_APPROVAL_ROLES` actor (proc*manager / project_director / super_admin — the
  money-authorized set); (b) the declared bank is **walled off from site_admins/site_owners**,
  who are not in that set. Applicants \_declare*; approvers _confirm_.
- **ADR 0073** (supersedes 0062) — Worker identity merge; the `workers.bank_name /
bank_account_number / bank_account_name / tax_id` payee columns live here.
- **ADR 0060 / 0061** — Worker ecosystem / financial-inclusion mission: capturing a worker's
  payout account at onboarding is a foundational enabler.
- **Precedent to mirror:** `contact_bank` (contractor/supplier party bank) — a dedicated
  **zero-grant** table (only `service_role` granted; RLS-enabled with no authenticated policy;
  all access via DEFINER RPCs / service-role). This spec applies the same shape to staff.
- Memory: `spec279-self-gov-onboarding`, `self-governance-doctrine`, `sa-real-usage-photos-2026-07`.

## What already exists (verified LIVE 2026-07-11 — the exact starting point)

Registration substrate is role-neutral `staff_*` (ADR 0072). Field door `/register/technician`
and office door `/register/office` share one `StaffRegisterWorkspace` + `staff-registration-form`
and one `approve_staff_registration`.

**DB (live):**

- Enum `public.staff_doc_purpose` = `{id_card, profile_photo}`. `staff_consent_kind` = `{pdpa_data}`.
- `staff_registrations` columns: `id, user_id, employee_id, full_name, phone, date_of_birth,
emergency_contact_{name,relation,phone}, status, reviewed_by, reviewed_at, reject_reason,
created_at, updated_at, declared_role_hint, invited_by, invited_project_id`. **No bank columns.**
  Applicant fields nullable (progressive fill).
- **Grants/RLS on `staff_registrations`:** `authenticated` holds a **table-level SELECT** (covers
  every current + future column) — no INSERT/UPDATE grant (writes via DEFINER RPCs only). RLS
  SELECT policies: `own row readable by applicant` (`user_id = auth.uid()`) **and**
  `readable by back office and site read` (`can_see_staff_registration(id)`).
- **`can_see_staff_registration(id)`** (live, narrowed spec 295): true for `procurement_manager /
project_director / super_admin` (every registration) **OR** for `site_admin / site_owner` on a
  **pending** row whose `invited_project_id` they `can_see_project`. ⇒ **an in-project SA can read
  the full pending applicant row.** RLS is row-granular — it cannot hide specific columns from that
  SA arm. (This is why the bank fields must NOT be columns on this table.)
- `staff_registration_attachments` — append-only supersede chain; "current" = anti-join
  (`not exists newer.superseded_by = a.id`); UPDATE/DELETE trigger-blocked.
- `staff_consents` — `kind` (`pdpa_data`) + dated/revocable (`revoked_at`); one-way tick.
- `workers` payee columns (live, all `text` nullable): `bank_name, bank_account_number,
bank_account_name, tax_id`.
- `approve_staff_registration(p_id uuid, p_role user_role, p_project_id uuid DEFAULT null,
p_pay_type pay_type DEFAULT 'monthly', p_employment_type employment_type DEFAULT 'permanent')`
  — SECURITY DEFINER. Actor-gate `('procurement_manager','project_director','super_admin')`.
  **Floor (inline, unconditional):** `full_name` non-empty (`nullif(btrim(...),'')`) + a live
  `id_card` attachment (anti-join) + a live non-revoked `pdpa_data` consent — else `P0001`. Then
  flips `users.role`, audits `role_change`, and **only** `if p_role in ('technician')` inserts a
  `workers` row (copying `phone, date_of_birth, emergency_contact_*`). Every other role = role-flip
  only, no worker row. **No `FIELD_ROLES` constant** — the branch is a hardcoded literal.
- RPC signatures (live): `record_staff_consent(p_kind)`; `add_staff_registration_doc(p_purpose,
p_storage_path)` — **note:** it does NOT validate that the path's purpose segment matches
  `p_purpose`; the _server action_ rebuilds the path from the purpose + session uid.
  `update_own_staff_registration(...)` selects the row and **RAISEs** on non-`pending`. **No
  `record_own_staff_bank` exists.**
- Storage RLS on `storage.objects` — **two** staff-doc policies, INSERT
  `staff doc uploads by applicant` (with_check) + SELECT `staff doc reads by applicant` (using),
  both `bucket='contact-docs'` AND folder `[technician, <auth.uid()>, ANY(id_card,profile_photo)]`.
  The SELECT policy is **owner-only** (no SA arm) — the passbook photo is not exposed to SAs; the
  approver views it via the service-role signed-URL path (`getRegistrationDocumentUrls`).
- `contact_bank` (the precedent): columns `id, {contractor,supplier,service_provider}_id,
bank_name, bank_account_no, bank_account_name, updated_at, updated_by`; grants = **service_role
  only** (zero-grant to authenticated/anon); RLS on, no authenticated policy.
- No office/staff-payroll bank table. `worker_bank_change_requests` handles later worker-bank
  corrections (worker proposes → PM approves).

**Client (live):**

- `src/lib/register/document-types.ts` — `STAFF_DOC_PURPOSES = ["id_card","profile_photo"]` +
  `STAFF_DOC_LABELS: Record<StaffDocPurpose,string>` (total record — a new enum member
  type-errors until added). `RegistrationDocumentsView` and the form's `DocRow` iterate this list.
- `src/lib/register/registration-floor.ts` — pure `registrationApprovalFloor({fullName, hasIdCard,
hasConsent}) -> {met, missing}`; `ApprovalRequirement = "full_name"|"id_card"|"consent"`.
  `profile_photo` deliberately excluded (optional).
- `src/lib/register/own-registration.ts` — `getOwnTechnicianRegistration` reads the applicant's own
  row via the RLS session `.select("*")`.
- `src/components/features/register/staff-register-workspace.tsx` — builds the form's `initial`
  prop from the registration row (fresh + pending branches); `StaffRegistrationFormInitial` interface.
- `src/components/features/register/staff-registration-form.tsx` — one-page form; `DocRow`
  `required = purpose === "id_card"`; `StaffConsentCheckbox` shows a "ก่อนที่จะได้รับการอนุมัติ"
  hint enumerating floor items; consent = one-way tick (not floor-gated).
- `src/lib/register/actions.ts` — thin actions returning `ActionResult = {ok:true}|{ok:false,error}`;
  guard `getActionUser`; relay on the caller's RLS session (`auth.supabase.rpc`); errors via
  `registrationErrorToThai`; success `revalidatePath("/register/technician")`.
- `src/app/registrations/[id]/page.tsx` — approver detail; gate `requireRole(STAFF_APPROVAL_ROLES)`;
  applicant-fields card (`ข้อมูลผู้สมัคร`, a `<dl>` of `<Row label value>`); docs via
  `getRegistrationDocumentUrls` (RLS row read + **service-role** URL signing) →
  `<RegistrationDocumentsView>`; `<RegistrationDecision>` when `status==="pending"`.
- `src/lib/register/admin-registrations.ts` — `getTechnicianRegistrationById` /
  `listVisibleTechnicianRegistrations` read the row via the RLS session `.select("*")`; the
  **service-role admin client is used only to sign storage URLs**, never to read row columns.
- `STAFF_APPROVAL_ROLES = [procurement_manager, project_director, super_admin]` (`role-home.ts`).

## The mechanism (what this spec builds)

### 1. Dedicated zero-grant bank table (the SA-leak fix — ADR 0079, `contact_bank` precedent)

New table `public.staff_registration_bank` (1:1 with a registration):
`registration_id uuid PRIMARY KEY REFERENCES staff_registrations(id) ON DELETE CASCADE`,
`bank_name text NOT NULL`, `bank_account_number text NOT NULL` (normalized digits),
`bank_account_name text NOT NULL`, `updated_at timestamptz`, `updated_by uuid`.
**Grants = `service_role` only** (zero-grant to `authenticated`/`anon`). **RLS enabled, NO
permissive `authenticated` policy** (deny-by-default) — so a direct authenticated SELECT (incl.
an in-project SA) returns nothing; the only reads are DEFINER RPCs (run as owner) and the
service-role admin client. This structurally keeps applicant bank away from the SA row-read arm.

### 2. Owner write + read paths (DEFINER only)

- **Write:** DEFINER `record_own_staff_bank(p_bank_name text, p_account_number text,
p_account_name text)` — SELECTs the caller's registration; **RAISE `42501` if not found**,
  **RAISE `P0001` if `status is distinct from 'pending'`** (sibling pattern, not a silent no-op).
  Validates all three `btrim`-non-empty and the account number matches `^\d{6,20}$` after stripping
  spaces/dashes; **stores the normalized digits**. Upserts the 1:1 row (`updated_by = auth.uid()`).
  `revoke execute … from anon` (new function → the Supabase-grants-anon-explicitly class).
- **Owner read:** DEFINER `get_own_staff_bank()` returns the caller's own pending row's three
  fields (or nulls) — feeds the form prefill + `hasBankFields`. `revoke execute from anon`.
- Client action `recordOwnStaffBank({bankName, accountNumber, accountName})` modeled on
  `updateOwnStaffRegistration` (validate → guard → `rpc` → `registrationErrorToThai` → revalidate).

### 3. Book-bank passbook photo (existing pipeline + one hardening)

Add `book_bank` to enum `public.staff_doc_purpose`; add it to **both** storage RLS policy
allowlists (`ANY(id_card, profile_photo, book_bank)`, INSERT + SELECT). No new bucket/path helper —
`technician/{uid}/book_bank/{id}.{ext}` in `contact-docs`, append-only via `add_staff_registration_doc`.
Client: add `book_bank` to `STAFF_DOC_PURPOSES` + `STAFF_DOC_LABELS` (`"สมุดบัญชีธนาคาร"`) — it then
renders as a required `DocRow` on the form AND automatically in the approver's `RegistrationDocumentsView`.
**Hardening (the floor now depends on this attachment):** `add_staff_registration_doc` gains a check
that `(storage.foldername(p_storage_path))[2] = auth.uid()::text` AND `[3] = p_purpose::text`, so a
purpose row cannot point at a mismatched/other-folder path (closes a self-cheat where an applicant
satisfies the `book_bank` floor with an `id_card` image). Applies uniformly to all purposes (the
server action already builds conformant paths, so no client change).

### 4. Approval floor gains book-bank + bank presence (id_card tier, unconditional — ADR 0072 §4)

`approve_staff_registration` via `CREATE OR REPLACE` (**same 5-arg signature** — no DROP, so the
existing ACL incl. anon-revoke is preserved; do NOT re-grant/re-revoke). Add two floor checks
alongside id_card + consent, **before** the role branch (apply to every staff registration,
field + office):

1. a live (anti-join) `book_bank` attachment exists — else `P0001`;
2. a `staff_registration_bank` row exists for this registration with all three fields
   `coalesce(btrim(...),'') <> ''` — else `P0001`.
   Then, **inside the existing `if p_role in ('technician')` branch only**, join
   `staff_registration_bank` and add `bank_name, bank_account_number, bank_account_name` to the
   `workers` INSERT (defense-in-depth: re-assert the `^\d{6,20}$` shape before copy, since approve is
   the sole writer of the money-adjacent payee column). Office roles: no worker row → the declared bank
   stays in `staff_registration_bank` for record; nothing copied.

### 5. Client floor view-model + form

`registration-floor.ts`: extend input to `{fullName, hasIdCard, hasBookBank, hasBankFields,
hasConsent}` and `ApprovalRequirement` to add `"book_bank" | "bank_fields"`; push into `missing`
when absent. `staff-register-workspace.tsx` + `StaffRegistrationFormInitial`: thread the three bank
values (from `get_own_staff_bank`, `?? ""`) into the form's `initial` so they survive reload.
`staff-registration-form.tsx`: `DocRow` `required` set becomes `{id_card, book_bank}`; add a
bank-fields sub-block (3 inputs → `recordOwnStaffBank`); compute `hasBookBank` from `docUrls.book_bank`
and `hasBankFields` from the three initial/typed values; feed both into the floor; update the consent
hint copy to enumerate book-bank + bank account. **PDPA copy (clarification, single consent):** append
`" รวมถึงข้อมูลบัญชีธนาคารเพื่อการจ่ายค่าจ้าง"` to the consent line — payroll bank falls under the
existing employment-purpose consent; the `staff_consents`/`pdpa_data` record + RPC are unchanged.
**Client bank validation helper** = UX pre-check only (mirrors the RPC's `^\d{6,20}$`/normalization);
the RPC is the authoritative gate. `maxLength`: bank_name 80, account_name 120, account_number 30.

### 6. Approver verification surface (`/registrations/[id]`)

The book-bank photo renders automatically via `RegistrationDocumentsView`. For the three bank text
values, `admin-registrations.ts` gains a **service-role** fetch of `staff_registration_bank` for the
registration id (the page already passed `requireRole(STAFF_APPROVAL_ROLES)` + the RLS row read), and
`page.tsx` renders three `<Row>`s (`ธนาคาร`, `เลขที่บัญชี`, `ชื่อบัญชี`) in the `ข้อมูลผู้สมัคร` card
so the approver eyeballs typed-vs-passbook before approving. No inline-edit (see sub-decisions).

## Unit plan

| Unit                                   | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                  | Merge gate                                                                                                                                        | Tests (RED-first: each unit opens with its failing test seen to fail)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U1 — schema & DB contract**          | One additive migration: enum `+book_bank`; new table `staff_registration_bank` (zero-grant, RLS-on, service_role-only, `contact_bank` shape); RPCs `record_own_staff_bank` + `get_own_staff_bank` (DEFINER, own+pending guard, validate/normalize, +revoke anon); `add_staff_registration_doc` purpose↔path hardening; `approve_staff_registration` `CREATE OR REPLACE` (floor + technician-branch bank copy). `db:push` + `db:types`. | **Operator-held danger-path** (migration + new table + RLS/grants + payroll-adjacent `workers.bank` write). NOT self-merge — flag 🔔.             | pgTAP `296-book-bank-onboarding`: **zero-grant** — an in-project `site_admin` (can_see_staff_registration true) selecting `staff_registration_bank` gets 0 rows / denied; owner reads own via `get_own_staff_bank`; approver reads via service-role. `record_own_staff_bank`: writes own pending row; RAISEs on another's row (42501) and on an approved/non-pending own row (P0001); rejects empty field + non-`^\d{6,20}$` account number; normalizes spaces/dashes; anon-revoked. `approve` rejects w/o book_bank photo; rejects w/o bank row; copies bank→`workers` for `technician`; office role = no worker row, bank retained. `add_staff_registration_doc` rejects a purpose≠path-segment mismatch. Update `staff_doc_purpose` enum pins. |
| **U2 — applicant capture**             | `document-types.ts` (+purpose/label); `registration-floor.ts` (+2 reqs); `staff-register-workspace.tsx`+`StaffRegistrationFormInitial` (bank prefill from `get_own_staff_bank`); `staff-registration-form.tsx` (required set, bank sub-block, floor wiring, hint + PDPA copy); `actions.ts` (+`recordOwnStaffBank`); a `registration-bank` validation helper. Consumes U1 enum+RPCs.                                                   | Code-only → auto-merge on green.                                                                                                                  | Vitest: `registration-floor` (book_bank + bank_fields drive `missing`/`met`); bank validation helper boundaries (5 reject, 6/20 accept, 21 reject, dash/space normalize); form renders required book-bank row + bank inputs, save calls action + reload prefills; action shape/guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **U3 — approver verification surface** | `admin-registrations.ts` (+service-role `staff_registration_bank` fetch); `registrations/[id]/page.tsx` (+3 bank `<Row>`s). Photo auto-renders.                                                                                                                                                                                                                                                                                        | Code-only → auto-merge on green (service-role read of a money-adjacent table — confirm the danger-path guard verdict; if flagged, operator-held). | Vitest/RTL: detail page shows the 3 declared bank rows (from the service-role fetch) + the book-bank image slot; fetch returns the columns; no bank shown when absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Build order U1 → U2 → U3. Real-flow verify each (dev-preview login; register door for U2,
`/registrations/[id]` for U3) per unit gate 4.

## Design sub-decisions resolved in this spec (do not relitigate)

- **Capture = photo + typed fields.** Both. (Operator, 2026-07-11.)
- **Requirement tier = id_card ("required to submit").** Book-bank photo AND all 3 bank fields are
  approval-floor items (DB-enforced + form checklist). Accepted tradeoff: an applicant without their
  passbook cannot be approved. (Operator.)
- **Who = all staff signups.** Floor requirement unconditional (field + office). Copy-to-`workers`
  is technician-branch only. _Noted PDPA minimization concern:_ office/back-office roles (accounting,
  hr, legal, auditor) that never get a worker row still must supply bank; it is collected + stored but
  unused for them — accepted per the operator's "all staff" choice. (Operator.)
- **Bank fields live in a dedicated zero-grant table** `staff_registration_bank` (mirror
  `contact_bank`), NOT columns on `staff_registrations` — because the spec-295 SA arm of
  `can_see_staff_registration` would otherwise expose applicant bank to in-project site_admins, and
  RLS cannot hide columns. Owner reads via DEFINER, approver via service-role. (Operator, 2026-07-11.)
- **PDPA = single-consent clarification.** Payroll bank falls under the existing employment-purpose
  `pdpa_data` consent; add the bank clause to the displayed copy only. No new/versioned consent
  record. Broader PDPA lawful-basis work stays with spec 279 U3 (⚖️ counsel). (Operator, 2026-07-11.)
- **Validation authority = the DB RPC.** `record_own_staff_bank` is the authoritative gate
  (non-empty + `^\d{6,20}$` normalized, stores digits); the client helper is a UX pre-check only;
  `approve` re-asserts the shape as defense-in-depth. Both layers' tests assert the same boundaries.
- **Approver cannot inline-edit** the declared bank at approval. Approve = confirm-as-declared (copy
  to worker); wrong data → reject-with-reason bounces it back; post-hire corrections use the existing
  `worker_bank_change_requests` staged flow. Keeps the approve RPC signature stable. (Operator.)
- **Bank name = free-text input** (not a bank picker) for v1. A Thai-bank select is a future
  enhancement, out of scope.
- **No re-signature of `approve_staff_registration`** — `CREATE OR REPLACE` keeps the OID + ACL;
  it reads the bank via a join in the DEFINER body, no new params.

## Out of scope

- QR site check-in/out (separate epic), any camera/scanner, any scannable worker token.
- Surfacing/editing the passbook on the worker record post-approval; an office-payroll bank table;
  PromptPay; OCR of the passbook; a Thai-bank picker.
- Changing the `worker_bank_change_requests` correction flow; requiring book-bank retroactively for
  already-approved workers; re-collecting consent from pre-296 in-flight pending applicants.

## Verification checklist

- **U1 (schema):** `pnpm db:push` clean; `pnpm db:types` regenerates `book_bank` + the
  `staff_registration_bank` types; `pnpm db:test` — `296-book-bank-onboarding` all green, enum-pin
  tests green, zero collateral beyond known reds (200/221). Live probes: as an **in-project
  `site_admin`** RLS session, `select * from staff_registration_bank` returns 0 rows (zero-grant);
  as the **owner**, `get_own_staff_bank()` returns the saved fields; `record_own_staff_bank` on own
  pending row succeeds, on another's / an approved row RAISEs; `record_own_staff_bank` with a
  non-digit or 5-digit account number RAISEs; a dashed input persists as normalized digits.
- **U2 (form):** `pnpm lint && pnpm typecheck && pnpm test` green. Dev-preview `/register/technician`:
  required checklist lists book-bank photo + bank account; cannot reach an approvable state until both
  present; **save then reload prefills the 3 bank inputs**; consent line shows the bank clause; zero
  console errors. (Confirm the office door `/register/office` shows the same requirements.)
- **U3 (approver):** tests green. Dev-preview as `STAFF_APPROVAL_ROLES` on a pending registration with
  book-bank submitted: the passbook image and the 3 declared bank rows render (via the service-role
  fetch); approving as `technician` creates a worker whose `bank_*` equals the declared values (live
  query); approving an office role leaves the bank in `staff_registration_bank`, no worker row.
- **Whole feature:** `scripts/ship-pr.sh` proves each unit merges clean; fresh-eyes review per unit;
  U1 held for operator merge.
