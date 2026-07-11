# SA-assisted onboarding (capture-blind bank) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Also load the repo `ship-unit` skill for every unit** — it carries the binding gates (lane claim, dependency gate-check, RED-first, real-flow verify, fresh-eyes review, proved merge).

**Goal:** Let a site_admin onboard a phoneless technician completely — identity **plus** a required passbook photo captured into a store the app never lets the SA read back — so a money-authorized approver (PM) can transcribe the bank into `workers.bank_*` and the worker stops reaching payroll with no account on file.

**Architecture:** The no-phone add wraps the existing `sa_add_project_worker` (spec 279 U4) in a new atomic DEFINER RPC that also records a `worker_bank_capture` row (zero-grant, mirrors 296's `staff_registration_bank` wall). The passbook photo lives in a new **`sa-bank-capture/`** folder in the `contact-docs` bucket with an INSERT-only-for-site_admin / no-authenticated-SELECT policy — the SA writes blind; a PM reads via the service-role admin client and keys the fields through a money-set-gated `complete_worker_bank` RPC. The SA UI is reshaped: `/sa/crew` body becomes existing-member management only, and all "add a technician" affordances move behind one **"เพิ่มช่างใหม่"** button → an onboarding sheet that branches มีมือถือ (relocated QR + coaching) / ไม่มีมือถือ (capture-blind add).

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + RLS + Storage, pgTAP, Vitest/RTL, TypeScript strict.

## Global Constraints (verbatim from spec 298 + CLAUDE.md)

- **Spec:** `docs/feature-specs/298-sa-assisted-onboarding.md`. Implement exactly it; no scope creep.
- **TDD, RED-first:** the first change in each unit is the failing test, seen to fail, before implementation.
- **Schema is single-lane.** Claim the lane in `../LANES.md` before any `supabase/migrations/` write (hook-enforced). **`deliveryrls` currently holds `075710`.** Do **not** hardcode a number — at U1 start read the `../LANES.md` STATUS line and take the live next-free number (≥ `075720`). The migration filename below uses `075720` as a placeholder; rename to the live number.
- **Every table has RLS enabled.** New table = RLS on. Bank/money columns stay off `authenticated` grants (zero-grant).
- **Status fields are Postgres enums.** New enum `worker_bank_capture_status`; adding it trips any enum-pin guards deliberately.
- **The SA must never read bank.** `worker_bank_capture` is zero-grant; the `sa-bank-capture/` storage folder has no authenticated SELECT policy. The SA roster reads status only, via a DEFINER projection. Verify both in pgTAP.
- **Money-governance (ADR 0079):** the SA sets no pay/level (the worker stays `day_rate 0 / level null / cost_confirmed_at null`, unchanged). `complete_worker_bank` writes ONLY the three `bank_*` columns — never `day_rate`/`level`/`cost_confirmed_at`.
- **Account-number rule (single source = the DB RPC):** non-empty; after stripping spaces/dashes matches `^[0-9]{6,20}$`; **store the normalized digits**. The client helper is a UX pre-check mirroring this. `maxLength`: bank_name 80, account_name 120, account_number 30.
- **Ship via `scripts/ship-pr.sh`** (branch → PR → auto-merge on green). **U1 is danger-path → operator-held** (migration + new table + RLS/grants + Storage policy + payroll-adjacent `workers.bank` write). Do NOT self-merge U1. U3 touches the service-role client + a money write path → confirm the danger-path guard verdict; likely operator-held.
- **Machine quirks:** `cd` in every Bash command; prefix `/c/Program Files/nodejs` to PATH for node/pnpm; Thai text only via Write/Edit (never PowerShell); live DB query = `pnpm exec supabase db query --linked` (stdin heredoc).
- **Known pgTAP reds:** 200/221 ONLY — any other red is collateral to fix.

---

## Pre-flight (once, before Task 1)

The worktree already exists — `../prc-ops-298` on branch `spec298-sa-assisted-onboarding` (off 0.22.0), lane claimed in `../LANES.md`, and the spec + this plan are already in it. Remaining:

- [ ] **Gate the schema lane.** Read `../LANES.md` whole. Proceed to U1 only once `deliveryrls` has merged and the schema lane is FREE (or explicitly coordinated). Take the live next-free schema number (≥ `075720`) and update the migration filename + the LANES claim.
- [ ] **Install deps in the worktree** (fresh worktree needs them):

```bash
cd "D:/claude/projects/prc-ops/prc-ops-298" && cp ../prc-ops/.env.local . 2>/dev/null; export PATH="/c/Program Files/nodejs:$PATH" && pnpm install
```

- [ ] **Dependency gate-check (U1 substrate).** Confirm the live forms are unchanged before building on them:

```bash
cd "D:/claude/projects/prc-ops/prc-ops-298" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm exec supabase db query --linked <<'SQL'
select pg_get_functiondef('public.sa_add_project_worker(uuid,text,text,date)'::regprocedure);
select proname from pg_proc where proname in ('can_see_project','current_user_role','is_valid_thai_national_id');
select policyname, cmd, roles::text from pg_policies where tablename = 'objects' and schemaname = 'storage' and qual ~ 'contact-docs' or with_check ~ 'contact-docs';
SQL
```

Confirm: `sa_add_project_worker` body matches the spec's "what exists" (identity insert, `day_rate 0`, phoneless); the three helpers exist; **no** existing authenticated SELECT policy matches `foldername[1]='sa-bank-capture'` (only `technician/…` policies exist). Mismatch → stop and re-plan.

---

## Task 1 (Unit U1) — Schema & DB contract _(danger-path, operator-held)_

**Files:**

- Create: `supabase/migrations/20260813075720_spec298u1_sa_bank_capture.sql` _(rename to the live schema number)_
- Create: `supabase/tests/database/298-sa-bank-capture.sql`
- Modify: any enum-pin pgTAP that enumerates public enum types (grep in Step 6)
- Modify: `src/lib/db/database.types.ts` (regenerated, not hand-edited)

**Interfaces produced (later units rely on these exact names):**

- Enum `public.worker_bank_capture_status = ('pending_pm','on_file')`.
- Table `public.worker_bank_capture(worker_id uuid PK→workers, photo_path text, status worker_bank_capture_status, captured_by uuid, captured_at timestamptz, completed_by uuid, completed_at timestamptz)` — zero-grant.
- RPC `sa_add_project_worker_with_bank(p_project uuid, p_name text, p_national_id text, p_dob date, p_photo_path text) returns uuid`.
- RPC `sa_worker_bank_status(p_project uuid) returns table(worker_id uuid, status worker_bank_capture_status)`.
- RPC `complete_worker_bank(p_worker_id uuid, p_bank_name text, p_account_number text, p_account_name text) returns void`.
- Storage folder `contact-docs/sa-bank-capture/…` — site_admin INSERT, no authenticated SELECT.

- [ ] **Step 1 — Write the failing pgTAP test.** Create `supabase/tests/database/298-sa-bank-capture.sql`. Standard form (`begin; select plan(N); … select * from finish(); rollback;`). Seed a project + a site_admin member + a money-role actor (reuse the seeding idiom in `supabase/tests/database/281-sa-add-project-worker.sql`). Cover, at minimum:

```sql
-- 1) zero-grant: as role authenticated (a site_admin), a direct SELECT on worker_bank_capture throws 42501.
select throws_ok($$ set local role authenticated; select * from public.worker_bank_capture $$, '42501');
-- 2) sa_add_project_worker_with_bank as the site_admin on their project with a 'sa-bank-capture/2026/x.jpg'
--    path creates a workers row (day_rate 0, user_id null) AND a worker_bank_capture row status 'pending_pm'.
-- 3) same RPC with a photo path NOT under 'sa-bank-capture/' (e.g. 'technician/…') -> P0001, no worker created.
-- 4) same RPC as a non-site_admin (e.g. authenticated w/ role technician) -> 42501.
-- 5) duplicate national-id (already on a worker) -> P0001, and NO orphan worker/capture remains (count unchanged).
-- 6) sa_worker_bank_status(project) as the site_admin returns (worker_id, status) only — assert the column set
--    is exactly {worker_id, status} and the pending worker appears; as a non-member SA -> 42501.
-- 7) complete_worker_bank as a site_admin -> 42501 (not money-authorized).
-- 8) complete_worker_bank as procurement_manager on the pending worker: writes workers.bank_* (normalized),
--    flips status -> 'on_file', sets completed_by/at; and leaves day_rate = 0 (assert unchanged).
-- 9) complete_worker_bank account '12ab'/'12345' -> P0001; '123-456 789' persists as '123456789'.
-- 10) complete_worker_bank on a worker with no pending capture (none, or already on_file) -> P0001.
```

Write concrete assertions for each (`throws_ok`, `results_eq`, `is`, `bag_eq` for the column set).

- [ ] **Step 2 — Run it, verify RED.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-298" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm exec tsx scripts/run-pgtap.ts supabase/tests/database/298-sa-bank-capture.sql
```

Expected: FAIL (objects don't exist).

- [ ] **Step 3 — Write the migration.** `supabase/migrations/20260813075720_spec298u1_sa_bank_capture.sql` (one file — a new `create type` enum is same-transaction-safe with the table that uses it):

```sql
-- Spec 298 U1 — SA-assisted onboarding: capture-blind bank for phoneless workers.
-- Walled capture store policy + worker_bank_capture (zero-grant) + status enum +
-- DEFINER RPCs: add-with-capture (SA), status projection (SA), PM-complete (money set).

-- 1. Status enum.
create type public.worker_bank_capture_status as enum ('pending_pm', 'on_file');

-- 2. Zero-grant capture table (mirror the staff_registration_bank wall).
create table public.worker_bank_capture (
  worker_id     uuid primary key references public.workers(id) on delete cascade,
  photo_path    text not null,
  status        public.worker_bank_capture_status not null default 'pending_pm',
  captured_by   uuid not null,
  captured_at   timestamptz not null default now(),
  completed_by  uuid,
  completed_at  timestamptz
);
alter table public.worker_bank_capture enable row level security;
revoke all on public.worker_bank_capture from anon, authenticated;
grant select, insert, update, delete on public.worker_bank_capture to service_role;
-- No authenticated policy => deny by default. SA status reads go through the DEFINER
-- projection (sa_worker_bank_status); PM reads via the service-role admin client (U3).

-- 3. Walled Storage policy: site_admin/super may INSERT into sa-bank-capture/…; NO authenticated
--    SELECT policy matches that folder => unreadable to the uploader. (DEPENDENCY GATE, pre-flight:
--    confirm no existing authenticated SELECT policy on storage.objects matches this folder.)
create policy "sa bank-capture uploads by site_admin" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contact-docs'
    and (storage.foldername(name))[1] = 'sa-bank-capture'
    and public.current_user_role() in ('site_admin','super_admin'));

-- 4. Add-with-capture (SA path). Models sa_add_project_worker (spec279u4) + the capture insert, atomic.
create function public.sa_add_project_worker_with_bank(
  p_project uuid, p_name text, p_national_id text, p_dob date, p_photo_path text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_name   text := nullif(btrim(coalesce(p_name, '')), '');
  v_yy     int  := (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int;
  v_seq    int;
  v_emp    text;
  v_worker uuid;
begin
  if v_role is null or v_role not in ('site_admin','super_admin') then
    raise exception 'sa_add_project_worker_with_bank: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'sa_add_project_worker_with_bank: not a member of this project' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'sa_add_project_worker_with_bank: name required' using errcode = 'P0001';
  end if;
  if not public.is_valid_thai_national_id(p_national_id) then
    raise exception 'sa_add_project_worker_with_bank: invalid Thai national-ID' using errcode = 'P0001';
  end if;
  if p_dob is null or p_dob > (((now() at time zone 'Asia/Bangkok')::date) - interval '18 years') then
    raise exception 'sa_add_project_worker_with_bank: worker must be at least 18' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_photo_path), '') = ''
     or split_part(p_photo_path, '/', 1) is distinct from 'sa-bank-capture' then
    raise exception 'sa_add_project_worker_with_bank: a passbook photo is required' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.workers w where w.tax_id = p_national_id) then
    raise exception 'sa_add_project_worker_with_bank: this national-ID is already on a worker' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.crew_registrations r where r.national_id = p_national_id and r.status = 'pending') then
    raise exception 'sa_add_project_worker_with_bank: this national-ID is already a pending registration' using errcode = 'P0001';
  end if;

  insert into public.employee_id_counters (year, next_val) values (v_yy, 2)
  on conflict (year) do update set next_val = public.employee_id_counters.next_val + 1
  returning next_val - 1 into v_seq;
  v_emp := 'PRC-' || lpad(v_yy::text, 2, '0') || '-' || lpad(v_seq::text, 4, '0');

  insert into public.workers (name, pay_type, employment_type, user_id, employee_id, day_rate,
                              active, created_by, project_id, tax_id, date_of_birth)
  values (v_name, 'daily', 'temporary', null, v_emp, 0,
          true, auth.uid(), p_project, p_national_id, p_dob)
  returning id into v_worker;

  insert into public.worker_bank_capture (worker_id, photo_path, status, captured_by)
  values (v_worker, p_photo_path, 'pending_pm', auth.uid());

  insert into public.worker_project_moves (worker_id, project_id, moved_by, reason)
  values (v_worker, p_project, auth.uid(), 'sa direct add (capture-blind bank)');

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers', v_worker,
          jsonb_build_object('kind','create','source','sa_add_with_bank','project_id',p_project,'employee_id',v_emp));
  return v_worker;
end; $$;
revoke all on function public.sa_add_project_worker_with_bank(uuid, text, text, date, text) from public;
revoke execute on function public.sa_add_project_worker_with_bank(uuid, text, text, date, text) from anon;
grant execute on function public.sa_add_project_worker_with_bank(uuid, text, text, date, text) to authenticated;

-- 5. Status projection (SA roster chip) — status only, no photo_path.
create function public.sa_worker_bank_status(p_project uuid)
returns table(worker_id uuid, status public.worker_bank_capture_status)
language plpgsql security definer set search_path = public as $$
declare v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role not in ('site_admin','super_admin') then
    raise exception 'sa_worker_bank_status: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'sa_worker_bank_status: not a member of this project' using errcode = '42501';
  end if;
  return query
    select c.worker_id, c.status
    from public.worker_bank_capture c
    join public.workers w on w.id = c.worker_id
    where w.project_id = p_project;
end; $$;
revoke all on function public.sa_worker_bank_status(uuid) from public;
revoke execute on function public.sa_worker_bank_status(uuid) from anon;
grant execute on function public.sa_worker_bank_status(uuid) to authenticated;

-- 6. PM completion (money set) — transcribe photo -> workers.bank_*; flip status. Never touches pay/level.
create function public.complete_worker_bank(
  p_worker_id uuid, p_bank_name text, p_account_number text, p_account_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role      public.user_role := public.current_user_role();
  v_name      text := btrim(coalesce(p_bank_name, ''));
  v_acct_name text := btrim(coalesce(p_account_name, ''));
  v_acct      text := regexp_replace(coalesce(p_account_number, ''), '[[:space:]-]', '', 'g');
  v_cap       public.worker_bank_capture%rowtype;
begin
  if v_role is null or v_role not in ('procurement_manager','project_director','super_admin') then
    raise exception 'complete_worker_bank: role not permitted' using errcode = '42501';
  end if;
  select * into v_cap from public.worker_bank_capture where worker_id = p_worker_id;
  if not found or v_cap.status is distinct from 'pending_pm' then
    raise exception 'complete_worker_bank: no pending bank capture for this worker' using errcode = 'P0001';
  end if;
  if v_name = '' or v_acct_name = '' or v_acct = '' then
    raise exception 'complete_worker_bank: bank name, account number and account name are required' using errcode = 'P0001';
  end if;
  if v_acct !~ '^[0-9]{6,20}$' then
    raise exception 'complete_worker_bank: account number must be 6-20 digits' using errcode = 'P0001';
  end if;
  update public.workers
     set bank_name = v_name, bank_account_number = v_acct, bank_account_name = v_acct_name
   where id = p_worker_id;
  update public.worker_bank_capture
     set status = 'on_file', completed_by = auth.uid(), completed_at = now()
   where worker_id = p_worker_id;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'workers', p_worker_id,
          jsonb_build_object('kind','bank_set','source','sa_capture_pm_complete'));
end; $$;
revoke all on function public.complete_worker_bank(uuid, text, text, text) from public;
revoke execute on function public.complete_worker_bank(uuid, text, text, text) from anon;
grant execute on function public.complete_worker_bank(uuid, text, text, text) to authenticated;
```

- [ ] **Step 4 — Push, regenerate types.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-298" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:push && pnpm db:types
```

- [ ] **Step 5 — Run the 298 test GREEN.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-298" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm exec tsx scripts/run-pgtap.ts supabase/tests/database/298-sa-bank-capture.sql
```

Expected: `298` all green.

- [ ] **Step 6 — Enum-pin + full suite.** Grep any pgTAP that enumerates public enum types; add `worker_bank_capture_status` where required:

```bash
cd "D:/claude/projects/prc-ops/prc-ops-298" && grep -rln "enum" supabase/tests/database | head; grep -rln "pg_type" supabase/tests/database
```

Then the full suite:

```bash
cd "D:/claude/projects/prc-ops/prc-ops-298" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:test
```

Expected: only known reds 200/221; zero collateral.

- [ ] **Step 7 — Commit.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-298" && git add supabase/ src/lib/db/database.types.ts docs/feature-specs/298-* \
  && git commit -m "feat(onboarding): capture-blind bank DB contract (spec 298 U1)

Zero-grant worker_bank_capture + status enum, walled sa-bank-capture storage
policy, DEFINER sa_add_project_worker_with_bank / sa_worker_bank_status /
complete_worker_bank (money-set gated, pay/level untouched)."
```

- [ ] **Step 8 — Fresh-eyes review + ship (operator-held).** Dispatch a reviewer subagent on the diff (RLS/grants, DEFINER role gates, no anon exec, storage policy has no read arm, complete_worker_bank never writes pay/level, atomicity of add+capture). Then `scripts/ship-pr.sh`. **Do not self-merge — flag the operator (danger-path).**

---

## Task 2 (Unit U2) — SA onboarding front door _(code-only; confirm guard verdict — upload path + new action)_

**Files:**

- Modify: `src/app/sa/crew/page.tsx` (remove the inline `AddWorkerForm` + QR cards from the body; render the new button + sheet; fetch `sa_worker_bank_status` per project → pending-worker Set → thread into the roster for the chip; pass `qrCards` + `projectList` as props to the sheet)
- Create: `src/components/features/sa/add-technician-sheet.tsx` (client — the front door: branch toggle มีมือถือ/ไม่มีมือถือ; has-phone renders the passed `qrCards` + coaching copy; no-phone renders the capture form)
- Modify: `src/components/features/sa/add-worker-form.tsx` (absorb as the no-phone branch body; add the **required passbook-photo** capture → browser-client upload to `sa-bank-capture/…` → pass `photoPath` to the action; keep identity fields)
- Modify: `src/app/sa/crew/actions.ts` (add `addProjectWorkerWithBank({projectId,name,nationalId,dob,photoPath})` → `sa_add_project_worker_with_bank`)
- Create: `src/lib/sa/sa-bank-capture-path.ts` (path builder helper)
- Modify: `src/components/features/sa/crew-progress-roster.tsx` (optional `bankPending` flag on a member → "รอ PM กรอก" chip)
- Modify: `src/lib/i18n/labels.ts` (add-button / branch / chip labels)
- Test: `tests/unit/sa/add-technician-sheet.test.tsx`, `tests/unit/sa/crew-actions.test.ts` (match existing SA test locations — grep first)

**Interfaces consumed (from U1):** `sa_add_project_worker_with_bank`, `sa_worker_bank_status`.
**Interfaces produced:** `addProjectWorkerWithBank(input): Promise<ActionResult<{workerId:string}>>`; `saBankCapturePath(ext:string): string`.

- [ ] **Step 1 — Dependency gate-check.** Read the live `src/components/features/sa/add-worker-form.tsx` + `src/app/sa/crew/actions.ts` (`addProjectWorker`) + `crew-progress-roster.tsx` at HEAD. Confirm the `ActionResult` shape, the existing form field names/props, and how a member renders in the roster. Note the browser Supabase client import used elsewhere in SA client components (for the storage upload).

- [ ] **Step 2 — Failing test: the action.** In `tests/unit/sa/crew-actions.test.ts`, assert `addProjectWorkerWithBank` calls `sa_add_project_worker_with_bank` with the mapped params and returns `{ok:true, workerId}`; on RPC error returns `{ok:false, error}` (Thai). Mock the server client.

- [ ] **Step 3 — RED.** `pnpm test tests/unit/sa/crew-actions.test.ts` → FAIL.

- [ ] **Step 4 — Path helper + action.** Create `src/lib/sa/sa-bank-capture-path.ts`:

```ts
// Walled capture object key. No worker id (the worker doesn't exist at upload time) and
// no PII in the path — the RPC binds this path to the created worker's capture row.
export function saBankCapturePath(ext: string): string {
  const year = new Date().getUTCFullYear();
  const id = crypto.randomUUID();
  const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : "jpg";
  return `sa-bank-capture/${year}/${id}.${safeExt}`;
}
```

Then add to `src/app/sa/crew/actions.ts` (model on the live `addProjectWorker`; the photo is uploaded client-side, so the action only records the returned path):

```ts
export async function addProjectWorkerWithBank(input: {
  projectId: string;
  name: string;
  nationalId: string;
  dob: string;
  photoPath: string;
}): Promise<ActionResult<{ workerId: string }>> {
  const ctx = await requireRole(["site_admin", "super_admin"]); // match the live guard in this file
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sa_add_project_worker_with_bank", {
    p_project: input.projectId,
    p_name: input.name,
    p_national_id: input.nationalId,
    p_dob: input.dob,
    p_photo_path: input.photoPath,
  });
  if (error) return { ok: false, error: saErrorToThai(error.message) }; // reuse this file's error mapper
  revalidatePath("/sa/crew");
  return { ok: true, workerId: data as string };
}
```

(Match the exact guard + error-mapper names already used by `addProjectWorker` in this file — the gate-check in Step 1 gives them.)

- [ ] **Step 5 — GREEN.** `pnpm test tests/unit/sa/crew-actions.test.ts` → PASS.

- [ ] **Step 6 — Labels.** In `src/lib/i18n/labels.ts` add (SSOT — one home): `ADD_TECHNICIAN_LABEL = "เพิ่มช่างใหม่"`, `HAS_PHONE_LABEL = "มีมือถือ"`, `NO_PHONE_LABEL = "ไม่มีมือถือ"`, `BANK_PENDING_CHIP_LABEL = "บัญชี: รอ PM กรอก"`, `PASSBOOK_PHOTO_LABEL = "รูปสมุดบัญชี"`, plus the coaching-copy for the has-phone branch (short: "ให้ช่างสแกน QR ด้วยมือถือของตัวเอง แล้วกรอกข้อมูล+บัญชีเอง").

- [ ] **Step 7 — Failing test: the sheet.** `tests/unit/sa/add-technician-sheet.test.tsx` (RTL): the sheet renders both branch options; selecting มีมือถือ shows the QR + coaching (given `qrCards` prop); selecting ไม่มีมือถือ shows the identity fields + a required photo input, and **submit is disabled until a photo is attached**; **no bank field is ever rendered**.

- [ ] **Step 8 — RED.** `pnpm test tests/unit/sa/add-technician-sheet.test.tsx` → FAIL.

- [ ] **Step 9 — Build the sheet + no-phone capture.** Create `src/components/features/sa/add-technician-sheet.tsx` (client). Skeleton:

```tsx
"use client";
// The single "เพิ่มช่างใหม่" front door. Branches on whether the ช่าง has a phone.
// has-phone: render the project's existing QR (passed from the server page) + coaching.
// no-phone: the capture-blind add — identity + a REQUIRED passbook photo. The photo is
// uploaded to the walled sa-bank-capture/ path via the browser client; only the path
// reaches the server action. The SA never sees a bank field or reads the photo back.
import { useState } from "react";
import { createClient } from "@/lib/db/browser";
import { saBankCapturePath } from "@/lib/sa/sa-bank-capture-path";
import { addProjectWorkerWithBank } from "@/app/sa/crew/actions";
// ... Sheet/Button/inputs from src/components/ui + labels from @/lib/i18n/labels

// Props: { projects: {id,code,name}[]; qrCards: {project,url,svg}[] }
// no-phone submit handler:
//   1) const path = saBankCapturePath(fileExt);
//   2) const supabase = createClient();
//      await supabase.storage.from("contact-docs").upload(path, file, { upsert: false });
//   3) const res = await addProjectWorkerWithBank({ projectId, name, nationalId, dob, photoPath: path });
//   4) on ok -> close sheet + refresh; on error -> show res.error.
```

Move the identity fields + validation from `add-worker-form.tsx` into the no-phone branch (extend with the required photo input); render the passed `qrCards` (the same `dangerouslySetInnerHTML` SVG block as today) + coaching under has-phone.

- [ ] **Step 10 — Reshape the crew page.** In `src/app/sa/crew/page.tsx`: delete the inline `<AddWorkerForm>` (line ~250) and the QR `.map()` block (lines ~254–276) from the body; keep `CrewProgressRoster` + `SiteTeamBoard`. Render `<AddTechnicianSheet projects={projectList} qrCards={qrCards} />` (a button that opens the sheet) in the header/top of the section. Add the bank-status fetch + chip wiring:

```ts
// after projectIds resolve — pending-bank worker ids across the SA's projects (status only).
const bankStatuses = await Promise.all(
  projectIds.map((pid) => supabase.rpc("sa_worker_bank_status", { p_project: pid })),
);
const bankPending = new Set<string>();
for (const res of bankStatuses)
  for (const row of res.data ?? []) if (row.status === "pending_pm") bankPending.add(row.worker_id);
// thread bankPending into toMember(): set member.bankPending = bankPending.has(w.id)
```

- [ ] **Step 11 — Roster chip.** In `crew-progress-roster.tsx`, add optional `bankPending?: boolean` to `CrewProgressMember`; when true, render a plain `BANK_PENDING_CHIP_LABEL` chip beside the member name (use the existing chip/badge style in that component — gate-checked in Step 1).

- [ ] **Step 12 — GREEN.** `pnpm test tests/unit/sa/add-technician-sheet.test.tsx` → PASS.

- [ ] **Step 13 — Full gate + real-flow verify.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-298" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm lint && pnpm typecheck && pnpm test
```

Then dev-preview (`dev-preview-login` memory) as a site_admin on `/sa/crew`: the body shows only the roster + team board; the **"เพิ่มช่างใหม่"** button opens the sheet; มีมือถือ shows the project QR + coaching; ไม่มีมือถือ requires a photo, and adding creates the worker + the "รอ PM กรอก" chip; **no bank field/photo is shown to the SA**; zero console errors. (Confirm the upload lands in `sa-bank-capture/` and the SA session cannot GET it back.)

- [ ] **Step 14 — Commit + ship.** Commit `feat(onboarding): SA add-technician front door + capture-blind add (spec 298 U2)`. `scripts/ship-pr.sh`. If the guard flags the upload/action, hold for operator; else code-only auto-merges on green.

---

## Task 3 (Unit U3) — PM completion queue _(code; service-role read + money write → confirm guard verdict, likely operator-held)_

**Files:**

- Create: `src/lib/register/worker-bank-queue.ts` (service-role reader: list pending captures + sign photo URLs)
- Create: `src/app/registrations/awaiting-bank/page.tsx` (server; `requireRole(STAFF_APPROVAL_ROLES)`) _(confirm the route parent + role-home entry at build)_
- Create: `src/app/registrations/awaiting-bank/actions.ts` (`completeWorkerBank` → RPC)
- Create: `src/components/features/register/worker-bank-complete-form.tsx` (client — photo + 3 inputs)
- Modify: `src/lib/auth/role-home.ts` (route entry if a nav link is added)
- Modify: `src/lib/i18n/labels.ts` (queue labels: `AWAITING_BANK_TITLE = "ช่างรอกรอกบัญชี"`, field labels ธนาคาร/เลขที่บัญชี/ชื่อบัญชี already exist — reuse)
- Test: `tests/unit/register/worker-bank-queue.test.ts`, `tests/unit/register/worker-bank-complete-form.test.tsx`

**Interfaces consumed (from U1):** table `worker_bank_capture` (service-role read), RPC `complete_worker_bank`.
**Interfaces produced:** `listWorkersAwaitingBank(): Promise<{workerId; name; employeeId; projectId; photoUrl}[]>`; `completeWorkerBank(input): Promise<ActionResult>`.

- [ ] **Step 1 — Failing test: the reader.** `tests/unit/register/worker-bank-queue.test.ts`: `listWorkersAwaitingBank` returns pending workers joined to name/employee_id + a signed photo URL via the admin client; excludes `on_file`. Mock the admin client.

- [ ] **Step 2 — RED.** Run → FAIL.

- [ ] **Step 3 — Service-role reader.** `src/lib/register/worker-bank-queue.ts` (model the admin-client usage on 296's `admin-registration-bank.ts`):

```ts
import "server-only";
import { createClient as createAdminClient } from "@/lib/db/admin";

export interface AwaitingBankRow {
  workerId: string;
  name: string;
  employeeId: string | null;
  projectId: string | null;
  photoUrl: string | null;
}

export async function listWorkersAwaitingBank(): Promise<AwaitingBankRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("worker_bank_capture")
    .select("worker_id, photo_path, status, workers(name, employee_id, project_id)")
    .eq("status", "pending_pm");
  const rows = data ?? [];
  return Promise.all(
    rows.map(async (r) => {
      const { data: signed } = await admin.storage
        .from("contact-docs")
        .createSignedUrl(r.photo_path, 60 * 10);
      const w = Array.isArray(r.workers) ? r.workers[0] : r.workers;
      return {
        workerId: r.worker_id,
        name: w?.name ?? "",
        employeeId: w?.employee_id ?? null,
        projectId: w?.project_id ?? null,
        photoUrl: signed?.signedUrl ?? null,
      };
    }),
  );
}
```

- [ ] **Step 4 — GREEN.** Run → PASS.

- [ ] **Step 5 — Action.** `src/app/registrations/awaiting-bank/actions.ts`:

```ts
"use server";
export async function completeWorkerBank(input: {
  workerId: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}): Promise<ActionResult> {
  await requireRole(STAFF_APPROVAL_ROLES);
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_worker_bank", {
    p_worker_id: input.workerId,
    p_bank_name: input.bankName.trim(),
    p_account_number: input.accountNumber, // RPC normalizes
    p_account_name: input.accountName.trim(),
  });
  if (error) return { ok: false, error: /* reuse a Thai error mapper */ error.message };
  revalidatePath("/registrations/awaiting-bank");
  return { ok: true };
}
```

- [ ] **Step 6 — Failing test: the form + page.** RTL: the form shows the passbook image + 3 inputs; save calls `completeWorkerBank`; the row disappears on success. A non-approver role sees no such page (route gate).

- [ ] **Step 7 — RED.** Run → FAIL.

- [ ] **Step 8 — Page + form.** Build `page.tsx` (server: `requireRole(STAFF_APPROVAL_ROLES)` → `listWorkersAwaitingBank()` → render one `WorkerBankCompleteForm` per row) and the client `worker-bank-complete-form.tsx` (an `<img src={photoUrl}>` beside 3 `maxLength`-guarded inputs → `completeWorkerBank`; on ok, refresh). Reuse the `<Row>`/verify layout idiom from `/registrations/[id]`.

- [ ] **Step 9 — GREEN + full gate + real-flow verify.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-298" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm lint && pnpm typecheck && pnpm test
```

Dev-preview as a `STAFF_APPROVAL_ROLES` actor (e.g. procurement_manager) at `/registrations/awaiting-bank`: the pending worker + passbook image + 3 inputs render; saving live-writes the worker's `bank_*` (query it) and removes the row; the `/sa/crew` chip flips to "มีแล้ว"; a `site_admin` session gets no page. Zero console errors.

- [ ] **Step 10 — Commit + ship.** Commit `feat(onboarding): PM bank-completion queue (spec 298 U3)`. Ship; if the guard flags the service-role + money touch, hold for operator merge.

---

## Post-merge

- [ ] After U1 merges: refresh `../LANES.md` STATUS (new DB head = the claimed number), MOVE the lane block to `LANES.archive.md`.
- [ ] After all units merge: `git worktree remove ../prc-ops-298` + delete the branch; clean the dead locked `prc-ops-297` husk (`rm -rf` once Windows releases it).
- [ ] Update `docs/progress-tracker.md` (one section per unit, status + date).
- [ ] Update memory `spec279-self-gov-onboarding` (or a new `spec298` pointer) + the `MEMORY.md` index line; note the has-phone coaching feeds spec 299.

## Self-review (author checklist — done)

- **Spec coverage:** walled store + zero-grant table + status enum (U1 §1–3, §5); add-with-capture atomic + required photo (U1 §4, U2); status projection + roster chip (U1 §5, U2 §10–11); PM transcribe + RAISE-on-non-pending + pay/level untouched (U1 §6); front-door reshape absorbing QR + add-form (U2 §9–10); PM queue with service-role signed photo (U3) — all mapped to steps. ✓
- **Placeholders:** none — the two "match the live guard/error-mapper name" notes are dependency-gate reconciliations (the exact names come from the Step-1 gate-check), not missing logic; all SQL + helper/action code is written in full. ✓
- **Type consistency:** `sa_add_project_worker_with_bank` / `sa_worker_bank_status` / `complete_worker_bank` / `worker_bank_capture` / `pending_pm`|`on_file` / `addProjectWorkerWithBank` / `saBankCapturePath` / `listWorkersAwaitingBank` / `completeWorkerBank` names consistent across U1→U2→U3. ✓
- **Money-gov:** `complete_worker_bank` writes only `bank_*`; `day_rate`/`level`/`cost_confirmed_at` never touched (U1 §6 + asserted in pgTAP Step 1 case 8). ✓
</content>
