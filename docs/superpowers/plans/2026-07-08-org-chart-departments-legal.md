# Org Chart & Departments (Legal first tenant) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize the org model (department · role · level · position as four separate axes), land departments as open data, and deliver Legal as the first tenant (contracts + document approval).

**Architecture:** New non-gating `departments` table (open data; `users.department_id` FK); one new `legal` auth-role; two Legal domain tables (`contracts`, `document_approvals`) on the binding money/document posture. Access stays role-gated (departments are label-only; a dept-scoped-RLS seam is left for phase 3). Follows spec [284](../../feature-specs/284-org-chart-departments-legal.md) and ADR [0080](../../decisions/0080-org-chart-departments-positions.md).

**Tech Stack:** Next.js 16 App Router (Server Components default), Supabase Postgres + RLS, pgTAP, TypeScript strict, Vitest, pnpm.

## Global Constraints

- **One unit per session.** Each Task below is one PR / one session. Do NOT start the next Task in the same session (CLAUDE.md "Feature workflow" §7).
- **Worktree off fresh `origin/main`.** Local `main` is behind; each Task runs in its own worktree: `git worktree add ../prc-ops-spec284-uN -b spec284-uN origin/main`. Append a line to `../../../LANES.md` before schema work; schema is single-lane.
- **Next migration number `20260813075490+`** (main↔DB synced thru `075480` — spec-283 integrity console took `075470`/`075480`, #392). **Re-confirm the live claimant in `LANES.md` at build**; increment per schema Task; never reuse. Timestamped `.sql` under `supabase/migrations/`.
- **DB workflow (schema Tasks):** add migration → `pnpm db:push` → `pnpm db:types` → `pnpm db:test`. pgTAP files are `begin; select plan(N); … select * from finish(); rollback;` under `supabase/tests/database/`; confirm the next free `NN-` prefix against `origin/main` at build (spec-283 used `284`; start at `285`).
- **TDD, non-negotiable.** First artifact of every Task is the failing test. State "Writing failing test first."
- **Every table has RLS.** Every new SECURITY DEFINER function does `revoke execute … from anon, public;` (the 073700/073800 anon-close idiom). Status fields are Postgres enums, never free text. FKs are typed — no mixed-content reference columns.
- **Money/document posture (binding).** `contracts`, `contract_attachments`, `document_approvals` are zero-authenticated-grant: read via the admin client behind `requireRole(LEGAL_ROLES)`, never on a site_admin-reachable screen, audited.
- **Ship via the fence.** `scripts/ship-pr.sh` opens the PR. Schema / `src/lib/auth/**` / RLS Tasks (U0, U1, U3, U4) trip the danger-path guard → **operator-held merge**. Code-only Tasks (U2, U5) auto-merge on green.
- **Conventional Commits** (`feat:`, `test:`, `docs:`). SSOT: user-facing strings in `src/lib/i18n/labels.ts`; role-sets in `src/lib/auth/role-home.ts`.

## Canonical names (shared interface contract — used across Tasks)

- `departments(id uuid pk, key text unique, name_th text, name_en text, is_active bool, head_user_id uuid null→users, sort_order int, created_at)`.
- `users.department_id uuid null → departments(id) on delete set null`.
- RPCs (all DEFINER, `super_admin`, anon-revoked): `create_department(p_key,p_name_th,p_name_en,p_sort_order)`, `set_department_head(p_department uuid, p_head_user uuid)`, `set_user_department(p_user uuid, p_department uuid)`.
- Enum: `user_role` gains `'legal'`. `LEGAL_ROLES = ['legal','super_admin']`; `DOC_APPROVAL_ROLES = LEGAL_ROLES`; `roleHome('legal') → '/legal'`; `USER_ROLE_LABEL.legal = 'ฝ่ายกฎหมาย'`.
- `contracts(...)` + enums `contract_counterparty_type`, `contract_type`, `contract_status`; `contract_attachments` (append-only + supersede). RPCs `create_contract`, `update_contract`, `void_contract`, `add_contract_attachment` (DEFINER, `LEGAL_ROLES`).
- `document_approvals(id, contract_id→contracts, target_type enum, decision enum, comment not null, actor_id, created_at)`; RPC `submit_document_decision(p_contract_id, p_decision, p_comment)` (DEFINER, `DOC_APPROVAL_ROLES`).
- TS: `buildOrgChart(departments, users)` in `src/lib/org/org-chart.ts`. Surfaces `/settings/org-chart`, `/legal`, `/legal/contracts`, `/legal/approvals`.

## File structure

- `supabase/migrations/20260813075490_spec284u0_departments.sql` — departments table, `users.department_id`, RLS, seed, RPCs.
- `supabase/migrations/20260813075500_spec284u1_legal_role.sql` — `ADD VALUE 'legal'` (own migration).
- `supabase/migrations/20260813075510_spec284u3_contracts.sql` — contracts + attachments + enums + RLS + RPCs.
- `supabase/migrations/20260813075520_spec284u4_document_approvals.sql` — document_approvals + enum + RLS + RPC.
- `supabase/tests/database/<NN>-spec284-*.test.sql` — one pgTAP file per schema Task.
- `src/lib/auth/role-home.ts` — `LEGAL_ROLES`, `DOC_APPROVAL_ROLES`, `roleHome`, `LEGAL_HUB_NAV`, `LEGAL_TABS` (U1).
- `src/lib/i18n/labels.ts` — `USER_ROLE_LABEL.legal`, static org strings (U1/U2).
- `src/lib/org/org-chart.ts` + `src/app/settings/org-chart/page.tsx` — org-chart read (U2).
- `src/app/registrations/…` — dept filter (U2).
- `src/lib/legal/*.ts` + `src/app/legal/**` — Legal server actions + surfaces (U3/U4/U5).

---

### Task U0: `departments` table (open data, non-gating)

**Files:**

- Create: `supabase/migrations/20260813075490_spec284u0_departments.sql`
- Create: `supabase/tests/database/<NN>-spec284u0-departments.test.sql`
- Modify: `src/lib/i18n/labels.ts` (static strings แผนก / หัวหน้าแผนก only)

**Interfaces:**

- Produces: `departments` table + seed; `users.department_id`; RPCs `create_department`, `set_department_head`, `set_user_department`. Consumed by U2 (read) and U1 (legal dept already seeded).

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- <NN>-spec284u0-departments.test.sql
begin;
select plan(7);

-- table + columns exist
select has_table('public','departments','departments table exists');
select has_column('public','users','department_id','users.department_id exists');

-- seed: 8 rows, 6 active, legal present + active
select is( (select count(*)::int from departments), 8, '8 seeded departments');
select is( (select count(*)::int from departments where is_active), 6, '6 active');
select is( (select is_active from departments where key='legal'), true, 'legal seeded active');

-- label-only invariant: no RLS policy references department_id
select is(
  (select count(*)::int from pg_policies
   where schemaname='public' and qual like '%department_id%'),
  0, 'no policy keys off department_id (label-only)');

-- anon cannot read departments
set local role anon;
select is( (select count(*)::int from departments), 0, 'anon sees no departments (revoked)');
reset role;

select * from finish();
rollback;
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm db:test` (after `pnpm db:push` of an empty-stub migration is NOT yet done — expect failure: relation "departments" does not exist)
Expected: FAIL (`departments` missing).

- [ ] **Step 3: Write the migration**

```sql
-- 20260813075490_spec284u0_departments.sql
-- Spec 284 U0 / ADR 0080 — departments as open, non-gating org data.
create table public.departments (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,
  name_th      text not null,
  name_en      text not null,
  is_active    boolean not null default true,
  head_user_id uuid references public.users(id) on delete set null,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.departments enable row level security;

-- read-only reference for signed-in users; NO write policy (writes go via DEFINER RPCs)
create policy departments_select on public.departments
  for select to authenticated using (true);
revoke all on public.departments from anon;

alter table public.users
  add column department_id uuid references public.departments(id) on delete set null;

insert into public.departments (key, name_th, name_en, is_active, sort_order) values
  ('executive','ผู้บริหาร','Executive',true,10),
  ('pmo','บริหารโครงการ','Project Management',true,20),
  ('procurement','จัดซื้อ','Procurement',true,30),
  ('accounting','บัญชี','Accounting',true,40),
  ('site','หน้างาน','Site Operations',true,50),
  ('legal','กฎหมาย','Legal',true,60),
  ('hr','บุคคล','Human Resources',false,70),
  ('subcon_mgmt','บริหารผู้รับเหมาช่วง','Subcontractor Management',false,80);

-- writes: super_admin only, via DEFINER RPCs (anon/public revoked)
create or replace function public.create_department(
  p_key text, p_name_th text, p_name_en text, p_sort_order int default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.departments(key,name_th,name_en,sort_order)
    values (p_key,p_name_th,p_name_en,p_sort_order) returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_department_head(p_department uuid, p_head_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.departments set head_user_id = p_head_user where id = p_department;
end $$;

create or replace function public.set_user_department(p_user uuid, p_department uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_user_role() <> 'super_admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.users set department_id = p_department where id = p_user;
end $$;

revoke execute on function public.create_department(text,text,text,int) from anon, public;
revoke execute on function public.set_department_head(uuid,uuid) from anon, public;
revoke execute on function public.set_user_department(uuid,uuid) from anon, public;
```

- [ ] **Step 4: Apply + regenerate types + run tests**

Run: `pnpm db:push && pnpm db:types && pnpm db:test`
Expected: the new pgTAP file PASSES 7/7; full suite green except the known pre-existing reds (200/221). `git diff` on `database.types.ts` shows `departments` + `users.department_id`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260813075490_spec284u0_departments.sql \
        supabase/tests/database/*spec284u0*.sql src/lib/db/database.types.ts src/lib/i18n/labels.ts
git commit -m "feat: departments as open org data (spec 284 U0)"
```

Ship via `scripts/ship-pr.sh` → **operator-held** (additive migration = danger-path).

---

### Task U1: `legal` auth-role (danger-path, operator-held)

**Files:**

- Create: `supabase/migrations/20260813075500_spec284u1_legal_role.sql`
- Modify: `supabase/tests/database/01-users.test.sql` (enum pin 16 → 17)
- Modify: `src/lib/auth/role-home.ts`, `src/lib/i18n/labels.ts`
- Modify/Test: `tests/unit/role-sets.test.ts`

**Interfaces:**

- Consumes: `departments` seed (legal row exists, U0).
- Produces: enum value `legal`; `LEGAL_ROLES`, `DOC_APPROVAL_ROLES`, `roleHome('legal')`, `LEGAL_HUB_NAV`, `LEGAL_TABS`. Consumed by U3/U4 (gates) and U5 (surfaces).

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/unit/role-sets.test.ts (add)
import { LEGAL_ROLES, DOC_APPROVAL_ROLES, roleHome } from "@/lib/auth/role-home";

test("LEGAL_ROLES = legal + super_admin", () => {
  expect([...LEGAL_ROLES].sort()).toEqual(["legal", "super_admin"]);
});
test("DOC_APPROVAL_ROLES equals LEGAL_ROLES in v1", () => {
  expect([...DOC_APPROVAL_ROLES].sort()).toEqual(["legal", "super_admin"]);
});
test("legal lands on /legal", () => {
  expect(roleHome("legal")).toBe("/legal");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm exec vitest run tests/unit/role-sets.test.ts`
Expected: FAIL (`LEGAL_ROLES` undefined; `roleHome('legal')` not `/legal`).

- [ ] **Step 3: Write the enum migration (own migration, committed before use)**

```sql
-- 20260813075500_spec284u1_legal_role.sql
-- Spec 284 U1 / ADR 0080 dec 5 — the ONE new auth-role for the Legal department.
-- OWN migration: Postgres forbids USING a new enum value in the txn that ADDs it.
alter type public.user_role add value if not exists 'legal';
```

- [ ] **Step 4: Wire auth SSOT + labels + pin**

```ts
// src/lib/auth/role-home.ts (add)
export const LEGAL_ROLES = ["legal", "super_admin"] as const;
export const DOC_APPROVAL_ROLES = LEGAL_ROLES; // v1: same; widen later without touching Legal gates
// in roleHome(): case 'legal': return '/legal'
// add LEGAL_HUB_NAV (contracts, approvals) + LEGAL_TABS; wire into hubNavForRole()/tabsForRole()
```

```ts
// src/lib/i18n/labels.ts
USER_ROLE_LABEL.legal = "ฝ่ายกฎหมาย";
```

```sql
-- supabase/tests/database/01-users.test.sql — bump the pinned enum list to 17 values, adding 'legal'
```

- [ ] **Step 5: Apply, regen, run all tests**

Run: `pnpm db:push && pnpm db:types && pnpm db:test && pnpm exec vitest run tests/unit/role-sets.test.ts && pnpm lint && pnpm typecheck`
Expected: enum pin PASSES 17 values; role-sets PASS; lint/typecheck green.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260813075500_spec284u1_legal_role.sql \
        supabase/tests/database/01-users.test.sql src/lib/auth/role-home.ts \
        src/lib/i18n/labels.ts src/lib/db/database.types.ts tests/unit/role-sets.test.ts
git commit -m "feat: add legal auth-role + LEGAL_ROLES/nav (spec 284 U1)"
```

Ship → **operator-held** (enum + `src/lib/auth/**`).

---

### Task U2: Org-chart read + registrations dept filter (code-only, the "real consumer")

**Files:**

- Create: `src/lib/org/org-chart.ts`, `src/app/settings/org-chart/page.tsx`
- Modify: settings-hub sections SSOT (add the org-chart card), `src/app/registrations/*` (add `?dept=` facet)
- Test: `tests/unit/org-chart.test.ts`

**Interfaces:**

- Consumes: `departments` (U0), `users.department_id` (U0).
- Produces: `buildOrgChart(departments, users): OrgChartDept[]` where `OrgChartDept = { key; nameTh; head?: {id;name}; members: {id;name}[] }`.

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/unit/org-chart.test.ts
import { buildOrgChart } from "@/lib/org/org-chart";

const depts = [
  {
    id: "d1",
    key: "legal",
    name_th: "กฎหมาย",
    is_active: true,
    head_user_id: "u1",
    sort_order: 60,
  },
  { id: "d2", key: "hr", name_th: "บุคคล", is_active: false, head_user_id: null, sort_order: 70 },
];
const users = [
  { id: "u1", display_name: "สมชาย", department_id: "d1" },
  { id: "u2", display_name: "สมหญิง", department_id: "d1" },
];

test("groups members, resolves head, hides inactive, orders by sort_order", () => {
  const chart = buildOrgChart(depts, users);
  expect(chart.map((d) => d.key)).toEqual(["legal"]); // hr inactive → hidden
  expect(chart[0].head?.name).toBe("สมชาย");
  expect(chart[0].members.map((m) => m.id).sort()).toEqual(["u1", "u2"]);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm exec vitest run tests/unit/org-chart.test.ts`
Expected: FAIL (`buildOrgChart` not defined).

- [ ] **Step 3: Implement the pure builder**

```ts
// src/lib/org/org-chart.ts
type Dept = {
  id: string;
  key: string;
  name_th: string;
  is_active: boolean;
  head_user_id: string | null;
  sort_order: number;
};
type U = { id: string; display_name: string; department_id: string | null };
export type OrgChartDept = {
  key: string;
  nameTh: string;
  head?: { id: string; name: string };
  members: { id: string; name: string }[];
};

export function buildOrgChart(depts: Dept[], users: U[]): OrgChartDept[] {
  return depts
    .filter((d) => d.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((d) => {
      const members = users
        .filter((u) => u.department_id === d.id)
        .map((u) => ({ id: u.id, name: u.display_name }));
      const headUser = users.find((u) => u.id === d.head_user_id);
      return {
        key: d.key,
        nameTh: d.name_th,
        head: headUser && { id: headUser.id, name: headUser.display_name },
        members,
      };
    });
}
```

- [ ] **Step 4: Run it, verify it passes; build the page + registrations facet**

Run: `pnpm exec vitest run tests/unit/org-chart.test.ts` → PASS.
Then: `src/app/settings/org-chart/page.tsx` (Server Component, `requireRole(back-office + super_admin)`, reads departments + users via the RLS server client, renders `buildOrgChart` as one card per dept with DetailHeader back-nav); add the org-chart card to the settings-hub sections SSOT; add an optional `?dept=<key>` facet to the `/registrations` queue (narrow rows whose target role maps to that department; deep-linkable, mirrors the existing status facet). Add a test asserting the facet narrows + is deep-linkable.

- [ ] **Step 5: Commit**

```bash
git add src/lib/org/org-chart.ts src/app/settings/org-chart/ src/app/registrations/ \
        tests/unit/org-chart.test.ts   # + settings-hub sections file
git commit -m "feat: org-chart read + registrations dept filter (spec 284 U2)"
```

Code-only → **auto-merges on green**. Run design-doctrine + nav-back guards locally first.

---

### Task U3: Contracts (Legal money/document posture)

**Files:**

- Create: `supabase/migrations/20260813075510_spec284u3_contracts.sql`, `supabase/tests/database/<NN>-spec284u3-contracts.test.sql`
- Create: `src/lib/legal/contracts.ts` (server actions)

**Interfaces:**

- Consumes: `LEGAL_ROLES` (U1), `projects` (existing).
- Produces: `contracts`, `contract_attachments`; RPCs `create_contract`, `update_contract`, `void_contract`, `add_contract_attachment`. Consumed by U4 (approve transitions status) and U5 (UI).

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- <NN>-spec284u3-contracts.test.sql
begin;
select plan(5);
select has_table('public','contracts','contracts exists');
select has_column('public','contracts','counterparty_name','denormalized name (no mixed-content id)');
select hasnt_column('public','contracts','counterparty_id','no mixed-content counterparty_id');
-- anon cannot read; non-legal cannot execute create_contract
set local role anon;
select is((select count(*)::int from contracts), 0, 'anon sees no contracts');
reset role;
select throws_ok($$ select public.create_contract('client','ACME',null,'client_agreement','MSA',null) $$,
  '42501', null, 'unprivileged create_contract forbidden');
select * from finish();
rollback;
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm db:test`
Expected: FAIL (`contracts` missing).

- [ ] **Step 3: Write the migration (enums, table, attachments, RLS, RPCs)**

```sql
-- 20260813075510_spec284u3_contracts.sql — Spec 284 U3 / ADR 0080 dec 10.
create type public.contract_counterparty_type as enum ('client','contractor','supplier','other');
create type public.contract_type as enum ('client_agreement','subcontract','supply','nda','other');
create type public.contract_status as enum ('draft','active','expired','terminated','void');

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  counterparty_type public.contract_counterparty_type not null,
  counterparty_name text not null,                 -- denormalized; NO mixed-content FK (CLAUDE.md L22)
  project_id uuid references public.projects(id),
  contract_type public.contract_type not null,
  title text not null,
  agreed_amount numeric(14,2),
  currency text not null default 'THB',
  sign_date date, effective_date date, expiry_date date,
  status public.contract_status not null default 'draft',
  document_path text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
alter table public.contracts enable row level security;
revoke all on public.contracts from anon, authenticated;      -- zero-grant; reads via admin client only

create table public.contract_attachments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),
  storage_path text not null,
  uploaded_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  superseded_by uuid references public.contract_attachments(id)   -- append-only + supersede
);
alter table public.contract_attachments enable row level security;
revoke all on public.contract_attachments from anon, authenticated;

-- DEFINER RPCs, LEGAL_ROLES-gated, anon/public revoked. (create/update/void/add_attachment)
create or replace function public.create_contract(
  p_counterparty_type public.contract_counterparty_type, p_counterparty_name text,
  p_project_id uuid, p_contract_type public.contract_type, p_title text, p_agreed_amount numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.current_user_role() not in ('legal','super_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.contracts(counterparty_type,counterparty_name,project_id,contract_type,title,agreed_amount,created_by)
    values (p_counterparty_type,p_counterparty_name,p_project_id,p_contract_type,p_title,p_agreed_amount, auth.uid())
    returning id into v_id;
  return v_id;
end $$;
-- update_contract(p_id, …), void_contract(p_id) [sets status='void', never DELETE],
-- add_contract_attachment(p_contract_id, p_path) — same guard shape.
revoke execute on function public.create_contract(public.contract_counterparty_type,text,uuid,public.contract_type,text,numeric) from anon, public;
-- (repeat revoke for update_contract / void_contract / add_contract_attachment)
```

- [ ] **Step 4: Apply, regen, test**

Run: `pnpm db:push && pnpm db:types && pnpm db:test`
Expected: `spec284u3` PASSES 5/5. Write `src/lib/legal/contracts.ts` server actions calling the RPCs via the **admin client** (zero-grant) behind `requireRole(LEGAL_ROLES)`; add a vitest that a non-legal caller is rejected before the RPC.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260813075510_spec284u3_contracts.sql \
        supabase/tests/database/*spec284u3*.sql src/lib/db/database.types.ts src/lib/legal/contracts.ts
git commit -m "feat: contracts table + RPCs on Legal money posture (spec 284 U3)"
```

Ship → **operator-held** (schema + money).

---

### Task U4: Document approval (generalized `approvals`, typed FK)

**Files:**

- Create: `supabase/migrations/20260813075520_spec284u4_document_approvals.sql`, `supabase/tests/database/<NN>-spec284u4-document-approvals.test.sql`
- Create: `src/lib/legal/approvals.ts`

**Interfaces:**

- Consumes: `contracts` (U3), `DOC_APPROVAL_ROLES` (U1).
- Produces: `document_approvals`; RPC `submit_document_decision(p_contract_id, p_decision, p_comment)`. Consumed by U5 (queue UI).

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- <NN>-spec284u4-document-approvals.test.sql
begin;
select plan(4);
select has_table('public','document_approvals','document_approvals exists');
select col_not_null('public','document_approvals','comment','comment required');
-- append-only: UPDATE raises
select throws_ok($$ update public.document_approvals set comment='x' $$, null, null, 'append-only: UPDATE blocked');
-- unprivileged decision forbidden
select throws_ok($$ select public.submit_document_decision(gen_random_uuid(),'approve','ok') $$,
  '42501', null, 'unprivileged decision forbidden');
select * from finish();
rollback;
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm db:test` → FAIL (`document_approvals` missing).

- [ ] **Step 3: Write the migration**

```sql
-- 20260813075520_spec284u4_document_approvals.sql — Spec 284 U4.
create type public.document_target_type as enum ('contract');   -- widen (+ typed FK) when a 2nd target appears
create type public.document_decision as enum ('approve','reject','needs_revision');

create table public.document_approvals (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),     -- TYPED FK (no mixed-content target_id)
  target_type public.document_target_type not null default 'contract',
  decision public.document_decision not null,
  comment text not null,
  actor_id uuid references public.users(id),
  created_at timestamptz not null default now()
);
alter table public.document_approvals enable row level security;
revoke all on public.document_approvals from anon, authenticated;

-- append-only guard (mirror approvals): block UPDATE/DELETE
create or replace function public.document_approvals_freeze() returns trigger
  language plpgsql as $$ begin raise exception 'document_approvals is append-only'; end $$;
create trigger document_approvals_no_mutation
  before update or delete on public.document_approvals
  for each row execute function public.document_approvals_freeze();

create or replace function public.submit_document_decision(
  p_contract_id uuid, p_decision public.document_decision, p_comment text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.current_user_role() not in ('legal','super_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.document_approvals(contract_id,decision,comment,actor_id)
    values (p_contract_id,p_decision,p_comment, auth.uid()) returning id into v_id;
  if p_decision = 'approve' then
    update public.contracts set status='active' where id=p_contract_id and status='draft';
  end if;
  return v_id;
end $$;
revoke execute on function public.submit_document_decision(uuid,public.document_decision,text) from anon, public;
```

- [ ] **Step 4: Apply, regen, test**

Run: `pnpm db:push && pnpm db:types && pnpm db:test`
Expected: `spec284u4` PASSES 4/4. Add `src/lib/legal/approvals.ts` server action (admin client, `requireRole(DOC_APPROVAL_ROLES)`) + a vitest that approve transitions a draft contract to active.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260813075520_spec284u4_document_approvals.sql \
        supabase/tests/database/*spec284u4*.sql src/lib/db/database.types.ts src/lib/legal/approvals.ts
git commit -m "feat: document_approvals + submit_document_decision (spec 284 U4)"
```

Ship → **operator-held** (schema + RLS).

---

### Task U5: Legal surfaces (`/legal` home + contracts + approvals queue)

**Files:**

- Create: `src/app/legal/page.tsx`, `src/app/legal/contracts/page.tsx`, `src/app/legal/approvals/page.tsx` (+ feature components)
- Test: `tests/unit/legal-*.test.tsx`, optional `tests/e2e/legal.spec.ts`

**Interfaces:**

- Consumes: `LEGAL_ROLES`/`roleHome`/nav (U1), `src/lib/legal/contracts.ts` (U3), `src/lib/legal/approvals.ts` (U4).
- Produces: the Legal role's home + working surfaces.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/legal-home.test.tsx — Legal home renders counts + entry cards for a legal user
import { render, screen } from "@testing-library/react";
import LegalHome from "@/app/legal/page";
test("legal home shows contracts + approvals entries", async () => {
  render(
    await LegalHome({
      /* mocked counts */
    }),
  );
  expect(screen.getByText(/สัญญา/)).toBeInTheDocument();
  expect(screen.getByText(/รออนุมัติ/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm exec vitest run tests/unit/legal-home.test.tsx`
Expected: FAIL (`/legal` page not created).

- [ ] **Step 3: Build the three surfaces**

`/legal` (`requireRole(LEGAL_ROLES)`): counts (active contracts, pending approvals) + entry cards, DetailHeader. `/legal/contracts`: list (status facets) + create form + detail (attachments, void) wiring U3 actions. `/legal/approvals`: a queue mirroring `/registrations` — pending contracts (`draft`/`needs_revision`) → approve/reject/needs_revision with a **required comment**, calling U4's `submit_document_decision`. All strings via `labels.ts`.

- [ ] **Step 4: Run tests + guards + real-browser check**

Run: `pnpm exec vitest run tests/unit/legal-* && pnpm lint && pnpm typecheck && pnpm test`
Then verify in a real browser via the dev-preview login as a `legal` user (lands on `/legal`, can create a contract, approve moves it to active). Run the design-doctrine + nav-back-affordance guards.

- [ ] **Step 5: Commit**

```bash
git add src/app/legal/ src/lib/i18n/labels.ts tests/unit/legal-*.test.tsx
git commit -m "feat: Legal surfaces — home, contracts, approvals queue (spec 284 U5)"
```

Code-only → **auto-merges on green**.

---

## Self-Review (run against spec 284)

**Spec coverage:** U0 = departments table + seed + `users.department_id` + RPCs ✅ · U1 = `legal` role + LEGAL_ROLES/nav/label + pin ✅ · U2 = org-chart read + registrations dept filter (the "real consumer") ✅ · U3 = contracts + attachments + RPCs (money posture) ✅ · U4 = document_approvals (typed FK, append-only, approve→active) ✅ · U5 = `/legal` home + contracts + approvals queue ✅. Phase 2 (positions) + phase 3 (office seam, dept-scoped RLS, permits/disputes) are explicitly out of this plan.

**Placeholder scan:** RPC bodies for `update_contract`/`void_contract`/`add_contract_attachment` are described by shape, not fully spelled — expand each to the `create_contract` guard shape at build (noted inline). pgTAP file `NN-` prefixes are confirmed against `origin/main` at build (environmental fact). No other TODO/TBD.

**Type consistency:** `LEGAL_ROLES`/`DOC_APPROVAL_ROLES`, `current_user_role()` guard, `create_department`/`set_user_department`/`create_contract`/`submit_document_decision`, and `buildOrgChart` signatures are used identically across the Tasks that consume them.

**House-rule check:** no mixed-content FK (`contracts.counterparty_name` denormalized; `document_approvals.contract_id` typed) · enums for all status · RLS on every table · anon revoked on every DEFINER RPC · TDD-first · one unit per session · schema Tasks operator-held.
