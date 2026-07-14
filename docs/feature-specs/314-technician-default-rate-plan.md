# Technician default pay + level-standard rate (with WHT) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use the repo **`ship-unit`** skill for EVERY unit — it carries the binding gates (lane claim, dependency gate-check, RED-first, real-flow verify, fresh-eyes review, proved merge). Steps use checkbox (`- [ ]`) syntax.

**Goal:** New technicians default to `daily` (รายวัน) pay and inherit the firm's PM-maintained standard day-rate for their skill level (stored gross); payroll computes and shows gross / WHT / net from a WHT % frozen at log time.

**Architecture:** A firm-wide `worker_level_rates` table (one row per `worker_level`, PM-edited, seeded blank rate + per-level WHT basis) plus a `labor_wht_config` singleton (firm WHT %, seeded 3.00). A DEFINER helper `level_gross_rate(level)` grosses-up net rates. Worker `day_rate` (always gross) auto-fills from the standard at the existing `confirm_worker_cost` money gate. `labor_logs` freezes the firm WHT % per row; `payroll.ts` splits the frozen gross into WHT/net.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + RLS, pgTAP, Vitest/RTL, TypeScript strict.

## Global Constraints (verbatim from spec 314 + CLAUDE.md)

- **Spec:** `docs/feature-specs/314-technician-default-rate.md`. Implement exactly it; no scope creep. U5 (GL posting) is **out of scope** — a later spec.
- **TDD, RED-first:** the first change in each unit is the failing test, seen to fail, before implementation.
- **Schema is single-lane.** Claim the lane in `../LANES.md` before any `supabase/migrations/` write (hook-enforced). **Do not hardcode the number** — at each schema unit's start read the `../LANES.md` STATUS line + live head and take the next-free number. Live head at plan time = `075783`; U1 filename uses `075784`, U3 uses `075785` as placeholders — rename to the live next-free at build.
- **Every table has RLS enabled.** New tables = RLS on. **Money columns get NO `authenticated` grant** — service-role read only, like `workers.day_rate` / `labor_logs.day_rate_snapshot`. Money = `worker_level_rates.entered_rate`, `labor_wht_config.wht_pct`, `labor_logs.wht_pct_snapshot`.
- **Status/basis fields are Postgres enums.** New enum `public.wht_basis`. Never free-text.
- **`labor_logs` is append-only** (supersede pattern, ADR 0004/0009/0015). Corrections insert a new row copying snapshots — never UPDATE. See the `supersede-pattern` skill.
- **Immutability:** `day_rate_snapshot` (gross) and the new `wht_pct_snapshot` are frozen at log time; a later config change never restates a worked day.
- **ADR 0060 anti-self-dealing preserved:** the standard rate is authored by the procurement manager (disinterested), not self-set. **New ADR 0082** records the level-standard-rate + WHT compute model — write it in U1.
- **Every DEFINER RPC:** `security definer`, `set search_path = public`, `revoke execute ... from anon`, audited to `audit_log`. (Spec 284 lesson: a DEFINER RPC left executable by `anon` is a hole.)
- **Money-set gate:** rate/config writes = `procurement_manager` + `super_admin` only.
- **Ship via `scripts/ship-pr.sh`** (branch → PR → auto-merge on green).
  - **U1** = additive migration → danger-path guard flags it, but **additive migrations are self-mergeable on green under the standing grant** (admin-merge past the guard). Self-merge OK.
  - **U2** touches `labels.ts` (shared SSOT) + reads money via service-role → **verify the danger-path guard verdict; likely operator-held** (service-role money read). Do not self-merge if the guard flags it.
  - **U3** = migration + replaces of money/labor RPCs (`confirm_worker_cost`, `log_labor_day`, `correct_labor_log`, `approve_crew_registration`) → **danger-path, operator-held.**
  - **U4** = `payroll.ts` + payroll page (payroll = money) → **danger-path, operator-held.**
- **Machine quirks:** `cd` in every Bash command; prefix `export PATH="/c/Program Files/nodejs:$PATH"` for node/pnpm; Thai text only via Write/Edit (never PowerShell); live DB query = `pnpm exec supabase db query --linked` (stdin heredoc); a fresh worktree needs `.env.local` + `pnpm install`.
- **Known pgTAP reds:** `200-store`(3) + `221-catalog`(1) ONLY — any other red is collateral to fix.

---

## Pre-flight (once, before Task 1)

Worktree `../prc-ops-laborrate` on branch `spec314-technician-default-rate` (off `a661f265`/0.73.0) already exists; lane claimed in `../LANES.md`; spec + this plan committed in it. Remaining:

- [ ] **Install deps in the worktree:**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-laborrate" && cp ../prc-ops/.env.local . 2>/dev/null; export PATH="/c/Program Files/nodejs:$PATH" && pnpm install
```

- [ ] **Gate the schema lane.** Read `../LANES.md` whole. Proceed to U1 only when the schema lane is FREE. Take the live next-free number:

```bash
cd "D:/claude/projects/prc-ops/prc-ops-laborrate" && ls supabase/migrations/ | sort | tail -1
```

Use `(that number) + 1` for U1's migration filename; update the LANES claim.

- [ ] **Dependency gate-check — read the LIVE forms before building on them** (CLAUDE.md gate 2). Migration files may be stale; the live DB is truth:

```bash
cd "D:/claude/projects/prc-ops/prc-ops-laborrate" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm exec supabase db query --linked <<'SQL'
-- worker_level enum values (seed must cover all)
select enum_range(null::public.worker_level);
-- pay_type enum
select enum_range(null::public.pay_type);
-- the four RPCs U3 amends — capture their EXACT current bodies + signatures
select pg_get_functiondef('public.confirm_worker_cost(uuid,public.worker_level)'::regprocedure);
select pg_get_functiondef('public.log_labor_day'::regproc);
select pg_get_functiondef('public.correct_labor_log'::regproc);
select pg_get_functiondef('public.approve_crew_registration'::regprocedure);
-- workers.pay_type current default; labor_logs authenticated grant is column-scoped (new col must NOT auto-grant)
select column_name, column_default from information_schema.columns where table_name='workers' and column_name='pay_type';
select grantee, privilege_type from information_schema.column_privileges where table_name='labor_logs' and grantee='authenticated' and column_name='day_rate_snapshot';
-- audit_log.target_id nullability (config rows have no uuid PK)
select is_nullable from information_schema.columns where table_name='audit_log' and column_name='target_id';
-- helper existence
select proname from pg_proc where proname in ('current_user_role','current_user_worker_id');
SQL
```

Confirm: `worker_level` = `{senior,mid,junior,apprentice}` (if it grew, U1 seed + pgTAP must cover the new value); `log_labor_day`/`correct_labor_log` live bodies already snapshot `pay_type_snapshot` + `day_rate_snapshot` (source of the CREATE OR REPLACE in U3); the `labor_logs` authenticated grant is **column-scoped** (so a new column is zero-grant by default). Note `audit_log.target_id` nullability — U1/U3 audit inserts use `null` target_id for config-table events **only if nullable**; otherwise pass the worker/actor id per event.

- [ ] **Confirm `round2` in the money SSOT:**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-laborrate" && grep -nE 'export (function|const) round2' src/lib/format.ts
```

Expected: a `round2(n: number): number` (banker/2-dp). If the name differs, use the live name in U4.

---

## Task 1 (Unit U1) — Schema, config, RPCs, ADR 0082 _(additive migration; self-merge on green)_

**Files:**

- Create: `supabase/migrations/20260813075784_spec314u1_level_rates.sql` _(rename to live next-free)_
- Create: `supabase/tests/database/314-level-rates.test.sql`
- Create: `docs/decisions/0082-level-standard-rate-wht.md` + add its row to `docs/decisions/README.md`
- Modify: `src/lib/db/database.types.ts` (regenerated via `pnpm db:types`, never hand-edited)
- Modify (if the grep in Step 6 finds them): any pgTAP enum-pin file listing public enum types

**Interfaces produced (later units rely on these EXACT names):**

- Enum `public.wht_basis = ('before_wht','after_wht')`.
- Table `public.worker_level_rates(level worker_level PK, entered_rate numeric(10,2) null, wht_basis wht_basis not null default 'after_wht', active boolean not null default true, updated_by uuid, updated_at timestamptz)`.
- Table `public.labor_wht_config(id boolean PK default true check(id), wht_pct numeric(5,2) null, updated_by uuid, updated_at timestamptz)` — one seeded row `wht_pct = 3.00`.
- RPC `set_level_rate(p_level worker_level, p_entered_rate numeric, p_basis wht_basis) returns void`.
- RPC `set_labor_wht_pct(p_pct numeric) returns void`.
- Helper `level_gross_rate(p_level worker_level) returns numeric` (gross per basis + firm %; NULL if rate unset).

- [ ] **Step 1 — Write the failing pgTAP test.** Create `supabase/tests/database/314-level-rates.test.sql`, standard form (`begin; select plan(N); … select * from finish(); rollback;`). Seed a `procurement_manager` actor and a non-money actor (reuse the role-switch idiom in `supabase/tests/database/281-sa-add-project-worker.test.sql`). Cover:

```sql
-- SEED / basis
-- 1) seed present: exactly 4 rows in worker_level_rates; basis senior='before_wht', mid='before_wht',
--    junior='after_wht', apprentice='after_wht'; all entered_rate IS NULL.
-- 2) labor_wht_config has exactly ONE row and wht_pct = 3.00.
-- ZERO-GRANT (money columns unreadable by authenticated)
-- 3) set local role authenticated; select entered_rate from worker_level_rates  -> 42501.
-- 4) set local role authenticated; select wht_pct from labor_wht_config          -> 42501.
-- 5) set local role authenticated; select level, wht_basis from worker_level_rates -> OK (non-money grant).
-- GATES
-- 6) set_level_rate as a non-(pm/super) role -> 42501; row unchanged.
-- 7) set_labor_wht_pct as a non-(pm/super) role -> 42501.
-- 8) set_level_rate(..., -5, ...) -> P0001. set_labor_wht_pct(120) -> P0001. set_labor_wht_pct(-1) -> P0001.
-- WRITE + AUDIT
-- 9) set_level_rate('senior', 1000, 'before_wht') as procurement_manager: entered_rate=1000, basis='before_wht',
--    updated_by=actor; writes one audit_log row (action, target_table='worker_level_rates').
-- 10) set_labor_wht_pct(5.00) as super_admin: labor_wht_config.wht_pct=5.00 (still one row).
-- GROSS-UP MATH (level_gross_rate)
-- 11) rate unset -> level_gross_rate('senior') IS NULL.
-- 12) basis before_wht, entered 1000 -> level_gross_rate = 1000 (pct irrelevant).
-- 13) basis after_wht, entered 970, wht_pct 3.00 -> level_gross_rate = 1000.00 (970 / 0.97, round 2).
-- 14) basis after_wht, wht_pct NULL (clear it first) -> gross = entered (0% gross-up), not error/NULL.
```

Write concrete assertions (`throws_ok`, `results_eq`, `is`, `bag_eq`).

- [ ] **Step 2 — Run it, verify RED.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-laborrate" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:test supabase/tests/database/314-level-rates.test.sql
```

Expected: FAIL (relation/function does not exist).

- [ ] **Step 3 — Write the migration.** Create `supabase/migrations/20260813075784_spec314u1_level_rates.sql`:

```sql
-- Spec 314 U1 / ADR 0082 — firm-wide level-standard labor rates + WHT compute config.
-- Additive. Money columns (entered_rate, wht_pct) get ZERO authenticated grant — service-role
-- read only, like workers.day_rate. Rate is stored/derived GROSS; wht_basis is consumed once at
-- gross-up time. Writes are PM/super DEFINER-only.

create type public.wht_basis as enum ('before_wht', 'after_wht');

-- ---- worker_level_rates (firm-wide standard, one row per level) --------------
create table public.worker_level_rates (
  level        public.worker_level primary key,
  entered_rate numeric(10,2) constraint worker_level_rates_rate_nonneg check (entered_rate is null or entered_rate >= 0),
  wht_basis    public.wht_basis not null default 'after_wht',
  active       boolean not null default true,
  updated_by   uuid references public.users (id),
  updated_at   timestamptz not null default now()
);
alter table public.worker_level_rates enable row level security;
-- Non-money columns readable; entered_rate NOT granted (mirrors workers.day_rate posture).
grant select (level, wht_basis, active, updated_at) on public.worker_level_rates to authenticated;
create policy worker_level_rates_read on public.worker_level_rates for select to authenticated using (true);
revoke all on public.worker_level_rates from anon;

-- Seed one row per CURRENT worker_level value; rate NULL (PM fills); basis per operator (2026-07-13).
insert into public.worker_level_rates (level, wht_basis) values
  ('senior','before_wht'), ('mid','before_wht'),
  ('junior','after_wht'),  ('apprentice','after_wht');

-- ---- labor_wht_config (firm-wide WHT %, singleton) --------------------------
create table public.labor_wht_config (
  id         boolean primary key default true constraint labor_wht_config_singleton check (id),
  wht_pct    numeric(5,2) constraint labor_wht_config_pct_range check (wht_pct is null or (wht_pct >= 0 and wht_pct < 100)),
  updated_by uuid references public.users (id),
  updated_at timestamptz not null default now()
);
alter table public.labor_wht_config enable row level security;
-- Money-adjacent: NO authenticated grant → RLS + no policy = service-role only reads.
revoke all on public.labor_wht_config from anon, authenticated;
insert into public.labor_wht_config (id, wht_pct) values (true, 3.00);

-- ---- level_gross_rate(level) : entered_rate grossed-up per basis + firm % ----
create function public.level_gross_rate(p_level public.worker_level)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.entered_rate is null then null
    when r.wht_basis = 'before_wht' then r.entered_rate
    else round(r.entered_rate / (1 - coalesce(c.wht_pct, 0) / 100), 2)
  end
  from public.worker_level_rates r
  cross join (select wht_pct from public.labor_wht_config where id = true) c
  where r.level = p_level;
$$;
revoke all on function public.level_gross_rate(public.worker_level) from public, anon;

-- ---- set_level_rate (PM/super) ---------------------------------------------
create function public.set_level_rate(p_level public.worker_level, p_entered_rate numeric, p_basis public.wht_basis)
returns void language plpgsql security definer set search_path = public as $$
declare v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role not in ('procurement_manager','super_admin') then
    raise exception 'set_level_rate: role not permitted' using errcode = '42501';
  end if;
  if p_entered_rate is not null and p_entered_rate < 0 then
    raise exception 'set_level_rate: rate must be >= 0' using errcode = 'P0001';
  end if;
  insert into public.worker_level_rates (level, entered_rate, wht_basis, updated_by, updated_at)
  values (p_level, p_entered_rate, p_basis, auth.uid(), now())
  on conflict (level) do update
    set entered_rate = excluded.entered_rate, wht_basis = excluded.wht_basis,
        updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'worker_level_rates', null,
          jsonb_build_object('op','set_level_rate','level',p_level,'entered_rate',p_entered_rate,'basis',p_basis));
end; $$;
revoke all on function public.set_level_rate(public.worker_level, numeric, public.wht_basis) from public;
revoke execute on function public.set_level_rate(public.worker_level, numeric, public.wht_basis) from anon;
grant execute on function public.set_level_rate(public.worker_level, numeric, public.wht_basis) to authenticated;

-- ---- set_labor_wht_pct (PM/super) ------------------------------------------
create function public.set_labor_wht_pct(p_pct numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role not in ('procurement_manager','super_admin') then
    raise exception 'set_labor_wht_pct: role not permitted' using errcode = '42501';
  end if;
  if p_pct is not null and (p_pct < 0 or p_pct >= 100) then
    raise exception 'set_labor_wht_pct: pct must be in [0,100)' using errcode = 'P0001';
  end if;
  update public.labor_wht_config set wht_pct = p_pct, updated_by = auth.uid(), updated_at = now() where id = true;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('worker_change', auth.uid(), v_role, 'labor_wht_config', null,
          jsonb_build_object('op','set_labor_wht_pct','wht_pct',p_pct));
end; $$;
revoke all on function public.set_labor_wht_pct(numeric) from public;
revoke execute on function public.set_labor_wht_pct(numeric) from anon;
grant execute on function public.set_labor_wht_pct(numeric) to authenticated;
```

> If the pre-flight found `audit_log.target_id` is **NOT NULL**, replace the two `null` target_ids with `auth.uid()` (actor as target) and note the real target in the payload.

- [ ] **Step 4 — Push + regen types + run tests GREEN.**

```bash
cd "D:/claude/projects/prc-ops/prc-ops-laborrate" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm db:push && pnpm db:types && pnpm db:test supabase/tests/database/314-level-rates.test.sql
```

Expected: push applies; `314-level-rates` all green. (pgTAP RPC-signature migs typecheck green only post `db:push` + `db:types` — memory `cloud-pc-quirks`.)

- [ ] **Step 5 — Write ADR 0082.** Create `docs/decisions/0082-level-standard-rate-wht.md` (context: rate was decoupled from level by ADR 0060 §5; decision: derive from a PM-maintained standard table = still disinterested; consequences: gross canonical, WHT % frozen at log time, GL deferred). Add its one-line row to `docs/decisions/README.md`.

- [ ] **Step 6 — Enum-pin + full suite.** Grep for any pgTAP that pins the set of public enums; add `wht_basis` if a test enumerates them:

```bash
cd "D:/claude/projects/prc-ops/prc-ops-laborrate" && grep -rln "enum" supabase/tests/database | xargs grep -l "pg_type" 2>/dev/null
```

Then `export PATH="/c/Program Files/nodejs:$PATH" && pnpm typecheck && pnpm test && pnpm db:test` (expect only the known 200/221 reds).

- [ ] **Step 7 — Real-flow verify (no browser surface).** Exercise the RPCs live as evidence:

```bash
cd "D:/claude/projects/prc-ops/prc-ops-laborrate" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm exec supabase db query --linked <<'SQL'
select * from public.worker_level_rates order by level;
select public.level_gross_rate('senior'), public.level_gross_rate('junior');
SQL
```

Show the seeded rows + NULL gross (rates unset).

- [ ] **Step 8 — Fresh-eyes review + ship.** cavecrew-reviewer (model opus) on the full diff; address findings. Ship via `scripts/ship-pr.sh`. Additive migration → admin-merge on green (standing grant). Update `../LANES.md` (schema lane consumed then freed for U3).

---

## Task 2 (Unit U2) — PM settings UI `/settings/labor-rates` _(verify guard verdict; likely operator-held)_

**Files:**

- Create: `src/app/settings/labor-rates/page.tsx` (server component; reads money via admin client behind `requireRole`)
- Create: `src/app/settings/labor-rates/actions.ts` (server actions → `set_level_rate`, `set_labor_wht_pct`)
- Create: `src/components/features/labor/level-rates-form.tsx` (`'use client'` — the 4-row grid + WHT% field; justify the `'use client'` in the PR)
- Modify: `src/app/settings/sections.ts` (add a `link` entry under the `labor-team` section)
- Modify: `src/lib/i18n/labels.ts` (**shared SSOT** — new labels; coordinate the lane)
- Test: `tests/unit/level-rates-form.test.tsx`, `tests/unit/settings-labor-rates-visibility.test.ts`

**Interfaces:**

- Consumes (U1): `set_level_rate(level, entered_rate, basis)`, `set_labor_wht_pct(pct)`; reads `worker_level_rates` + `labor_wht_config` via the service-role admin client (money columns).
- Produces: route `/settings/labor-rates`; label keys (see Step 3).

- [ ] **Step 1 — Dependency gate-check.** Read at HEAD: `src/app/settings/sections.ts` (the `labor-team` section shape + `isBackOffice`), an existing money-gated settings page for the `requireRole` + admin-read pattern (e.g. `src/app/settings/cards/`), `src/lib/ui/classes.ts` (FIELD_*/BUTTON_* tokens), and `src/lib/i18n/labels.ts` (label conventions). Confirm the `requireRole`/gate helper names.

- [ ] **Step 2 — Failing visibility test.** `tests/unit/settings-labor-rates-visibility.test.ts`: the new `labor-team` entry is visible to `procurement_manager` + `super_admin` and **absent** for `site_admin` / `visitor`. Run → RED.

- [ ] **Step 3 — Add labels + section entry.** In `labels.ts` add (Thai): `LABOR_RATES_LABEL = "ค่าแรงมาตรฐาน"`, `LABOR_RATES_HINT = "อัตราค่าแรงมาตรฐานต่อระดับฝีมือ · ภาษีหัก ณ ที่จ่าย"`, `WHT_PCT_LABEL = "ภาษีหัก ณ ที่จ่าย (%)"`, `WHT_BASIS_BEFORE_LABEL = "ก่อนหักภาษี"`, `WHT_BASIS_AFTER_LABEL = "หลังหักภาษี"`, plus a `WORKER_LEVEL_LABEL: Record<worker_level,string>` if one doesn't already exist (senior ช่างอาวุโส / mid ช่างชำนาญ / junior ช่างทั่วไป / apprentice ช่างฝึกหัด — reuse the live one if present). In `sections.ts` add a `link` entry `{ href: "/settings/labor-rates", icon: <Coins/Wallet>, label: LABOR_RATES_LABEL, hint: LABOR_RATES_HINT, visible: (role)=> role==="procurement_manager" || role==="super_admin" }` to the `labor-team` section. Run the visibility test → GREEN. Commit.

- [ ] **Step 4 — Failing form test.** `tests/unit/level-rates-form.test.tsx`: renders 4 level rows (label + rate input + basis select) seeded from props; a firm WHT% input; submitting a row calls the `setLevelRate` action with `(level, rate, basis)`; the WHT% field calls `setWhtPct`. Assert money renders via `format.ts`. Run → RED.

- [ ] **Step 5 — Build the form + page + actions.** `level-rates-form.tsx` (controlled grid, per-row save; uses `FIELD_*`/`BUTTON_*` tokens + `useTransition` — apply the `act()`-flush pattern from memory `usetransition-test-flake-act-flush` in the test). `actions.ts` server actions gate with the same `requireRole` used by sibling money settings, then call the RPCs via `await createClient()` (user RLS context — the RPC enforces the money gate). `page.tsx` server component: `requireRole(procurement_manager, super_admin)`, read the 4 rates + firm % via the **admin client** (money columns), pass to the form. Run form test → GREEN.

- [ ] **Step 6 — Verify (browser).** `pnpm dev`; dev-preview login (memory `dev-preview-login`), impersonate `procurement_manager`; open `/settings/labor-rates`; set senior = 1000/before, junior = 970/after, WHT = 3; confirm persistence + zero console errors; screenshot. Re-query live to confirm `level_gross_rate('junior')` reflects the new value.

- [ ] **Step 7 — Suite + fresh-eyes + ship.** `pnpm lint && pnpm typecheck && pnpm test`. cavecrew-reviewer (opus). Ship via `ship-pr.sh`; **check the danger-path guard verdict** — if it flags the service-role money read, it is operator-held (do not self-merge).

---

## Task 3 (Unit U3) — Defaulting + WHT snapshot _(danger-path, operator-held)_

**Files:**

- Create: `supabase/migrations/20260813075785_spec314u3_daily_default_wht_snapshot.sql` _(rename to live next-free)_
- Modify: `supabase/tests/database/29-labor-capture.test.sql` (or add `314-defaulting.test.sql`) — snapshot + derivation asserts
- Modify: `src/lib/db/database.types.ts` (regenerated)

**Interfaces:**

- Consumes (U1): `level_gross_rate(level)`.
- Produces: `labor_logs.wht_pct_snapshot numeric(5,2)` (zero-grant); `workers.pay_type` default `'daily'`; `confirm_worker_cost` derives `day_rate`; `log_labor_day`/`correct_labor_log` snapshot the firm %.

- [ ] **Step 1 — Failing pgTAP.** In the labor-capture test file add:

```sql
-- A) workers.pay_type column default = 'daily' (create a worker without specifying pay_type; assert 'daily').
-- B) confirm_worker_cost derivation: seed worker_level_rates('mid', 800, 'before_wht'); a worker at day_rate 500;
--    call confirm_worker_cost(worker,'mid') as super_admin -> workers.day_rate = 800 (level standard), cost stamped.
-- C) confirm_worker_cost when the level's standard is NULL -> day_rate UNCHANGED (keeps prior), still stamps if rate present.
-- D) log_labor_day snapshots wht_pct: set firm wht_pct=3.00; log a day -> labor_logs.wht_pct_snapshot=3.00.
-- E) correct_labor_log COPIES the original wht_pct_snapshot (not re-read) even after firm % changes to 5.00.
-- F) authenticated cannot select wht_pct_snapshot -> 42501 (zero-grant, column-scoped).
```

Run → RED.

- [ ] **Step 2 — Write the migration from the LIVE bodies.** Using the `pg_get_functiondef` output captured in pre-flight (NOT the old migration files — memory `prc-ops-db-migration-lessons`), write `075785_spec314u3_...sql`:

```sql
-- 1. pay_type default
alter table public.workers alter column pay_type set default 'daily';

-- 2. wht snapshot column (zero-grant by omission — labor_logs authenticated grant is column-scoped)
alter table public.labor_logs add column wht_pct_snapshot numeric(5,2);

-- 3. approve_crew_registration — CREATE OR REPLACE the LIVE body, changing ONLY the signature default:
--      p_pay_type public.pay_type default 'daily'
--    (paste the live body verbatim; re-run its revoke/grant lines).

-- 4. confirm_worker_cost — CREATE OR REPLACE the LIVE body; after the `update workers set level = p_level`
--    and BEFORE the cost_confirmed stamp, insert:
--      update public.workers
--         set day_rate = coalesce(public.level_gross_rate(p_level), day_rate)
--       where id = p_worker;
--    (leave the existing stamp block — it already requires day_rate not null.)

-- 5. log_labor_day — CREATE OR REPLACE the LIVE body; add wht_pct_snapshot to the INSERT column list and
--    source it: (select wht_pct from public.labor_wht_config where id = true).

-- 6. correct_labor_log — CREATE OR REPLACE the LIVE body; the correction INSERT copies v_orig.wht_pct_snapshot
--    (same as it already copies v_orig.day_rate_snapshot).
```

Re-emit each RPC's `revoke ... from anon` / `grant execute ... to authenticated` exactly as in its live definition.

- [ ] **Step 3 — Push, regen, GREEN.** `pnpm db:push && pnpm db:types && pnpm db:test <labor-capture file>`. Expect the new asserts green.

- [ ] **Step 4 — Guard the snapshot grant.** Confirm the new column is zero-grant:

```bash
cd "D:/claude/projects/prc-ops/prc-ops-laborrate" && export PATH="/c/Program Files/nodejs:$PATH" && pnpm exec supabase db query --linked <<'SQL'
select 1 from information_schema.column_privileges
 where table_name='labor_logs' and column_name='wht_pct_snapshot' and grantee='authenticated';
SQL
```

Expected: zero rows (not granted).

- [ ] **Step 5 — Full suite + real-flow verify.** `pnpm typecheck && pnpm test && pnpm db:test`. Then live: create a worker, `confirm_worker_cost` at a level with a standard set, and show `day_rate` took the gross; log a day and show `wht_pct_snapshot`.

- [ ] **Step 6 — Fresh-eyes + ship (operator-held).** cavecrew-reviewer (opus). Ship via `ship-pr.sh`; **danger-path → operator merges** (money/labor RPC replaces).

---

## Task 4 (Unit U4) — Payroll gross / WHT / net _(danger-path, operator-held)_

**Files:**

- Modify: `src/lib/labor/payroll.ts` (aggregate + CSV)
- Modify: `src/lib/labor/fetch-payroll.ts` (select `wht_pct_snapshot`)
- Modify: `src/app/payroll/page.tsx` (render gross / WHT / net)
- Test: `tests/unit/labor-payroll.test.ts`

**Interfaces:**

- Consumes (U3): `labor_logs.wht_pct_snapshot`.
- Produces: `WorkerPay { workerId, name, days, gross, wht, net }`; `PayrollReport { workers, totalDays, totalGross, totalWht, totalNet, workerCount }`.

- [ ] **Step 1 — Failing unit test.** In `tests/unit/labor-payroll.test.ts` add: rows with `day_rate_snapshot` gross + `wht_pct_snapshot` → per-worker `gross`, `wht = round2(gross × pct/100)`, `net = gross − wht`, summed across full/half days; a row with `wht_pct_snapshot = null` → `wht = 0`, `net = gross`. CSV has ช่าง / วัน / รวม(บาท) / หัก ณ ที่จ่าย / สุทธิ columns. Run → RED.

- [ ] **Step 2 — Amend `payroll.ts`.** Extend `PayrollInputRow` with `wht_pct_snapshot`. Replace the aggregation body:

```ts
// PayrollInputRow: add
//   | "wht_pct_snapshot"
export interface WorkerPay {
  workerId: string;
  name: string;
  days: number;
  gross: number;
  wht: number;
  net: number;
}
export interface PayrollReport {
  workers: WorkerPay[];
  totalDays: number;
  totalGross: number;
  totalWht: number;
  totalNet: number;
  workerCount: number;
}
```

In `aggregatePayroll`, per current row replace the `amount` math:

```ts
const days = fractionDays(r.day_fraction as DayFraction);
const gross = round2(days * r.day_rate_snapshot);
const wht = round2(gross * (r.wht_pct_snapshot ?? 0) / 100);
const net = round2(gross - wht);
// accumulate line.gross/.wht/.net and totalGross/totalWht/totalNet
```

Import `round2` from `@/lib/format` (confirmed name in pre-flight). Update `payrollToCsv` header to `["ช่าง","จำนวนวัน","ค่าแรง (บาท)","หัก ณ ที่จ่าย","สุทธิ"]` and emit `w.gross/w.wht/w.net` (`.toFixed(2)`), with the total row summing each. Run test → GREEN.

- [ ] **Step 3 — Wire the read + page.** In `fetch-payroll.ts` add `wht_pct_snapshot` to the `labor_logs` select (admin client — money). In `payroll/page.tsx` render the three money columns (gross/WHT/net) using `format.ts`; keep the existing per-project filter (spec 309) intact.

- [ ] **Step 4 — Verify (browser).** `pnpm dev`; dev-preview as a payroll-authorized role; open `/payroll`; confirm gross/WHT/net columns + CSV export; screenshot. (Roster may be empty — if so, seed one labor_log with a gross + 3% snapshot to show a non-zero row, then remove it.)

- [ ] **Step 5 — Suite + fresh-eyes + ship (operator-held).** `pnpm lint && pnpm typecheck && pnpm test`. cavecrew-reviewer (opus). Ship via `ship-pr.sh`; **payroll = danger-path → operator merges.**

---

## U5 — DEFERRED (separate spec)

GL posting of WHT-payable liability + gross labor expense (new 2xxx account, outbox posting). Not in this plan. Open a new spec when the accountant assigns the WHT-payable account code.

---

## Self-review (against spec 314)

- **Coverage:** default daily → U3(A) + D5 three layers (column default here; RPC param default in approve; UI preselect is a U3 note — see below). Standard table + PM edit → U1 + U2. Per-level basis seed → U1 Step 3 seed. Firm WHT 3.00 → U1 seed. Gross canonical + gross-up → `level_gross_rate` U1. Derive at confirm → U3(B/C). Freeze % at log → U3(D/E/F). Payroll gross/WHT/net → U4. ADR 0082 → U1 Step 5. GL → deferred. ✅
- **D5 UI preselect gap:** the approval UI that calls `approve_crew_registration` should preselect `daily`. Add to U3 Step 2 as a small client change **if** such a picker exists at HEAD (gate-check); the column + RPC defaults already make `daily` the effective default even if the UI omits it. Verify the approval surface during U3.
- **Type consistency:** `level_gross_rate`, `set_level_rate(level,rate,basis)`, `set_labor_wht_pct(pct)`, `wht_pct_snapshot`, `WorkerPay{gross,wht,net}` used identically across tasks. ✅
- **Placeholder scan:** the only "paste live body" steps (U3) are deliberate — the DEFINER bodies MUST come from the live DB, not a stale migration file (repo doctrine); the exact added lines are given verbatim. ✅
