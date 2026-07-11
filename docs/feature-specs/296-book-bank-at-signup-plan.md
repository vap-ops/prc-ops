# Book-bank at Signup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Also load the repo `ship-unit` skill for every unit** — it carries the binding gates (lane claim, dependency gate-check, RED-first, real-flow verify, fresh-eyes review, proved merge).

**Goal:** Capture a bank-passbook photo + typed bank fields at staff signup; make both approval-floor requirements; on approval into a worker-creating role, copy the bank onto the worker — with the typed fields held in a zero-grant table so in-project site_admins never see them.

**Architecture:** Extends the existing `staff_*` self-onboarding flow (ADR 0072). Typed bank lives in a new zero-grant table `staff_registration_bank` (mirrors `contact_bank`); owner reads/writes via DEFINER RPCs, approver reads via the service-role admin client. The passbook photo reuses the `staff_registration_attachments` + `contact-docs` pipeline with a new `book_bank` doc-purpose. `approve_staff_registration` gains two unconditional floor checks + a technician-branch bank copy.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + RLS + Storage, pgTAP, Vitest/RTL, TypeScript strict.

## Global Constraints (verbatim from spec 296 + CLAUDE.md)

- **Spec:** `docs/feature-specs/296-book-bank-at-signup.md`. Implement exactly it; no scope creep.
- **TDD, RED-first:** the first change in each unit is the failing test, seen to fail, before implementation.
- **Schema is single-lane.** Claim the lane in `../LANES.md` before any `supabase/migrations/` write (hook-enforced); next schema numbers **075690, 075700** (verify `../LANES.md` STATUS at start — take the live "next claimant").
- **Every table has RLS enabled.** New table = RLS on. Money/bank columns stay off `authenticated` grants.
- **Enums** are Postgres enums + exhaustive TS guards; adding a value must trip guards deliberately.
- **Ship via `scripts/ship-pr.sh`** (branch → PR → auto-merge on green). **U1 is danger-path → operator-held** (migration + new table + RLS/grants + payroll-adjacent `workers.bank` write). Do NOT self-merge U1.
- **Machine quirks:** `cd` in every Bash command; prefix `/c/Program Files/nodejs` to PATH for node/pnpm; Thai text only via Write/Edit (never PowerShell); fresh worktree needs `.temp` + `pnpm install`; live DB query = `pnpm exec supabase db query --linked` (stdin heredoc).
- **Known pgTAP reds:** 200/221 ONLY — any other red is collateral to fix.
- **Account-number rule (single source = the DB RPC):** non-empty; after stripping spaces/dashes matches `^\d{6,20}$`; **store the normalized digits**. Client helper is a UX pre-check mirroring this. `maxLength`: bank_name 80, account_name 120, account_number 30.
- **PDPA:** single existing `pdpa_data` consent; only the displayed copy gains a bank clause.

---

## Pre-flight (once, before Task 1)

- [ ] Read `../LANES.md` whole + `git status`. Confirm schema lane FREE; take the live next schema numbers.
- [ ] Create the worktree + branch + claim the lane:

```bash
cd "D:/claude/projects/prc-ops"
git -C prc-ops worktree add ../prc-ops-bookbank -b spec296-book-bank origin/main
cd "D:/claude/projects/prc-ops/prc-ops-bookbank" && cp ../prc-ops/.env.local . 2>/dev/null; export PATH="/c/Program Files/nodejs:$PATH" && pnpm install
```

Append a lane block to `../LANES.md` naming branch `spec296-book-bank` + schema claim `075690/075700`; re-read to confirm.

- [ ] Move the spec + this plan into the worktree if not present (they were authored in the main worktree): copy `docs/feature-specs/296-book-bank-at-signup.md` and `-plan.md` into `../prc-ops-bookbank/docs/feature-specs/` so they commit with U1.

---

## Task 1 (Unit U1) — Schema & DB contract _(danger-path, operator-held)_

**Files:**

- Create: `supabase/migrations/20260813075690_spec296u1a_book_bank_enum.sql`
- Create: `supabase/migrations/20260813075700_spec296u1b_book_bank_schema.sql`
- Create: `supabase/tests/database/296-book-bank-onboarding.sql`
- Modify: the `staff_doc_purpose` enum-pin pgTAP test(s) (grep below)
- Modify: `src/lib/db/database.types.ts` (regenerated, not hand-edited)

**Interfaces produced (later units rely on these exact names):**

- Table `public.staff_registration_bank(registration_id uuid PK→staff_registrations, bank_name text, bank_account_number text, bank_account_name text, updated_at timestamptz, updated_by uuid)` — zero-grant.
- RPC `record_own_staff_bank(p_bank_name text, p_account_number text, p_account_name text) returns void`.
- RPC `get_own_staff_bank() returns table(bank_name text, bank_account_number text, bank_account_name text)`.
- Enum `staff_doc_purpose` gains `'book_bank'`.
- `approve_staff_registration(...)` (same 5-arg signature) now requires book_bank photo + a bank row, and copies bank→`workers` for `technician`.

- [ ] **Step 1 — Write the failing pgTAP test.** Create `supabase/tests/database/296-book-bank-onboarding.sql`. Standard form (`begin; select plan(N); … select finish(); rollback;`). Cover, at minimum:

```sql
-- setup: seed a pending staff_registrations row owned by a test auth uid, with a live id_card
-- attachment + a live pdpa_data consent (reuse the 280/282 helpers/pattern for seeding).
-- 1) zero-grant: as role authenticated (site_admin who can_see_staff_registration), a direct
--    SELECT on staff_registration_bank throws 42501 (no table grant).
select throws_ok(
  $$ set local role authenticated; select * from public.staff_registration_bank $$,
  '42501');
-- 2) record_own_staff_bank writes own pending row (as the owner's jwt/uid).
--    then get_own_staff_bank returns the normalized values.
-- 3) rejects: empty field -> P0001; account '12ab' -> P0001; '12345' (5 digits) -> P0001.
-- 4) normalizes: '123-456-789' persists as '123456789'.
-- 5) writing another user's / an approved row -> raises (42501 / P0001).
-- 6) approve floor: with no book_bank attachment -> approve raises P0001.
-- 7) approve floor: with book_bank photo but no bank row -> approve raises P0001.
-- 8) approve as technician (floor met) -> workers row has bank_name/number/name = declared.
-- 9) approve as an office role (e.g. accounting) with floor met -> no workers row; bank row remains.
-- 10) add_staff_registration_doc with a path whose segment[3] != p_purpose -> raises 42501.
```

Write concrete assertions for each (use `throws_ok`, `results_eq`, `is`). Match the seeding idiom in `supabase/tests/database/280-crew-add-member.sql` / `282-*`.

- [ ] **Step 2 — Run it, verify RED.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-bookbank" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm exec tsx scripts/run-pgtap.ts supabase/tests/database/296-book-bank-onboarding.sql
```

Expected: FAIL (objects don't exist). (Runner refuses files missing a closing `rollback`.)

- [ ] **Step 3 — Enum migration.** `20260813075690_spec296u1a_book_bank_enum.sql`:

```sql
-- Spec 296 U1a — new staff document purpose for the bank passbook photo.
-- Separate file so the value is committed before 075700 references it as an enum literal.
alter type public.staff_doc_purpose add value if not exists 'book_bank';
```

- [ ] **Step 4 — Schema migration.** `20260813075700_spec296u1b_book_bank_schema.sql`. Write in this order:

```sql
-- Spec 296 U1b — book-bank capture: zero-grant bank table + owner RPCs + floor + copy.

-- 1. Zero-grant bank table (mirror contact_bank: service_role only, RLS on, no authenticated policy).
create table public.staff_registration_bank (
  registration_id      uuid primary key references public.staff_registrations(id) on delete cascade,
  bank_name            text not null,
  bank_account_number  text not null,
  bank_account_name    text not null,
  updated_at           timestamptz not null default now(),
  updated_by           uuid
);
alter table public.staff_registration_bank enable row level security;
revoke all on public.staff_registration_bank from anon, authenticated;
grant select, insert, update, delete on public.staff_registration_bank to service_role;
-- No policy for authenticated => deny by default. Reads/writes only via the DEFINER RPCs
-- below (run as owner, bypass RLS) and the service-role admin client (U3).

-- 2. Owner write RPC (own + pending guard; validate + normalize; upsert 1:1).
create or replace function public.record_own_staff_bank(
  p_bank_name text, p_account_number text, p_account_name text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid       uuid := auth.uid();
  v_reg       public.staff_registrations%rowtype;
  v_name      text := btrim(coalesce(p_bank_name, ''));
  v_acct_name text := btrim(coalesce(p_account_name, ''));
  v_acct      text := regexp_replace(coalesce(p_account_number, ''), '[[:space:]-]', '', 'g');
begin
  select * into v_reg from public.staff_registrations where user_id = v_uid;
  if not found then
    raise exception 'record_own_staff_bank: no registration for caller' using errcode = '42501';
  end if;
  if v_reg.status is distinct from 'pending' then
    raise exception 'record_own_staff_bank: registration is not pending' using errcode = 'P0001';
  end if;
  if v_name = '' or v_acct_name = '' or v_acct = '' then
    raise exception 'record_own_staff_bank: bank name, account number and account name are required' using errcode = 'P0001';
  end if;
  if v_acct !~ '^[0-9]{6,20}$' then
    raise exception 'record_own_staff_bank: account number must be 6-20 digits' using errcode = 'P0001';
  end if;
  insert into public.staff_registration_bank
    (registration_id, bank_name, bank_account_number, bank_account_name, updated_at, updated_by)
  values (v_reg.id, v_name, v_acct, v_acct_name, now(), v_uid)
  on conflict (registration_id) do update
     set bank_name = excluded.bank_name,
         bank_account_number = excluded.bank_account_number,
         bank_account_name = excluded.bank_account_name,
         updated_at = now(), updated_by = v_uid;
end; $$;
revoke execute on function public.record_own_staff_bank(text, text, text) from anon;

-- 3. Owner read RPC (feeds form prefill + hasBankFields).
create or replace function public.get_own_staff_bank()
returns table(bank_name text, bank_account_number text, bank_account_name text)
language sql security definer set search_path to 'public' as $$
  select b.bank_name, b.bank_account_number, b.bank_account_name
  from public.staff_registration_bank b
  join public.staff_registrations r on r.id = b.registration_id
  where r.user_id = auth.uid();
$$;
revoke execute on function public.get_own_staff_bank() from anon;

-- 4. Harden add_staff_registration_doc: bind purpose <-> path (the book_bank floor leans on it).
--    DEPENDENCY GATE: pull the LIVE body first
--    (pnpm exec supabase db query --linked <<'SQL' select pg_get_functiondef(...) 'add_staff_registration_doc' SQL),
--    reproduce it verbatim via CREATE OR REPLACE, and insert this check after its existing input
--    validation, before the insert:
--
--    if (storage.foldername(p_storage_path))[2] is distinct from auth.uid()::text
--       or (storage.foldername(p_storage_path))[3] is distinct from p_purpose::text then
--      raise exception 'add_staff_registration_doc: storage path does not match purpose/owner'
--        using errcode = '42501';
--    end if;
--
--    Same signature (p_purpose, p_storage_path) => CREATE OR REPLACE preserves ACL; no re-revoke.

-- 5. approve_staff_registration: add two unconditional floor checks + technician-branch bank copy.
--    DEPENDENCY GATE: the body below is the LIVE definition (verified 2026-07-11). Re-pull to confirm
--    it is unchanged, then CREATE OR REPLACE with the two added floor blocks (after the consent check)
--    and the v_bank fetch + bank columns in the technician INSERT. Same 5-arg signature => ACL preserved.
create or replace function public.approve_staff_registration(
  p_id uuid, p_role user_role, p_project_id uuid default null,
  p_pay_type pay_type default 'monthly', p_employment_type employment_type default 'permanent')
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role public.user_role := public.current_user_role();
  v_reg        public.staff_registrations%rowtype;
  v_old_role   public.user_role;
  v_worker_id  uuid;
  v_name       text;
  v_bank       public.staff_registration_bank%rowtype;   -- ADDED
begin
  if v_actor_role is null
     or v_actor_role not in ('procurement_manager', 'project_director', 'super_admin') then
    raise exception 'approve_staff_registration: role not permitted' using errcode = '42501';
  end if;
  if p_role is null
     or p_role not in ('technician','procurement','procurement_manager','accounting','hr',
       'project_coordinator','site_admin','project_manager','project_director','site_owner',
       'subcon_manager','auditor','legal') then
    raise exception 'approve_staff_registration: role % is not assignable through staff onboarding',
      coalesce(p_role::text, 'null') using errcode = '42501';
  end if;
  select * into v_reg from public.staff_registrations where id = p_id;
  if not found then raise exception 'approve_staff_registration: registration not found' using errcode = 'P0001'; end if;
  if v_reg.status is distinct from 'pending' then raise exception 'approve_staff_registration: registration is not pending' using errcode = 'P0001'; end if;

  v_name := nullif(btrim(coalesce(v_reg.full_name, '')), '');
  if v_name is null then raise exception 'approve_staff_registration: full_name required before approval' using errcode = 'P0001'; end if;
  if not exists (
    select 1 from public.staff_registration_attachments a
     where a.registration_id = v_reg.id and a.purpose = 'id_card'
       and not exists (select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)) then
    raise exception 'approve_staff_registration: an id_card attachment is required before approval' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.staff_consents c
     where c.registration_id = v_reg.id and c.kind = 'pdpa_data' and c.revoked_at is null) then
    raise exception 'approve_staff_registration: a PDPA consent record is required before approval' using errcode = 'P0001';
  end if;
  -- ADDED: book_bank photo floor (live attachment).
  if not exists (
    select 1 from public.staff_registration_attachments a
     where a.registration_id = v_reg.id and a.purpose = 'book_bank'
       and not exists (select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)) then
    raise exception 'approve_staff_registration: a book_bank attachment is required before approval' using errcode = 'P0001';
  end if;
  -- ADDED: declared bank fields floor.
  select * into v_bank from public.staff_registration_bank where registration_id = v_reg.id;
  if not found
     or coalesce(btrim(v_bank.bank_name), '') = ''
     or coalesce(btrim(v_bank.bank_account_number), '') = ''
     or coalesce(btrim(v_bank.bank_account_name), '') = '' then
    raise exception 'approve_staff_registration: bank details are required before approval' using errcode = 'P0001';
  end if;

  update public.staff_registrations set status = 'approved', reviewed_by = v_actor, reviewed_at = now(), updated_at = now() where id = v_reg.id;
  select role into v_old_role from public.users where id = v_reg.user_id;
  update public.users set role = p_role, updated_at = now() where id = v_reg.user_id;
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (v_actor, v_actor_role, 'role_change', 'users', v_reg.user_id, jsonb_build_object('from', v_old_role, 'to', p_role));

  if p_role in ('technician') then
    -- ADDED defense-in-depth: re-assert account shape before it lands on the money-adjacent payee col.
    if v_bank.bank_account_number !~ '^[0-9]{6,20}$' then
      raise exception 'approve_staff_registration: stored bank account number is malformed' using errcode = 'P0001';
    end if;
    insert into public.workers
      (name, pay_type, employment_type, user_id, employee_id, active, created_by, project_id,
       phone, date_of_birth, emergency_contact_name, emergency_contact_relation, emergency_contact_phone,
       bank_name, bank_account_number, bank_account_name)                                   -- ADDED 3 cols
    values
      (v_name, p_pay_type, p_employment_type, v_reg.user_id, v_reg.employee_id, true, v_actor, p_project_id,
       v_reg.phone, v_reg.date_of_birth, v_reg.emergency_contact_name, v_reg.emergency_contact_relation, v_reg.emergency_contact_phone,
       v_bank.bank_name, v_bank.bank_account_number, v_bank.bank_account_name)              -- ADDED 3 vals
    returning id into v_worker_id;
    insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
    values (v_actor, v_actor_role, 'worker_change', 'workers', v_worker_id,
      jsonb_build_object('kind','create','source','staff_registration','registration_id',v_reg.id,'employee_id',v_reg.employee_id,'role',p_role));
  end if;
  return v_worker_id;
end; $$;
```

- [ ] **Step 5 — Storage RLS: add `book_bank` to both policies.** Append to the schema migration:

```sql
-- Both staff-doc policies gate on foldername[3] ∈ {id_card, profile_photo}; add book_bank.
-- DEPENDENCY GATE: pull the live policy bodies; recreate exactly with the extended array.
drop policy "staff doc uploads by applicant" on storage.objects;
create policy "staff doc uploads by applicant" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contact-docs'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[1] = 'technician'
    and (storage.foldername(name))[2] = (select auth.uid()::text)
    and (storage.foldername(name))[3] = any (array['id_card','profile_photo','book_bank']));
drop policy "staff doc reads by applicant" on storage.objects;
create policy "staff doc reads by applicant" on storage.objects for select to authenticated
  using (
    bucket_id = 'contact-docs'
    and array_length(storage.foldername(name), 1) = 3
    and (storage.foldername(name))[1] = 'technician'
    and (storage.foldername(name))[2] = (select auth.uid()::text)
    and (storage.foldername(name))[3] = any (array['id_card','profile_photo','book_bank']));
```

- [ ] **Step 6 — Push, regenerate types, run the test GREEN.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-bookbank" && export PATH="/c/Program Files/nodejs:$PATH" \
  && pnpm db:push && pnpm db:types && pnpm exec tsx scripts/run-pgtap.ts supabase/tests/database/296-book-bank-onboarding.sql
```

Expected: migrations apply; `296` all green. Then run the enum-pin test(s):

```bash
cd "D:/claude/projects/prc-ops/prc-ops-bookbank" && grep -rl "staff_doc_purpose" supabase/tests/database
```

Update any that pin the enum members to include `book_bank`; re-run the full suite:

```bash
cd "D:/claude/projects/prc-ops/prc-ops-bookbank" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:test
```

Expected: only known reds 200/221; zero collateral.

- [ ] **Step 7 — Commit.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-bookbank" && git add supabase/ src/lib/db/database.types.ts docs/feature-specs/296-* \
  && git commit -m "feat(onboarding): book-bank capture DB contract (spec 296 U1)

Zero-grant staff_registration_bank + record_own/get_own_staff_bank RPCs,
book_bank doc-purpose + storage RLS, approve floor + workers bank copy."
```

- [ ] **Step 8 — Fresh-eyes review + ship (operator-held).** Dispatch a reviewer subagent on the diff (RLS/grants, DEFINER guards, floor correctness, no anon exec). Then `scripts/ship-pr.sh`. **Do not self-merge — flag the operator (danger-path).**

---

## Task 2 (Unit U2) — Applicant capture _(code-only)_

**Files:**

- Modify: `src/lib/register/document-types.ts` (+`book_bank`, label)
- Modify: `src/lib/register/registration-floor.ts` (+2 requirements)
- Create: `src/lib/register/registration-bank.ts` (validation helper)
- Modify: `src/lib/register/actions.ts` (+`recordOwnStaffBank`)
- Modify: `src/lib/register/own-registration.ts` (expose declared bank via `get_own_staff_bank`)
- Modify: `src/components/features/register/staff-register-workspace.tsx` (`StaffRegistrationFormInitial` + `initial` wiring)
- Modify: `src/components/features/register/staff-registration-form.tsx` (required set, bank sub-block, floor, hint, PDPA copy)
- Test: `tests/unit/register/registration-floor.test.ts`, `tests/unit/register/registration-bank.test.ts`, `tests/unit/register/staff-registration-form.test.tsx` (match existing test locations — grep first)

**Interfaces consumed (from U1):** `record_own_staff_bank`, `get_own_staff_bank`, enum `book_bank`.
**Interfaces produced:** `ApprovalRequirement` adds `"book_bank" | "bank_fields"`; `recordOwnStaffBank({bankName, accountNumber, accountName}): Promise<ActionResult>`; `validateRegistrationBank(input): string | null`.

- [ ] **Step 1 — Failing test: floor view-model.** In `tests/unit/register/registration-floor.test.ts` add cases: missing `book_bank`/`bank_fields` appear in `missing`; `met` only when all five present.

```ts
expect(
  registrationApprovalFloor({
    fullName: "A",
    hasIdCard: true,
    hasBookBank: false,
    hasBankFields: true,
    hasConsent: true,
  }).missing,
).toContain("book_bank");
expect(
  registrationApprovalFloor({
    fullName: "A",
    hasIdCard: true,
    hasBookBank: true,
    hasBankFields: false,
    hasConsent: true,
  }).missing,
).toContain("bank_fields");
expect(
  registrationApprovalFloor({
    fullName: "A",
    hasIdCard: true,
    hasBookBank: true,
    hasBankFields: true,
    hasConsent: true,
  }).met,
).toBe(true);
```

- [ ] **Step 2 — Run, verify RED.** `pnpm test tests/unit/register/registration-floor.test.ts` → FAIL (type/behavior).
- [ ] **Step 3 — Extend the floor.** `registration-floor.ts`:

```ts
export type ApprovalRequirement = "full_name" | "id_card" | "book_bank" | "bank_fields" | "consent";
export interface ApprovalFloorInput {
  fullName: string | null;
  hasIdCard: boolean;
  hasBookBank: boolean;
  hasBankFields: boolean;
  hasConsent: boolean;
}
export function registrationApprovalFloor(input: ApprovalFloorInput): ApprovalFloor {
  const missing: ApprovalRequirement[] = [];
  if (!(input.fullName ?? "").trim()) missing.push("full_name");
  if (!input.hasIdCard) missing.push("id_card");
  if (!input.hasBookBank) missing.push("book_bank");
  if (!input.hasBankFields) missing.push("bank_fields");
  if (!input.hasConsent) missing.push("consent");
  return { met: missing.length === 0, missing };
}
```

- [ ] **Step 4 — Run GREEN.** `pnpm test tests/unit/register/registration-floor.test.ts` → PASS.
- [ ] **Step 5 — Failing test: bank validation helper.** `tests/unit/register/registration-bank.test.ts`: rejects empty; rejects `"12345"` (5) and `"12ab"`; accepts `"123456"` and 20 digits; accepts+implies-normalize `"123-456 789"`.
- [ ] **Step 6 — RED.** `pnpm test tests/unit/register/registration-bank.test.ts` → FAIL.
- [ ] **Step 7 — Implement helper.** `src/lib/register/registration-bank.ts`:

```ts
// UX pre-check ONLY — the DB RPC record_own_staff_bank is the authoritative gate.
export function normalizeAccountNumber(v: string): string {
  return v.replace(/[\s-]/g, "");
}
export function validateRegistrationBank(input: {
  bankName: string;
  accountNumber: string;
  accountName: string;
}): string | null {
  if (!input.bankName.trim()) return "กรุณาระบุธนาคาร";
  if (!input.accountName.trim()) return "กรุณาระบุชื่อบัญชี";
  const acct = normalizeAccountNumber(input.accountNumber);
  if (!/^[0-9]{6,20}$/.test(acct)) return "เลขบัญชีต้องเป็นตัวเลข 6-20 หลัก";
  return null;
}
```

- [ ] **Step 8 — GREEN.** `pnpm test tests/unit/register/registration-bank.test.ts` → PASS.
- [ ] **Step 9 — Add the client action.** `actions.ts` (model on `updateOwnStaffRegistration`):

```ts
export async function recordOwnStaffBank(input: {
  bankName: string;
  accountNumber: string;
  accountName: string;
}): Promise<ActionResult> {
  const v = validateRegistrationBank(input);
  if (v) return { ok: false, error: v };
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await auth.supabase.rpc("record_own_staff_bank", {
    p_bank_name: input.bankName.trim(),
    p_account_number: normalizeAccountNumber(input.accountNumber),
    p_account_name: input.accountName.trim(),
  });
  if (error) return { ok: false, error: registrationErrorToThai(error.message) };
  revalidatePath(REGISTER_PATH);
  return { ok: true };
}
```

- [ ] **Step 10 — Doc-purpose + label.** `document-types.ts`: add `"book_bank"` to `STAFF_DOC_PURPOSES` and `book_bank: "สมุดบัญชีธนาคาร"` to `STAFF_DOC_LABELS` (the total `Record` type forces this).
- [ ] **Step 11 — Thread bank into the form + prefill.** In `own-registration.ts` (or the `/register` page loader), call `get_own_staff_bank` and pass the 3 values; add them to `StaffRegistrationFormInitial` and the `initial={{…}}` object in `staff-register-workspace.tsx` (both branches, `?? ""`). In `staff-registration-form.tsx`: DocRow `required` set → `purpose === "id_card" || purpose === "book_bank"`; add a bank sub-block (3 `maxLength`-guarded inputs → `recordOwnStaffBank`); compute `hasBookBank = Boolean(docUrls.book_bank)` and `hasBankFields` from the 3 values (via `validateRegistrationBank(...) === null`); feed both into `registrationApprovalFloor`; extend the consent-hint copy to name book-bank + bank account; append `" รวมถึงข้อมูลบัญชีธนาคารเพื่อการจ่ายค่าจ้าง"` to the PDPA consent line.
- [ ] **Step 12 — Failing form test (RED) then GREEN.** RTL: the required checklist lists book-bank + bank; the bank inputs save via the action; a returning (prefilled) registration reports `hasBankFields` true. Run `pnpm test tests/unit/register/staff-registration-form.test.tsx`.
- [ ] **Step 13 — Full gate + real-flow verify.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-bookbank" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm lint && pnpm typecheck && pnpm test
```

Then dev-preview (`dev-preview-login` memory): on `/register/technician` confirm the required checklist, save+reload prefill, PDPA copy; repeat the checklist appears on `/register/office`. Zero console errors.

- [ ] **Step 14 — Commit + ship.** Commit `feat(onboarding): applicant book-bank capture (spec 296 U2)`. `scripts/ship-pr.sh` → code-only auto-merges on green.

---

## Task 3 (Unit U3) — Approver verification surface _(code; U3 touches the service-role client → confirm danger-path verdict, may be operator-held)_

**Files:**

- Modify: `src/lib/register/admin-registrations.ts` (+service-role fetch of `staff_registration_bank`)
- Modify: `src/app/registrations/[id]/page.tsx` (+3 bank `<Row>`s)
- Test: `tests/unit/register/admin-registrations.test.ts` (or the existing location), page/RTL test

**Interfaces consumed:** table `staff_registration_bank` (service-role read).
**Interfaces produced:** `getRegistrationBank(id): Promise<{ bankName; accountNumber; accountName } | null>`.

- [ ] **Step 1 — Failing test.** Assert `getRegistrationBank` returns the row's 3 fields via the admin client; returns `null` when absent. Assert the detail page renders 3 bank `<Row>`s when present, and the book-bank image slot.
- [ ] **Step 2 — RED.** Run the test → FAIL.
- [ ] **Step 3 — Service-role reader.** In `admin-registrations.ts`, add (using the existing `admin` client already imported for URL signing):

```ts
export async function getRegistrationBank(
  registrationId: string,
): Promise<{ bankName: string; accountNumber: string; accountName: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("staff_registration_bank")
    .select("bank_name, bank_account_number, bank_account_name")
    .eq("registration_id", registrationId)
    .maybeSingle();
  return data
    ? {
        bankName: data.bank_name,
        accountNumber: data.bank_account_number,
        accountName: data.bank_account_name,
      }
    : null;
}
```

(The page already gated `requireRole(STAFF_APPROVAL_ROLES)` + passed the RLS row read — the admin read only fetches the walled bank for a registration the approver is authorized to see.)

- [ ] **Step 4 — Render rows.** In `page.tsx`, fetch `getRegistrationBank(id)` alongside the existing reads; render three `<Row label value>` (`ธนาคาร`, `เลขที่บัญชี`, `ชื่อบัญชี`) in the `ข้อมูลผู้สมัคร` card. The book-bank photo already renders via `RegistrationDocumentsView`.
- [ ] **Step 5 — GREEN + gate.** `pnpm lint && pnpm typecheck && pnpm test`. Dev-preview as a `STAFF_APPROVAL_ROLES` user on a pending registration with book-bank submitted: passbook image + 3 bank rows render; approve as `technician` → live-query the new worker's `bank_*` equals declared; approve an office role → no worker, bank row remains.
- [ ] **Step 6 — Commit + ship.** Commit `feat(onboarding): approver book-bank verification (spec 296 U3)`. Ship; if the danger-path guard flags the service-role touch, hold for operator merge.

---

## Post-merge

- [ ] After U1 merges: refresh `../LANES.md` STATUS (new DB head), MOVE the lane block to `LANES.archive.md`, note the borrowed schema numbers.
- [ ] After all units merge: `git worktree remove ../prc-ops-bookbank` + delete the branch.
- [ ] Update `docs/progress-tracker.md` (one section per unit, status + date).
- [ ] Update memory `spec279-self-gov-onboarding` (or a new `spec296` pointer) + `MEMORY.md` index line.

## Self-review (author checklist — done)

- **Spec coverage:** zero-grant table (U1), owner RPCs + form prefill (U1/U2), book_bank photo + storage RLS (U1/U2), floor both layers (U1/U2), approve copy (U1), approver rows (U3), PDPA copy + validation authority + purpose-path hardening + SELECT-then-RAISE — all mapped to steps. ✓
- **Placeholders:** none — the two "pull live body" steps (add_staff_registration_doc, and re-confirming approve) are dependency-gate reconciliations, not placeholders; the approve body is written in full. ✓
- **Type consistency:** `record_own_staff_bank`/`get_own_staff_bank`/`recordOwnStaffBank`/`getRegistrationBank`/`validateRegistrationBank`/`ApprovalRequirement` names consistent across tasks. ✓
