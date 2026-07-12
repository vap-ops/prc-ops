# Office Expenses (spec 310) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In THIS repo, each unit ships through the **`ship-unit`** skill (claim lane → gate-check deps LIVE → TDD RED-first → browser-verify → fresh-review → `scripts/ship-pr.sh` → release lane → report).

**Goal:** Let office/HQ users record expenses that are NOT tied to a work package (optionally under a project), state the payment source, have the system resolve who gets reimbursed, and let finance mark each reimbursed — plus a superadmin registry of company credit cards.

**Architecture:** Three new tables (`company_cards`, `office_expense_categories`, `office_expenses`) + an `office_expense_attachments` table + a `payment_source` enum, all writes through SECURITY DEFINER RPCs (house style — no direct table grants to `authenticated`). Reimburse-target is resolved server-side in the RPC from the payment source, never trusted from the client. Two surfaces: `/expenses` (office roles: form + list + reimburse queue) and `/settings/cards` (super_admin: card registry). GL posting + settlement are explicitly OUT (Phase-2).

**Tech Stack:** Next.js App Router (server components + `'use client'` forms), Supabase Postgres (migrations + RLS + pgTAP), TypeScript, Tailwind token classes. No local Docker — one shared linked remote DB (ADR 0006).

## Global Constraints

Every task's requirements implicitly include this section. Values are exact.

- **Migration numbering:** spec 310 owns ordinals **`075760`–`075769`** (files `supabase/migrations/20260813075760_*.sql` … `075769`). spec 311 owns `075770`+ — do not cross it. Current DB head is `075750`.
- **Migration gate:** a migration write is hook-blocked (`.claude/hooks/require-lane-claim.js`) unless the branch is claimed in `../LANES.md` — **it is** (lane `officeexp`, branch `spec310-office-expenses`). Every migration trips the CI danger-path guard, so the PR does NOT GitHub-auto-merge; additive migrations are self-mergeable on green per the 2026-07-09 standing grant, destructive stay operator-merged. This feature is purely additive.
- **DB workflow order:** add migration file → `pnpm db:push` → `pnpm db:types` → `pnpm db:test`. (`pnpm` needs `export PATH="/c/Program Files/nodejs:$PATH"` on this box; `cd` in every Bash command — cwd resets.)
- **RLS fail-closed rule (coalesce trap):** never gate on a bare `role in (...)` — it returns NULL (not false) for a roleless-but-authenticated JWT and the gate OPENS. Gate on `current_user_role() is null or current_user_role() not in (...)`, or use the null-safe `public.is_back_office(role)` wrapper.
- **DEFINER anon-revoke invariant (pinned by pgTAP `100-anon-exec-definer-harden.test.sql`):** every new SECURITY DEFINER function MUST end with, per function, arg-types fully spelled:
  ```sql
  revoke all     on function public.<fn>(<argtypes>) from public;
  revoke execute on function public.<fn>(<argtypes>) from anon;
  grant  execute on function public.<fn>(<argtypes>) to authenticated;
  ```
- **DEFINER header:** `language plpgsql security definer set search_path = public`. Read caller as `auth.uid()`, role as `public.current_user_role()`.
- **pgTAP:** file `supabase/tests/database/310-office-expenses.test.sql`; wrap `begin; select plan(N); … select * from finish(); rollback;`. NO `COMMIT`, trailing `ROLLBACK` required (runner rejects otherwise). Any test that does `set local role authenticated` MUST first run:
  ```sql
  grant insert on _tap_buf to authenticated, anon;
  grant select on _tap_buf to authenticated, anon;
  grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;
  ```
- **Role sets (SSOT):** define in `src/lib/auth/role-home.ts`, exported and reused everywhere:
  - `OFFICE_EXPENSE_ROLES = ["super_admin","procurement","procurement_manager","accounting"]` — may submit + see own.
  - `OFFICE_EXPENSE_FINANCE_ROLES = ["super_admin","accounting"]` — see all + mark reimbursed.
  - Card registry CRUD = `["super_admin"]` only.
- **Result contract:** server actions return `{ ok: true; … } | { ok: false; error: string }`; error strings are user-facing **Thai**. Never throw to the client.
- **labels.ts:** append new top-level `export const NAME = "…";` (Thai), each preceded by a `// Spec 310 …` comment. Hot shared file — append only, never restructure.
- **Nav guard (`tests/unit/nav-back-affordance.test.ts`):** every new `page.tsx` must be classified or the suite fails. `/expenses` → add `"expenses"` to `NON_DETAIL_ROUTES` (a hub tab; render no `DetailHeader`) and to `HUB_STRIP_ROUTES` + render `HubNav` if it gets a desktop hub strip. `/settings/cards` → add `"settings/cards"` to `STATIC_DETAIL` and render `DetailHeader backHref="/settings"`.
- **Security:** `company_cards` stores label + holder + optional `last4` only. NO full card number, ever.

---

## File Structure

**Create:**

- `supabase/migrations/20260813075760_spec310_audit_actions.sql` — 2 `audit_action` enum values.
- `supabase/migrations/20260813075761_spec310_office_expenses_schema.sql` — `payment_source` enum, 4 tables, RLS, category seed, 4 RPCs.
- `supabase/migrations/20260813075762_spec310_expense_attachments_bucket.sql` — storage bucket + INSERT policy.
- `supabase/tests/database/310-office-expenses.test.sql` — pgTAP.
- `src/lib/expenses/validate-office-expense.ts` — pure validator.
- `src/lib/expenses/attachment-path.ts` — storage path builder.
- `src/lib/expenses/load-office-expenses.ts` — server readers (list own / list reimbursable / list cards / list categories).
- `src/app/expenses/page.tsx` — office surface (form + list + reimburse queue tabs).
- `src/app/expenses/actions.ts` — `recordOfficeExpense`, `addExpenseReceipt`, `markExpenseReimbursed`.
- `src/components/features/expenses/office-expense-form.tsx` — `'use client'` form.
- `src/components/features/expenses/expense-list.tsx` — list rows + chips.
- `src/components/features/expenses/expense-receipt-uploader.tsx` — receipt upload (mirrors invoice-uploader).
- `src/components/features/expenses/reimburse-queue.tsx` — finance grouped list + mark button.
- `src/app/settings/cards/page.tsx` — card registry (super_admin).
- `src/app/settings/cards/actions.ts` — `upsertCompanyCard`, `deactivateCompanyCard`.
- `src/components/features/settings/card-registry.tsx` — `'use client'` card CRUD.

**Modify:**

- `src/lib/auth/role-home.ts` — add the two role sets.
- `src/lib/i18n/labels.ts` — append Thai labels.
- `src/app/settings/sections.ts` — add `/settings/cards` entry to the `admin` section.
- `tests/unit/nav-back-affordance.test.ts` — classify `expenses` + `settings/cards`.

---

## Task 1: Schema — tables, enum, RLS, RPCs, pgTAP

**Files:**

- Create: `supabase/migrations/20260813075760_spec310_audit_actions.sql`
- Create: `supabase/migrations/20260813075761_spec310_office_expenses_schema.sql`
- Create: `supabase/migrations/20260813075762_spec310_expense_attachments_bucket.sql`
- Create/Test: `supabase/tests/database/310-office-expenses.test.sql`

**Interfaces (Produced — later tasks rely on these exact names):**

- Enum `public.payment_source` = `('company_card','own_money','company_direct')`.
- Tables: `company_cards`, `office_expense_categories`, `office_expenses`, `office_expense_attachments`.
- RPC `public.record_office_expense(p_category_id uuid, p_description text, p_amount numeric, p_expense_date date, p_payment_source public.payment_source, p_project_id uuid default null, p_company_card_id uuid default null) returns uuid`.
- RPC `public.mark_expense_reimbursed(p_expense_id uuid) returns void`.
- RPC `public.upsert_company_card(p_id uuid, p_label text, p_holder_user_id uuid, p_last4 text default null) returns uuid`.
- RPC `public.deactivate_company_card(p_id uuid) returns void`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/310-office-expenses.test.sql`. Seed a super_admin, an accounting user, a procurement user, a site_admin (should be denied), a project, a category, a card. Assert: tables exist; `record_office_expense` resolves `reimburse_to_user_id` = card holder for `company_card`, = caller for `own_money`, = NULL for `company_direct`; card source without a card raises `P0001`; a site_admin caller raises `42501`; `mark_expense_reimbursed` sets `reimbursed_at` and is gated to finance roles; anon cannot execute the RPCs.

```sql
begin;
select plan(14);

-- principals
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1','sa@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a2','acct@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a3','proc@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a4','site@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a5','holder@t.local','{}'::jsonb);
update public.users set role='super_admin'          where id='00000000-0000-0000-0000-0000000000a1';
update public.users set role='accounting'           where id='00000000-0000-0000-0000-0000000000a2';
update public.users set role='procurement'          where id='00000000-0000-0000-0000-0000000000a3';
update public.users set role='site_admin'           where id='00000000-0000-0000-0000-0000000000a4';
update public.users set role='procurement'          where id='00000000-0000-0000-0000-0000000000a5';

-- fixtures created as table owner (bypass RLS for setup)
insert into public.projects (id, name, code) values
  ('00000000-0000-0000-0000-0000000000b1','Test Project','TP1') on conflict do nothing;
insert into public.office_expense_categories (id, label_th, sort) values
  ('00000000-0000-0000-0000-0000000000c1','ทดสอบ',10);
insert into public.company_cards (id, label, holder_user_id) values
  ('00000000-0000-0000-0000-0000000000d1','PD Visa','00000000-0000-0000-0000-0000000000a5');

select has_table('public','company_cards','company_cards exists');
select has_table('public','office_expenses','office_expenses exists');
select has_table('public','office_expense_attachments','attachments table exists');

-- allow role switches to write TAP
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ===== procurement records an own_money expense -> reimburse = caller =====
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
select lives_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1', 'พิมพ์เอกสาร', 250.00, '2026-07-12',
    'own_money'::public.payment_source, null, null)
$$, 'procurement can record own_money expense');

-- ===== card source resolves holder =====
select is(
  (select reimburse_to_user_id from public.office_expenses
     where payment_source='company_card' limit 1),
  null::uuid, 'no card expense yet (control)');

select lives_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1', 'น้ำมัน', 500.00, '2026-07-12',
    'company_card'::public.payment_source, '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000d1')
$$, 'card expense records');

select is(
  (select reimburse_to_user_id from public.office_expenses where payment_source='company_card' limit 1),
  '00000000-0000-0000-0000-0000000000a5'::uuid,
  'company_card reimburse-target = card holder');

-- ===== card source WITHOUT a card raises P0001 =====
select throws_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1','x',10,'2026-07-12','company_card'::public.payment_source,null,null)
$$, 'P0001', null, 'card source requires a card');

-- ===== site_admin denied (42501) =====
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a4"}';
select throws_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1','x',10,'2026-07-12','own_money'::public.payment_source,null,null)
$$, '42501', null, 'site_admin cannot record office expense');

-- ===== finance marks reimbursed; procurement cannot =====
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
select throws_ok($$
  select public.mark_expense_reimbursed(
    (select id from public.office_expenses where payment_source='company_card' limit 1))
$$, '42501', null, 'non-finance cannot mark reimbursed');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
select lives_ok($$
  select public.mark_expense_reimbursed(
    (select id from public.office_expenses where payment_source='company_card' limit 1))
$$, 'accounting can mark reimbursed');
select isnt(
  (select reimbursed_at from public.office_expenses where payment_source='company_card' limit 1),
  null, 'reimbursed_at set');

-- ===== upsert_company_card gated to super_admin =====
select throws_ok($$
  select public.upsert_company_card(null,'X card','00000000-0000-0000-0000-0000000000a5',null)
$$, '42501', null, 'accounting cannot upsert card');
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
select lives_ok($$
  select public.upsert_company_card(null,'X card','00000000-0000-0000-0000-0000000000a5','1234')
$$, 'super_admin can upsert card');

-- ===== anon cannot exec =====
reset role;
set local role anon;
select throws_ok($$ select public.record_office_expense(
  '00000000-0000-0000-0000-0000000000c1','x',10,'2026-07-12','own_money'::public.payment_source,null,null) $$,
  '42501', null, 'anon exec blocked');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test — expect FAIL (objects missing)**

Run: `cd /d/claude/projects/prc-ops/prc-ops-officeexp && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:test 2>&1 | grep -A3 310-office`
Expected: FAIL / ERROR — `relation "public.office_expenses" does not exist`.

- [ ] **Step 3: Write the audit-action enum migration**

Create `supabase/migrations/20260813075760_spec310_audit_actions.sql` (own migration — a new enum value cannot be used in the same transaction it is added):

```sql
-- Spec 310: audit actions for office-expense events. Separate migration so the
-- new enum values are committed before the RPC migration (075761) uses them.
alter type public.audit_action add value if not exists 'office_expense_record';
alter type public.audit_action add value if not exists 'office_expense_reimburse';
```

- [ ] **Step 4: Write the schema migration**

Create `supabase/migrations/20260813075761_spec310_office_expenses_schema.sql`:

```sql
-- Spec 310 — non-WP office expenses. New tables + payment_source enum + DEFINER RPCs.
-- Writes go through the RPCs only; authenticated gets SELECT (RLS-scoped), never DML.

create type public.payment_source as enum ('company_card', 'own_money', 'company_direct');

-- ---------- company_cards (superadmin registry; NO card number stored) ----------
create table public.company_cards (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  holder_user_id uuid not null references public.users(id),
  last4          text,
  is_active      boolean not null default true,
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint company_cards_label_shape check (length(btrim(label)) between 1 and 60),
  constraint company_cards_last4_shape check (last4 is null or last4 ~ '^[0-9]{4}$')
);

-- ---------- office_expense_categories (managed list; carries Phase-2 GL mapping) ----------
create table public.office_expense_categories (
  id              uuid primary key default gen_random_uuid(),
  label_th        text not null,
  label_en        text,
  gl_account_code text,            -- Phase-2: accountant fills; soft ref to gl_accounts.code
  sort            integer not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------- office_expenses ----------
create table public.office_expenses (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid references public.projects(id),
  category_id          uuid not null references public.office_expense_categories(id),
  description          text not null,
  amount               numeric not null,
  expense_date         date not null,
  payment_source       public.payment_source not null,
  company_card_id      uuid references public.company_cards(id),
  reimburse_to_user_id uuid references public.users(id),
  reimbursed_at        timestamptz,
  reimbursed_by        uuid references public.users(id),
  submitted_by         uuid not null references public.users(id),
  created_at           timestamptz not null default now(),
  constraint office_expenses_amount_positive check (amount > 0),
  constraint office_expenses_desc_shape check (length(btrim(description)) between 1 and 500),
  -- company_card iff a card is attached
  constraint office_expenses_card_consistency check (
    (payment_source = 'company_card' and company_card_id is not null)
    or (payment_source <> 'company_card' and company_card_id is null)
  )
);
create index office_expenses_submitted_by_idx on public.office_expenses (submitted_by);
create index office_expenses_reimburse_idx on public.office_expenses (reimburse_to_user_id) where reimbursed_at is null;
create index office_expenses_project_idx on public.office_expenses (project_id);

-- ---------- office_expense_attachments (append-only receipt metadata) ----------
create table public.office_expense_attachments (
  id                uuid primary key,          -- client-supplied uuid = storage object name
  office_expense_id uuid not null references public.office_expenses(id) on delete cascade,
  storage_path      text not null,
  created_by        uuid not null references public.users(id),
  created_at        timestamptz not null default now(),
  unique (storage_path)
);
create index office_expense_attachments_expense_idx on public.office_expense_attachments (office_expense_id);

-- ================= RLS =================
alter table public.company_cards enable row level security;
alter table public.office_expense_categories enable row level security;
alter table public.office_expenses enable row level security;
alter table public.office_expense_attachments enable row level security;

revoke all on public.company_cards, public.office_expense_categories,
              public.office_expenses, public.office_expense_attachments
  from anon, authenticated;
grant select on public.company_cards, public.office_expense_categories,
                public.office_expenses, public.office_expense_attachments
  to authenticated;
grant select, insert, update, delete on public.company_cards, public.office_expense_categories,
                public.office_expenses, public.office_expense_attachments
  to service_role;

-- cards + categories readable by any authenticated user (form pickers need them)
create policy "company cards readable" on public.company_cards
  for select to authenticated using (true);
create policy "expense categories readable" on public.office_expense_categories
  for select to authenticated using (true);

-- office_expenses: submitter sees own; finance (accounting/super_admin) see all.
-- Fail-closed: current_user_role() NULL -> both branches false.
create policy "office expenses visible to submitter or finance" on public.office_expenses
  for select to authenticated using (
    submitted_by = auth.uid()
    or coalesce(public.current_user_role() in ('super_admin','accounting'), false)
  );

-- attachments follow their parent expense's visibility
create policy "expense attachments follow parent" on public.office_expense_attachments
  for select to authenticated using (
    exists (select 1 from public.office_expenses e
              where e.id = office_expense_id
                and (e.submitted_by = auth.uid()
                     or coalesce(public.current_user_role() in ('super_admin','accounting'), false)))
  );

-- ================= seed categories =================
insert into public.office_expense_categories (label_th, sort) values
  ('น้ำมัน/ค่าเดินทาง', 10),
  ('ทางด่วน/ที่จอดรถ', 20),
  ('อุปกรณ์สำนักงาน', 30),
  ('ซอฟต์แวร์/บริการ', 40),
  ('ค่ารับรอง/อาหาร', 50),
  ('ค่าสาธารณูปโภค', 60),
  ('ค่าธรรมเนียม/ราชการ', 70),
  ('อื่นๆ', 999);

-- ================= RPCs =================
-- record_office_expense: gate to office roles, validate, resolve reimburse target, insert.
create function public.record_office_expense(
  p_category_id uuid,
  p_description text,
  p_amount numeric,
  p_expense_date date,
  p_payment_source public.payment_source,
  p_project_id uuid default null,
  p_company_card_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_reimburse uuid;
  v_id uuid;
begin
  if v_role is null
     or v_role not in ('super_admin','procurement','procurement_manager','accounting') then
    raise exception 'record_office_expense: role not permitted' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_description)), 0) = 0 then
    raise exception 'record_office_expense: description required' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'record_office_expense: amount must be positive' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.office_expense_categories where id = p_category_id and is_active) then
    raise exception 'record_office_expense: unknown category' using errcode = 'P0001';
  end if;

  if p_payment_source = 'company_card' then
    if p_company_card_id is null then
      raise exception 'record_office_expense: card required for company_card source' using errcode = 'P0001';
    end if;
    select holder_user_id into v_reimburse
      from public.company_cards where id = p_company_card_id and is_active;
    if v_reimburse is null then
      raise exception 'record_office_expense: unknown or inactive card' using errcode = 'P0001';
    end if;
  elsif p_payment_source = 'own_money' then
    v_reimburse := auth.uid();
    if p_company_card_id is not null then
      raise exception 'record_office_expense: card not allowed for this source' using errcode = 'P0001';
    end if;
  else  -- company_direct
    v_reimburse := null;
    if p_company_card_id is not null then
      raise exception 'record_office_expense: card not allowed for this source' using errcode = 'P0001';
    end if;
  end if;

  insert into public.office_expenses
    (project_id, category_id, description, amount, expense_date, payment_source,
     company_card_id, reimburse_to_user_id, submitted_by)
  values
    (p_project_id, p_category_id, btrim(p_description), p_amount, p_expense_date, p_payment_source,
     case when p_payment_source = 'company_card' then p_company_card_id else null end,
     v_reimburse, auth.uid())
  returning id into v_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('office_expense_record', auth.uid(), v_role, 'office_expenses', v_id,
          jsonb_build_object('amount', p_amount, 'payment_source', p_payment_source,
                             'reimburse_to', v_reimburse, 'project_id', p_project_id));
  return v_id;
end;
$$;
revoke all     on function public.record_office_expense(uuid, text, numeric, date, public.payment_source, uuid, uuid) from public;
revoke execute on function public.record_office_expense(uuid, text, numeric, date, public.payment_source, uuid, uuid) from anon;
grant  execute on function public.record_office_expense(uuid, text, numeric, date, public.payment_source, uuid, uuid) to authenticated;

-- mark_expense_reimbursed: finance only; idempotent-guarded.
create function public.mark_expense_reimbursed(p_expense_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_target uuid;
  v_already timestamptz;
begin
  if v_role is null or v_role not in ('super_admin','accounting') then
    raise exception 'mark_expense_reimbursed: role not permitted' using errcode = '42501';
  end if;
  select reimburse_to_user_id, reimbursed_at into v_target, v_already
    from public.office_expenses where id = p_expense_id;
  if not found then
    raise exception 'mark_expense_reimbursed: expense not found' using errcode = 'P0001';
  end if;
  if v_target is null then
    raise exception 'mark_expense_reimbursed: expense has no reimburse target' using errcode = 'P0001';
  end if;
  if v_already is not null then
    raise exception 'mark_expense_reimbursed: already reimbursed' using errcode = 'P0001';
  end if;
  update public.office_expenses
     set reimbursed_at = now(), reimbursed_by = auth.uid()
   where id = p_expense_id;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('office_expense_reimburse', auth.uid(), v_role, 'office_expenses', p_expense_id,
          jsonb_build_object('reimburse_to', v_target));
end;
$$;
revoke all     on function public.mark_expense_reimbursed(uuid) from public;
revoke execute on function public.mark_expense_reimbursed(uuid) from anon;
grant  execute on function public.mark_expense_reimbursed(uuid) to authenticated;

-- upsert_company_card: super_admin only. NULL p_id = insert; else update.
create function public.upsert_company_card(
  p_id uuid, p_label text, p_holder_user_id uuid, p_last4 text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id uuid;
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'upsert_company_card: super_admin only' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_label)), 0) = 0 then
    raise exception 'upsert_company_card: label required' using errcode = 'P0001';
  end if;
  if p_last4 is not null and p_last4 !~ '^[0-9]{4}$' then
    raise exception 'upsert_company_card: last4 must be 4 digits' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users where id = p_holder_user_id) then
    raise exception 'upsert_company_card: unknown holder' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.company_cards (label, holder_user_id, last4, created_by)
    values (btrim(p_label), p_holder_user_id, p_last4, auth.uid())
    returning id into v_id;
  else
    update public.company_cards
       set label = btrim(p_label), holder_user_id = p_holder_user_id,
           last4 = p_last4, updated_at = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'upsert_company_card: card not found' using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all     on function public.upsert_company_card(uuid, text, uuid, text) from public;
revoke execute on function public.upsert_company_card(uuid, text, uuid, text) from anon;
grant  execute on function public.upsert_company_card(uuid, text, uuid, text) to authenticated;

-- deactivate_company_card: super_admin only (soft-delete).
create function public.deactivate_company_card(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role <> 'super_admin' then
    raise exception 'deactivate_company_card: super_admin only' using errcode = '42501';
  end if;
  update public.company_cards set is_active = false, updated_at = now() where id = p_id;
end;
$$;
revoke all     on function public.deactivate_company_card(uuid) from public;
revoke execute on function public.deactivate_company_card(uuid) from anon;
grant  execute on function public.deactivate_company_card(uuid) to authenticated;
```

- [ ] **Step 5: Write the storage bucket migration**

Create `supabase/migrations/20260813075762_spec310_expense_attachments_bucket.sql`. Bucket private; INSERT policy scopes the object path (`{expense_id}/{attachment_id}.{ext}`) to an office_expense the caller may see. Reads are service-role signed URLs only (no SELECT policy).

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-attachments', 'expense-attachments', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

-- upload allowed to office roles for an expense they submitted or (finance) can see.
create policy "expense receipt uploads by office roles"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'expense-attachments'
    and coalesce(public.current_user_role() in
         ('super_admin','procurement','procurement_manager','accounting'), false)
    and array_length(storage.foldername(objects.name), 1) = 1
    and exists (
      select 1 from public.office_expenses e
       where e.id::text = (storage.foldername(objects.name))[1]
         and (e.submitted_by = auth.uid()
              or coalesce(public.current_user_role() in ('super_admin','accounting'), false))
    )
  );
```

- [ ] **Step 6: Apply + regen types**

Run: `cd /d/claude/projects/prc-ops/prc-ops-officeexp && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:push && pnpm db:types`
Expected: push applies 075760/075761/075762; `src/lib/db/database.types.ts` regenerates with the new tables + `payment_source` enum + Functions. (If `db:push` prompts, it auto-answers Y on this box.)

- [ ] **Step 7: Run the pgTAP test — expect PASS**

Run: `cd /d/claude/projects/prc-ops/prc-ops-officeexp && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:test 2>&1 | grep -A3 310-office`
Expected: `310-office-expenses.test.sql` … ok, 14/14. (If a live-data flake reds an UNRELATED file, re-run — known reds are only `200-store`/`221-catalog`.)

- [ ] **Step 8: Commit**

```bash
cd /d/claude/projects/prc-ops/prc-ops-officeexp && git add supabase/ src/lib/db/database.types.ts && git commit -m "feat(310): office-expense schema — tables, payment_source, DEFINER RPCs, pgTAP"
```

---

## Task 2: Role sets + labels + card registry (`/settings/cards`)

**Files:**

- Modify: `src/lib/auth/role-home.ts` (add `OFFICE_EXPENSE_ROLES`, `OFFICE_EXPENSE_FINANCE_ROLES`)
- Modify: `src/lib/i18n/labels.ts` (append)
- Modify: `src/app/settings/sections.ts` (admin-section entry)
- Modify: `tests/unit/nav-back-affordance.test.ts` (classify `settings/cards`)
- Create: `src/lib/expenses/load-office-expenses.ts` (add `listCompanyCards`, `listAssignableHolders`)
- Create: `src/app/settings/cards/actions.ts`
- Create: `src/app/settings/cards/page.tsx`
- Create: `src/components/features/settings/card-registry.tsx`

**Interfaces:**

- Consumes (Task 1): RPCs `upsert_company_card`, `deactivate_company_card`; table `company_cards`.
- Produces: `listCompanyCards(supabase): Promise<CompanyCard[]>` where `CompanyCard = { id: string; label: string; holderUserId: string; holderName: string | null; last4: string | null; isActive: boolean }`; actions `upsertCompanyCard(input) / deactivateCompanyCard(id)` returning the result union.

- [ ] **Step 1: Add role sets (SSOT)**

In `src/lib/auth/role-home.ts`, after `PURCHASING_ROLES`, add:

```ts
// Spec 310 — office-expense actors.
export const OFFICE_EXPENSE_ROLES: ReadonlyArray<UserRole> = [
  "super_admin",
  "procurement",
  "procurement_manager",
  "accounting",
];
// Finance actors who see all expenses + mark reimbursed.
export const OFFICE_EXPENSE_FINANCE_ROLES: ReadonlyArray<UserRole> = ["super_admin", "accounting"];
```

- [ ] **Step 2: Append labels**

In `src/lib/i18n/labels.ts` append (Thai; each after a `// Spec 310` comment). Include at minimum:

```ts
// Spec 310 — office expenses
export const OFFICE_EXPENSE_NAV_LABEL = "ค่าใช้จ่ายสำนักงาน";
export const CARD_REGISTRY_LABEL = "บัตรเครดิตบริษัท";
export const CARD_REGISTRY_HINT = "จัดการบัตรเครดิตบริษัทและผู้ถือบัตร (ไม่เก็บเลขบัตรเต็ม)";
export const CARD_ADD_LABEL = "เพิ่มบัตร";
export const CARD_HOLDER_LABEL = "ผู้ถือบัตร";
export const CARD_LAST4_LABEL = "เลข 4 ตัวท้าย (ถ้ามี)";
export const CARD_DEACTIVATE_LABEL = "ปิดใช้งาน";
export const PAYMENT_SOURCE_CARD_LABEL = "บัตรเครดิตบริษัท";
export const PAYMENT_SOURCE_OWN_LABEL = "จ่ายเงินตัวเอง";
export const PAYMENT_SOURCE_DIRECT_LABEL = "บริษัทจ่ายตรง";
```

(Add the remaining form/list/queue labels used by Tasks 3–5 here too as you reach them — keep them under this same `// Spec 310` block.)

- [ ] **Step 3: Write the failing action test**

Create `tests/unit/office-expense-cards.test.ts`. Because actions hit Supabase, test the pure seams instead: assert `listCompanyCards` maps DB rows → `CompanyCard` (holder join → `holderName`), and that the card-registry nav entry is present + super_admin-gated.

```ts
import { describe, it, expect } from "vitest";
import { visibleEntries } from "@/app/settings/sections";
// … build the admin section via the config and assert a "/settings/cards" link exists
it("exposes /settings/cards to super_admin only", () => {
  const asSuper = /* configSection('admin') entries visible to super_admin */;
  expect(asSuper.some((e) => e.kind === "link" && e.href === "/settings/cards")).toBe(true);
  const asProc = /* … visible to 'procurement' */;
  expect(asProc.some((e) => e.kind === "link" && e.href === "/settings/cards")).toBe(false);
});
```

Run: `… && pnpm vitest run tests/unit/office-expense-cards.test.ts` → FAIL (entry not present).

- [ ] **Step 4: Register the settings entry**

In `src/app/settings/sections.ts`, add to the `admin` section's `entries` (mirror the `/settings/integrity` entry), importing a lucide icon (e.g. `CreditCard`):

```ts
{ kind: "link", href: "/settings/cards", icon: CreditCard,
  label: CARD_REGISTRY_LABEL, hint: CARD_REGISTRY_HINT },
```

- [ ] **Step 5: Write the reader + actions**

`src/lib/expenses/load-office-expenses.ts` — `listCompanyCards`:

```ts
import "server-only";
import type { createClient } from "@/lib/db/server";
type DB = Awaited<ReturnType<typeof createClient>>;
export interface CompanyCard {
  id: string;
  label: string;
  holderUserId: string;
  holderName: string | null;
  last4: string | null;
  isActive: boolean;
}
export async function listCompanyCards(supabase: DB): Promise<CompanyCard[]> {
  const { data } = await supabase
    .from("company_cards")
    .select(
      "id, label, holder_user_id, last4, is_active, holder:users!company_cards_holder_user_id_fkey(full_name)",
    )
    .order("is_active", { ascending: false })
    .order("label");
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    holderUserId: r.holder_user_id,
    holderName: (r.holder as { full_name: string | null } | null)?.full_name ?? null,
    last4: r.last4,
    isActive: r.is_active,
  }));
}
```

Also add `listAssignableHolders(supabase)` → `{ id, fullName }[]` from `users` filtered to `OFFICE_EXPENSE_ROLES` (holder candidates), ordered by name.

`src/app/settings/cards/actions.ts` — mirror `recordSitePurchase`'s shape (validate → `getActionUser()` → `supabase.rpc(...)` → `revalidatePath` → union):

```ts
"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";

export interface UpsertCardInput {
  id: string | null;
  label: string;
  holderUserId: string;
  last4: string | null;
}
export type CardActionResult = { ok: true; id: string } | { ok: false; error: string };

export async function upsertCompanyCard(input: UpsertCardInput): Promise<CardActionResult> {
  const label = input.label.trim();
  if (label.length === 0) return { ok: false, error: "กรุณาระบุชื่อบัตร" };
  if (input.last4 && !/^[0-9]{4}$/.test(input.last4))
    return { ok: false, error: "เลข 4 ตัวท้ายต้องเป็นตัวเลข 4 หลัก" };
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { data, error } = await auth.supabase.rpc("upsert_company_card", {
    p_id: input.id,
    p_label: label,
    p_holder_user_id: input.holderUserId,
    ...(input.last4 ? { p_last4: input.last4 } : {}),
  });
  if (error || !data) return { ok: false, error: "บันทึกบัตรไม่สำเร็จ" };
  revalidatePath("/settings/cards");
  return { ok: true, id: data };
}

export async function deactivateCompanyCard(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const { error } = await auth.supabase.rpc("deactivate_company_card", { p_id: id });
  if (error) return { ok: false, error: "ปิดใช้งานบัตรไม่สำเร็จ" };
  revalidatePath("/settings/cards");
  return { ok: true };
}
```

- [ ] **Step 6: Write the page + client component**

`src/app/settings/cards/page.tsx` — mirror `src/app/settings/integrity/page.tsx` exactly (gate + shell + `DetailHeader backHref="/settings"`):

```tsx
export default async function CardsPage() {
  await requireRole(["super_admin"]);
  const supabase = await createClient();
  const [cards, holders] = await Promise.all([
    listCompanyCards(supabase),
    listAssignableHolders(supabase),
  ]);
  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">{CARD_REGISTRY_LABEL}</h1>
      </DetailHeader>
      <CardRegistry cards={cards} holders={holders} />
    </PageShell>
  );
}
```

`src/components/features/settings/card-registry.tsx` (`'use client'`) — mirror `self-purchase-form.tsx` state/transition/error idiom: a list of existing cards (label · holder · last4 · deactivate button) + an add/edit form (label input, holder `<select>` from `holders`, optional last4 input) calling `upsertCompanyCard`/`deactivateCompanyCard`, `router.refresh()` on success. Use class consts `BUTTON_PRIMARY`, `FIELD_INPUT`, `INLINE_ERROR`, and the `SELECT`/`LABEL` consts from `self-purchase-form.tsx`.

- [ ] **Step 7: Classify the route in the nav guard**

In `tests/unit/nav-back-affordance.test.ts` add `"settings/cards"` to `STATIC_DETAIL`. (Page renders `DetailHeader` — satisfies the detail contract.)

- [ ] **Step 8: Run tests + verify in browser**

Run: `… && pnpm vitest run tests/unit/office-expense-cards.test.ts tests/unit/nav-back-affordance.test.ts` → PASS.
Then browser-verify per `dev-preview-login` memory (super_admin): open `/settings/cards`, add "PD Visa" → holder Pattrawut → last4 → confirm it lists; deactivate → confirm it greys. Screenshot.

- [ ] **Step 9: Commit**

```bash
cd /d/claude/projects/prc-ops/prc-ops-officeexp && git add -A && git commit -m "feat(310): company-card registry at /settings/cards (super_admin)"
```

---

## Task 3: Expense form + my-list (`/expenses`)

**Files:**

- Create: `src/lib/expenses/validate-office-expense.ts`
- Create: `src/app/expenses/actions.ts` (`recordOfficeExpense`)
- Create: `src/app/expenses/page.tsx`
- Create: `src/components/features/expenses/office-expense-form.tsx`
- Create: `src/components/features/expenses/expense-list.tsx`
- Modify: `src/lib/expenses/load-office-expenses.ts` (add `listMyExpenses`, `listExpenseCategories`, `listActiveProjectsForExpense`)
- Modify: `tests/unit/nav-back-affordance.test.ts` (classify `expenses`)

**Interfaces:**

- Consumes (Task 1): RPC `record_office_expense`; (Task 2) `listCompanyCards`.
- Produces: `validateOfficeExpense(input): { ok:true; value: ValidatedOfficeExpense } | { ok:false; error }`; action `recordOfficeExpense(input): { ok:true; id } | { ok:false; error }`.

- [ ] **Step 1: Write the failing validator test**

Create `tests/unit/validate-office-expense.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateOfficeExpense } from "@/lib/expenses/validate-office-expense";

const base = {
  categoryId: "11111111-1111-1111-1111-111111111111",
  description: "น้ำมัน",
  amount: 500,
  expenseDate: "2026-07-12",
  paymentSource: "own_money" as const,
  projectId: null,
  companyCardId: null,
};

it("accepts a valid own_money expense", () => {
  expect(validateOfficeExpense(base).ok).toBe(true);
});
it("rejects non-positive amount", () => {
  const r = validateOfficeExpense({ ...base, amount: 0 });
  expect(r.ok).toBe(false);
});
it("requires a card for company_card source", () => {
  const r = validateOfficeExpense({ ...base, paymentSource: "company_card", companyCardId: null });
  expect(r.ok).toBe(false);
});
it("rejects a card on a non-card source", () => {
  const r = validateOfficeExpense({
    ...base,
    paymentSource: "own_money",
    companyCardId: "22222222-2222-2222-2222-222222222222",
  });
  expect(r.ok).toBe(false);
});
it("rejects empty description", () => {
  expect(validateOfficeExpense({ ...base, description: "  " }).ok).toBe(false);
});
```

Run: `… && pnpm vitest run tests/unit/validate-office-expense.test.ts` → FAIL (module missing).

- [ ] **Step 2: Write the validator**

`src/lib/expenses/validate-office-expense.ts` (pure; mirror `validate-site-purchase.ts`). `PaymentSource` type imported from generated enums: `Database["public"]["Enums"]["payment_source"]`.

```ts
import { UUID_REGEX } from "@/lib/validate/uuid";
import type { Database } from "@/lib/db/database.types";
export type PaymentSource = Database["public"]["Enums"]["payment_source"];
export interface ValidatedOfficeExpense {
  categoryId: string;
  description: string;
  amount: number;
  expenseDate: string;
  paymentSource: PaymentSource;
  projectId: string | null;
  companyCardId: string | null;
}
export type ValidateResult =
  | { ok: true; value: ValidatedOfficeExpense }
  | { ok: false; error: string };

export function validateOfficeExpense(input: {
  categoryId: string;
  description: string;
  amount: number;
  expenseDate: string;
  paymentSource: PaymentSource;
  projectId: string | null;
  companyCardId: string | null;
}): ValidateResult {
  if (!UUID_REGEX.test(input.categoryId)) return { ok: false, error: "กรุณาเลือกประเภทค่าใช้จ่าย" };
  const description = input.description.trim();
  if (description.length === 0) return { ok: false, error: "กรุณาระบุรายละเอียด" };
  if (description.length > 500) return { ok: false, error: "รายละเอียดต้องไม่เกิน 500 ตัวอักษร" };
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    return { ok: false, error: "จำนวนเงินต้องมากกว่า 0" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate))
    return { ok: false, error: "กรุณาระบุวันที่" };
  if (input.projectId !== null && !UUID_REGEX.test(input.projectId))
    return { ok: false, error: "โครงการไม่ถูกต้อง" };
  if (input.paymentSource === "company_card") {
    if (!input.companyCardId || !UUID_REGEX.test(input.companyCardId))
      return { ok: false, error: "กรุณาเลือกบัตร" };
  } else if (input.companyCardId !== null) {
    return { ok: false, error: "แหล่งจ่ายนี้ไม่ต้องระบุบัตร" };
  }
  return { ok: true, value: { ...input, description } };
}
```

Run the test again → PASS.

- [ ] **Step 3: Write the action + readers**

`src/app/expenses/actions.ts`:

```ts
"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { validateOfficeExpense } from "@/lib/expenses/validate-office-expense";
import type { PaymentSource } from "@/lib/expenses/validate-office-expense";

export interface RecordExpenseInput {
  categoryId: string;
  description: string;
  amount: number;
  expenseDate: string;
  paymentSource: PaymentSource;
  projectId: string | null;
  companyCardId: string | null;
}
export type RecordExpenseResult = { ok: true; id: string } | { ok: false; error: string };

export async function recordOfficeExpense(input: RecordExpenseInput): Promise<RecordExpenseResult> {
  const validated = validateOfficeExpense(input);
  if (!validated.ok) return validated;
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };
  const v = validated.value;
  const { data, error } = await auth.supabase.rpc("record_office_expense", {
    p_category_id: v.categoryId,
    p_description: v.description,
    p_amount: v.amount,
    p_expense_date: v.expenseDate,
    p_payment_source: v.paymentSource,
    ...(v.projectId ? { p_project_id: v.projectId } : {}),
    ...(v.companyCardId ? { p_company_card_id: v.companyCardId } : {}),
  });
  if (error || !data) return { ok: false, error: "บันทึกค่าใช้จ่ายไม่สำเร็จ กรุณาลองใหม่" };
  revalidatePath("/expenses");
  return { ok: true, id: data };
}
```

Add to `src/lib/expenses/load-office-expenses.ts`: `listExpenseCategories(supabase)` (active, ordered by sort) → `{ id, labelTh }[]`; `listActiveProjectsForExpense(supabase)` → `{ id, name }[]` from `projects` (mirror the projects read used elsewhere — filter to active/visible as that convention dictates); `listMyExpenses(supabase, userId)` → the caller's expenses with joined category label, project name, card label, holder name, an `awaitingReceipt` boolean (left-join attachment count = 0), and `reimburseToName`. RLS already restricts rows to own/finance, so `listMyExpenses` selects `.eq("submitted_by", userId)`.

- [ ] **Step 4: Write the page + form + list**

`src/app/expenses/page.tsx` — mirror `src/app/requests/page.tsx`:

```tsx
export default async function ExpensesPage() {
  const ctx = await requireRole(OFFICE_EXPENSE_ROLES);
  const supabase = await createClient();
  const [categories, projects, cards, myExpenses] = await Promise.all([
    listExpenseCategories(supabase), listActiveProjectsForExpense(supabase),
    listCompanyCards(supabase), listMyExpenses(supabase, ctx.id),
  ]);
  const isFinance = OFFICE_EXPENSE_FINANCE_ROLES.includes(ctx.role);
  return (
    <PageShell>
      <BottomTabBar role={ctx.role} />
      <HubNav ... />  {/* if a desktop hub strip is wanted; see nav guard note */}
      <h1 ...>{OFFICE_EXPENSE_NAV_LABEL}</h1>
      <OfficeExpenseForm categories={categories} projects={projects}
        cards={cards.filter((c) => c.isActive)} />
      <ExpenseList expenses={myExpenses} />
      {isFinance && /* link/tab to reimburse queue — built in Task 5 */ null}
    </PageShell>
  );
}
```

`office-expense-form.tsx` (`'use client'`, mirror `self-purchase-form.tsx`): fields — category `<select>`, amount input, `expense_date` `<input type="date">`, project `<select>` (optional; blank = "ไม่ระบุโครงการ"), a payment-source segmented control (3 buttons: card / own / company using `worklistChipClass(active)` + `aria-pressed`), and — shown only when source = `company_card` — a card `<select>` from `cards` (option text `${label}${last4 ? " ·"+last4 : ""} · ${holderName}`), description textarea. On submit: `validateOfficeExpense` → `recordOfficeExpense` → on ok `router.refresh()` + reset. Show the resolved reimburse hint live ("→ คืนเงินให้: <holder>" for card, "→ คืนเงินให้คุณเอง" for own, "— ไม่ต้องคืนเงิน" for company).
`expense-list.tsx`: one row per expense — date · category · amount · description, plus chips: reimburse-target (`คืนเงิน: <name>` / `ไม่ต้องคืนเงิน`), reimbursed state (`คืนแล้ว` when `reimbursed_at`), and `รอใบเสร็จ` when `awaitingReceipt`.

- [ ] **Step 5: Classify the route + run tests**

In `tests/unit/nav-back-affordance.test.ts` add `"expenses"` to `NON_DETAIL_ROUTES` (top-level tab, no `DetailHeader`); if you render `HubNav`, also add `"expenses"` to `HUB_STRIP_ROUTES`.
Run: `… && pnpm vitest run tests/unit/validate-office-expense.test.ts tests/unit/nav-back-affordance.test.ts` → PASS.

- [ ] **Step 6: Browser-verify + commit**

Browser (procurement role via dev-preview): open `/expenses`, file an own-money expense → appears in list with "คืนเงินให้คุณเอง" + "รอใบเสร็จ"; file a card expense → reimburse shows the holder. Screenshot.

```bash
cd /d/claude/projects/prc-ops/prc-ops-officeexp && git add -A && git commit -m "feat(310): office-expense form + my-list at /expenses"
```

---

## Task 4: Receipt upload

**Files:**

- Create: `src/lib/expenses/attachment-path.ts`
- Create: `src/components/features/expenses/expense-receipt-uploader.tsx`
- Modify: `src/app/expenses/actions.ts` (add `addExpenseReceipt`)
- Modify: `src/components/features/expenses/office-expense-form.tsx` (show uploader after a successful record, keyed by the returned id)

**Interfaces:**

- Consumes (Task 1): `office_expense_attachments` table + `expense-attachments` bucket policy.
- Produces: `buildExpenseAttachmentPath(expenseId, attachmentId, ext): string | null`; action `addExpenseReceipt({ officeExpenseId, attachmentId, ext }): { ok:true } | { ok:false; error }`.

- [ ] **Step 1: Failing path-builder test**

Create `tests/unit/expense-attachment-path.test.ts`:

```ts
import { it, expect } from "vitest";
import { buildExpenseAttachmentPath } from "@/lib/expenses/attachment-path";
const E = "11111111-1111-1111-1111-111111111111",
  A = "22222222-2222-2222-2222-222222222222";
it("builds {expense}/{attachment}.{ext}", () => {
  expect(buildExpenseAttachmentPath(E, A, "jpg")).toBe(`${E}/${A}.jpg`);
});
it("rejects bad uuid / ext", () => {
  expect(buildExpenseAttachmentPath("x", A, "jpg")).toBeNull();
  expect(buildExpenseAttachmentPath(E, A, "exe")).toBeNull();
});
```

- [ ] **Step 2: Path builder** — mirror `src/lib/purchasing/attachment-path.ts` (reuse its `isValidAttachmentExt`), path `${expenseId}/${attachmentId}.${ext}`. Run test → PASS.

- [ ] **Step 3: `addExpenseReceipt` action** — mirror `addReferenceAttachment`: validate uuids + ext → `getActionUser()` → rebuild path server-side via `buildExpenseAttachmentPath` → verify the caller may see the parent expense (select it under RLS; if absent, fail) → insert `office_expense_attachments` row (`id = attachmentId`, `storage_path`, `created_by = user.id`) with 23505 idempotent replay-confirm → `revalidatePath("/expenses")` → union.

- [ ] **Step 4: Uploader component** — `expense-receipt-uploader.tsx` mirrors `invoice-uploader.tsx`: browser client `.storage.from("expense-attachments").upload(path, blob)` then call `addExpenseReceipt`. Wire it into `office-expense-form.tsx` — after `recordOfficeExpense` returns `{ok,id}`, store `recordedId` and render `<ExpenseReceiptUploader officeExpenseId={recordedId} onUploaded={() => router.refresh()} />` (same `recordedId`-block pattern as `self-purchase-form.tsx`).

- [ ] **Step 5: Browser-verify + commit** — record an expense, upload a receipt photo, confirm `รอใบเสร็จ` chip clears. Screenshot.

```bash
cd /d/claude/projects/prc-ops/prc-ops-officeexp && git add -A && git commit -m "feat(310): office-expense receipt upload"
```

---

## Task 5: Reimburse queue (finance)

**Files:**

- Create: `src/components/features/expenses/reimburse-queue.tsx`
- Modify: `src/app/expenses/actions.ts` (add `markExpenseReimbursed`)
- Modify: `src/lib/expenses/load-office-expenses.ts` (add `listReimbursableExpenses`)
- Modify: `src/app/expenses/page.tsx` (render the queue for finance roles — a tab or a section)

**Interfaces:**

- Consumes (Task 1): RPC `mark_expense_reimbursed`; (Task 3) the expenses list shape.
- Produces: action `markExpenseReimbursed(id): { ok:true } | { ok:false; error }`; `listReimbursableExpenses(supabase)` → expenses where `reimburse_to_user_id is not null and reimbursed_at is null`, grouped by target.

- [ ] **Step 1: Failing action-guard test** — `tests/unit/reimburse-queue.test.ts`: assert `listReimbursableExpenses` groups by `reimburseToUserId` and sums per target. (Pure grouping helper `groupByReimburseTarget(rows)` — extract it so it is unit-testable without the DB.)

- [ ] **Step 2: Grouping helper + reader** — `groupByReimburseTarget(expenses)` → `{ userId, name, total, items }[]`; `listReimbursableExpenses(supabase)` selects unreimbursed-with-target rows (RLS restricts to finance-visible = all). Run test → PASS.

- [ ] **Step 3: `markExpenseReimbursed` action** — `getActionUser()` → `supabase.rpc("mark_expense_reimbursed", { p_expense_id: id })` → `revalidatePath("/expenses")` → union with Thai error.

- [ ] **Step 4: Queue component + wire-in** — `reimburse-queue.tsx`: per target person, a card with the total + each expense row + a `[คืนเงินแล้ว]` button per row (or per person) calling `markExpenseReimbursed`, `router.refresh()` on ok. In `page.tsx`, render `<ReimburseQueue groups={...} />` gated behind `isFinance` (as a second tab or a labelled section).

- [ ] **Step 5: Browser-verify + commit** — as accounting/super_admin: open `/expenses`, see the card expense under "Pattrawut", mark reimbursed → row shows `คืนแล้ว`, drops from the queue. Screenshot.

```bash
cd /d/claude/projects/prc-ops/prc-ops-officeexp && git add -A && git commit -m "feat(310): reimburse queue + mark-reimbursed (finance)"
```

---

## Self-Review (done during authoring)

- **Spec coverage:** D1 new tables → Task 1. D2 record-only → no approval columns (Task 1). D3 payment-source→target resolved in `record_office_expense` → Task 1 + pgTAP. D4 category table + `gl_account_code` (nullable, Phase-2) → Task 1. D5 receipt soft-gate (`awaitingReceipt` chip) → Tasks 3–4. Card registry → Task 2. Reimburse tag+mark → Tasks 3/5. Roles/RLS (submitter+finance; site roles excluded) → Task 1 policies + Task 2 role sets. Nav guard → Tasks 2/3. Security (no PAN; DEFINER anon-revoke) → Task 1. All covered.
- **Type consistency:** `PaymentSource` sourced once from generated enums and reused (validator, action). RPC arg names `p_*` match between migration + actions. `CompanyCard`/`RecordExpenseInput` shapes stable across tasks.
- **Placeholders:** SQL, validator, actions, and tests are complete. Pure-presentational JSX (form/list/queue/registry) is specified by fields + behavior + the exact precedent file to mirror + the class consts to use — deliberate, since those files' exact markup must match live Tailwind conventions the executor reads at build time.
- **Deferred, on purpose:** GL posting + settlement (Phase-2). `company_direct` sub-account choice (spec open-Q2). Reimburse-queue-as-tab vs section (settled at Task 5 build).
