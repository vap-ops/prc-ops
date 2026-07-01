# Ordering-plan templates — U1 (schema + RLS + RPC fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** land the schema foundation for spec 245 (ordering-plan templates) — make
`supply_plans.project_id` nullable, add `is_template`/`name`, seed the 2 empty
templates ("TFM 16m", "TFM 20m"), and fix the 3 RPCs whose "unknown plan" check
silently breaks once `project_id` can legitimately be null.

**Architecture:** One additive migration (schema + RLS policy updates + `CREATE OR
REPLACE` on 2 RPCs, sourced verbatim from the LIVE bodies with one precise fix) + one
pgTAP test file proving the schema, the RLS branch, and the RPC fix, without
regressing any existing supply-plan behavior.

**Tech Stack:** Postgres/Supabase migration SQL, pgTAP (`supabase/tests/database/`,
run via `pnpm db:test`).

**Scope note:** this plan covers **spec 245 U1 only** (see
`docs/feature-specs/245-ordering-plan-templates.md` §7). U2 (clone action), U3
(category-grouped line list), and U4 (template editor page) each get their own plan
once U1 has shipped and merged — matching this repo's established one-unit-per-session
convention (`CLAUDE.md` Feature workflow step 7: "Stop. Do not start the next unit in
the same session").

## Global Constraints

- Package manager `pnpm` (`pnpm@10.x`). Node ≥22. Path alias `@/*` → `src/*`.
- Migration files live in `supabase/migrations/`, timestamp-prefixed
  `YYYYMMDDHHMMSS_specNNN..._name.sql`. Next free timestamp verified against the
  repo: `20260813048000` (latest existing is `20260813047000`).
- pgTAP files live in `supabase/tests/database/`, numbered independently of feature
  specs. Next free number verified: `252` (latest existing is `251`).
- pgTAP form: `begin; select plan(N); ... select * from finish(); rollback;` — no
  `commit`, must close with `rollback` (the runner refuses files missing this).
- Grant `insert`/`select` on `_tap_buf` and `usage` on `_tap_buf_ord_seq` to
  `authenticated` **before** `set local role authenticated` in every pgTAP file, or
  RLS assertions error `42501 _tap_buf` (a documented repo gotcha).
- **DANGER-PATH:** this migration touches `supabase/migrations/**` — the
  autonomous-build-fence guard will HOLD the PR for the operator's one-tap merge (or
  the standing "automerge this session" PAT override, if still in force — check
  memory `autonomous-build-fence` before assuming). Do not attempt to bypass the
  guard.
- Schema is single-lane: claim the lane in `D:\claude\projects\prc-ops\LANES.md`
  before running `pnpm db:push`, clear it on merge.
- Run `pnpm db:link` once per machine session before any `pnpm db:push` /
  `pnpm db:test` (requires `supabase login`; skip if already linked this session).

---

### Task 1: Ordering-plan-template schema, RLS, and RPC null-check fix

**Files:**
- Create: `supabase/tests/database/252-ordering-plan-templates.test.sql`
- Create: `supabase/migrations/20260813048000_spec245u1_ordering_plan_templates.sql`
- Modify: `src/lib/db/database.types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: existing `public.supply_plans` / `public.supply_plan_lines` tables
  (migration `20260805000000`), existing RLS policies `"supply_plans readable by
  project viewers"` / `"supply_plan_lines readable by project viewers"` (as altered
  by migration `20260809000900`), existing functions `public.can_see_project(uuid)`,
  `public.current_user_role()`, `public.add_supply_plan_lines(uuid, jsonb)` and
  `public.remove_supply_plan_line(uuid)` (bodies as of migration `20260809001000` and
  `20260806000000`/`20260809000900` respectively — these are the LIVE versions this
  task's `CREATE OR REPLACE` must preserve verbatim except for the one described fix).
- Produces: `public.supply_plans.is_template boolean not null default false`,
  `public.supply_plans.name text` (nullable), `public.supply_plans.project_id`
  nullable, 2 seeded rows (`name = 'TFM 16m'` / `'TFM 20m'`, `is_template = true`,
  `project_id = null`, zero lines) that U2–U4 (future plans) will read/clone/edit by
  querying `where is_template = true`.

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/database/252-ordering-plan-templates.test.sql`:

```sql
begin;
select plan(13);

-- ============================================================================
-- Spec 245 U1 — ordering-plan templates: supply_plans gains is_template/name,
-- project_id becomes nullable for template rows, and the 3 RPCs whose "null
-- project_id means unknown plan" check would otherwise misfire against a
-- template are fixed to distinguish "row not found" from "row is a template"
-- via FOUND, not a null check. Templates are readable by the existing
-- write-tier (procurement and super_admin/project_director already see any
-- project_id via can_see_project's existing permissive branches; only
-- project_manager needs a new narrow is_template branch).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111245', 'pm@sp245.local', '{}'::jsonb),
  ('a2222222-2222-2222-2222-222222222245', 'sa@sp245.local', '{}'::jsonb),
  ('a3333333-3333-3333-3333-333333333245', 'proc@sp245.local', '{}'::jsonb);
update public.users set role='project_manager' where id='a1111111-1111-1111-1111-111111111245';
update public.users set role='site_admin'      where id='a2222222-2222-2222-2222-222222222245';
update public.users set role='procurement'     where id='a3333333-3333-3333-3333-333333333245';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000245', 'SP245', 'โครงการ 245');
-- NOTE: the project_manager user above is NOT added to project_members and is NOT
-- the project_lead — deliberately a non-member, to prove template access doesn't
-- depend on any real-project membership, and that the real project's plan STILL
-- correctly denies a non-member PM (regression guard, assertion 12).
insert into public.catalog_items (id, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000245', 'วัสดุ 245', 'ชิ้น', true);
insert into public.supply_plans (id, project_id) values
  ('bb000000-0000-0000-0000-000000000245', 'aa000000-0000-0000-0000-000000000245');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A/B. Check constraint: exactly one of (is_template & null project) or
-- (not is_template & real project) may hold.
select throws_ok(
  $$ insert into public.supply_plans (is_template, project_id)
     values (true, 'aa000000-0000-0000-0000-000000000245') $$,
  '23514', null, 'is_template=true with a real project_id is rejected (23514)');
select throws_ok(
  $$ insert into public.supply_plans (is_template, project_id) values (false, null) $$,
  '23514', null, 'is_template=false with a null project_id is rejected (23514)');

-- C. A valid template row inserts fine (as the fixture writer, before RLS).
insert into public.supply_plans (id, is_template, project_id, name)
values ('cc000000-0000-0000-0000-000000000245', true, null, 'TFM ทดสอบ 245');
select ok(
  (select is_template from public.supply_plans where id = 'cc000000-0000-0000-0000-000000000245'),
  'a template row (is_template=true, project_id=null, named) inserts fine');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111245"}';

-- D. project_manager (non-member of anything) CAN read the template row.
select is(
  (select count(*)::int from public.supply_plans where id = 'cc000000-0000-0000-0000-000000000245'),
  1, 'a non-member project_manager can read the template row');

-- E. project_manager can add a line to the template (no membership needed).
select is(
  (select public.add_supply_plan_lines('cc000000-0000-0000-0000-000000000245', $json$[
     {"catalog_item_id":"ee000000-0000-0000-0000-000000000245","work_package_id":null,"qty":2}
   ]$json$::jsonb)),
  1, 'project_manager can bulk-add a line to the template');
select is(
  (select count(*)::int from public.supply_plan_lines
    where supply_plan_id = 'cc000000-0000-0000-0000-000000000245'),
  1, 'the line landed on the template');

-- F. project_manager can remove that line.
select lives_ok(
  $$ select public.remove_supply_plan_line(
       (select id from public.supply_plan_lines
         where supply_plan_id = 'cc000000-0000-0000-0000-000000000245')) $$,
  'project_manager can remove a line from the template');
select is(
  (select count(*)::int from public.supply_plan_lines
    where supply_plan_id = 'cc000000-0000-0000-0000-000000000245'),
  0, 'the line is gone after removal');

-- G. Regression: add_supply_plan_lines against a genuinely nonexistent plan id
-- still throws "unknown plan" (22023) — the FOUND-based fix must not swallow
-- the real not-found case.
select throws_ok(
  $$ select public.add_supply_plan_lines('00000000-0000-0000-0000-000000000000', $json$[
       {"catalog_item_id":"ee000000-0000-0000-0000-000000000245","work_package_id":null,"qty":1}
     ]$json$::jsonb) $$,
  '22023', null, 'add_supply_plan_lines against a nonexistent plan still throws unknown-plan (22023)');

-- H. Regression: remove_supply_plan_line against a nonexistent line id still
-- throws "unknown line" (22023).
select throws_ok(
  $$ select public.remove_supply_plan_line('00000000-0000-0000-0000-000000000000') $$,
  '22023', null, 'remove_supply_plan_line against a nonexistent line still throws unknown-line (22023)');

-- I. Regression: the SAME non-member project_manager is STILL denied on the
-- REAL (non-template) plan — proves the is_template skip did not accidentally
-- widen the ordinary per-project membership gate.
select throws_ok(
  $$ select public.add_supply_plan_lines('bb000000-0000-0000-0000-000000000245', $json$[
       {"catalog_item_id":"ee000000-0000-0000-0000-000000000245","work_package_id":null,"qty":1}
     ]$json$::jsonb) $$,
  '42501', null, 'a non-member project_manager is still denied on a REAL plan (42501)');

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222245"}';

-- J. site_admin CANNOT read the template row (the new branch is PM-only; site_admin
-- has no reason to see template management, matching page-level gating elsewhere).
select is(
  (select count(*)::int from public.supply_plans where id = 'cc000000-0000-0000-0000-000000000245'),
  0, 'site_admin cannot read the template row');

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3333333-3333-3333-3333-333333333245"}';

-- K. procurement (already cross-project via its own existing branch) can still
-- read the template row — a regression check, not new behavior.
select is(
  (select count(*)::int from public.supply_plans where id = 'cc000000-0000-0000-0000-000000000245'),
  1, 'procurement can read the template row (its existing cross-project branch)');

reset role;

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm db:test` (this runs every file in `supabase/tests/database/`; to isolate
this one during development, temporarily rename the others out of the directory, or
just read the failure for this file's name in the runner's output — the repo's
`scripts/run-pgtap.ts` reports per-file results).

Expected: **FAIL / error** — `column "is_template" does not exist` (or similar,
since `is_template`, `name`, the check constraint, and the RLS branch don't exist
yet, and the RPCs haven't been fixed). This is the RED state; the schema genuinely
doesn't exist yet.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260813048000_spec245u1_ordering_plan_templates.sql`:

```sql
-- Spec 245 U1 — ordering-plan templates: schema foundation.
--
-- A template is a supply_plans row (is_template=true, project_id=null) — the same
-- qty-only/price-free plan entity every project's plan already is, not a new
-- domain. project_id becomes nullable to allow this; a check constraint keeps the
-- two concepts from tangling (a template never carries a project, a normal plan
-- never lacks one).
--
-- RLS: procurement and super_admin/project_director/project_coordinator already
-- read ANY project_id (including null) via can_see_project's existing permissive
-- branches (see 20260750000100 — their branch doesn't reference p_project_id at
-- all) and procurement's own separate cross-project branch. Only project_manager
-- needs a genuinely new, narrow is_template branch (its can_see_project branch
-- requires real membership, impossible against project_id=null).
--
-- RPC fix: add_supply_plan_lines and remove_supply_plan_line both did
-- `select project_id ... if project_id is null then raise 'unknown plan'` — once
-- project_id can legitimately be null (a template), that check can no longer tell
-- "no such row" from "this row is a template" apart. Rewritten to use FOUND (set by
-- SELECT INTO regardless of the selected values) for existence, and is_template to
-- skip the membership check (role check is unchanged). Bodies are the LIVE ones
-- (20260809001000 bulk-add; 20260806000000 remove, re-sourced via 20260809000900's
-- procurement addendum) — only the existence-check + membership-skip lines change.

alter table public.supply_plans
  alter column project_id drop not null;

alter table public.supply_plans
  add column is_template boolean not null default false,
  add column name text;

alter table public.supply_plans
  add constraint supply_plans_template_xor_project check (
    (is_template and project_id is null) or (not is_template and project_id is not null)
  );

comment on column public.supply_plans.is_template is
  'Spec 245 — true for one of the 2 global ordering-plan templates (project_id is null). Normal project plans are always false.';
comment on column public.supply_plans.name is
  'Spec 245 — display name, used only by templates ("TFM 16m"/"TFM 20m"). A normal plan is auto-labeled client-side and leaves this null.';

-- ----------------------------------------------------------------------------
-- RLS — add the narrow project_manager-can-read-templates branch.
-- ----------------------------------------------------------------------------
alter policy "supply_plans readable by project viewers"
  on public.supply_plans
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
    or (is_template and (select public.current_user_role()) = 'project_manager')
  );

alter policy "supply_plan_lines readable by project viewers"
  on public.supply_plan_lines
  using (
    (select public.current_user_role()) = 'procurement'
    or exists (
      select 1 from public.supply_plans sp
       where sp.id = supply_plan_id
         and (
           public.can_see_project(sp.project_id)
           or (sp.is_template and (select public.current_user_role()) = 'project_manager')
         )
    )
  );

-- ----------------------------------------------------------------------------
-- add_supply_plan_lines — is_template-aware existence/membership check.
-- ----------------------------------------------------------------------------
create or replace function public.add_supply_plan_lines(p_plan_id uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id  uuid;
  v_status      public.supply_plan_status;
  v_is_template boolean;
  v_line        jsonb;
  v_item        uuid;
  v_wp          uuid;
  v_qty         numeric;
  v_note        text;
  v_count       int := 0;
begin
  if public.current_user_role() not in
     ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'add_supply_plan_lines: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status, sp.is_template
    into v_project_id, v_status, v_is_template
    from public.supply_plans sp where sp.id = p_plan_id;
  if not found then
    raise exception 'add_supply_plan_lines: unknown plan' using errcode = '22023';
  end if;
  -- Spec 245: a template has no project (no membership to check); every other
  -- plan keeps the existing gate (procurement already skips it, cross-project).
  if not v_is_template
     and public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'add_supply_plan_lines: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'add_supply_plan_lines: plan is not editable' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'add_supply_plan_lines: lines must be a json array' using errcode = '22023';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item := (v_line ->> 'catalog_item_id')::uuid;
    v_wp   := nullif(v_line ->> 'work_package_id', '')::uuid;
    v_qty  := (v_line ->> 'qty')::numeric;
    v_note := nullif(btrim(coalesce(v_line ->> 'note', '')), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'add_supply_plan_lines: qty must be > 0' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.catalog_items c where c.id = v_item and c.is_active
    ) then
      raise exception 'add_supply_plan_lines: unknown or inactive catalog item' using errcode = '22023';
    end if;
    if v_wp is not null and not exists (
      select 1 from public.work_packages w
       where w.id = v_wp and w.project_id = v_project_id
    ) then
      raise exception 'add_supply_plan_lines: work package not in this project' using errcode = '22023';
    end if;

    insert into public.supply_plan_lines (supply_plan_id, catalog_item_id, work_package_id, qty, note)
    values (p_plan_id, v_item, v_wp, v_qty, v_note);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.add_supply_plan_lines(uuid, jsonb) is
  'Spec 181/245 — bulk-add plan lines (atomic) to a draft/rejected plan or a template (is_template skips the membership gate; role check unchanged). Returns the count inserted.';

-- ----------------------------------------------------------------------------
-- remove_supply_plan_line — is_template-aware existence/membership check.
-- ----------------------------------------------------------------------------
create or replace function public.remove_supply_plan_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id  uuid;
  v_status      public.supply_plan_status;
  v_is_template boolean;
begin
  if public.current_user_role() not in
     ('project_manager', 'super_admin', 'project_director', 'procurement') then
    raise exception 'remove_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status, sp.is_template
    into v_project_id, v_status, v_is_template
    from public.supply_plan_lines l
    join public.supply_plans sp on sp.id = l.supply_plan_id
   where l.id = p_line_id;
  if not found then
    raise exception 'remove_supply_plan_line: unknown line' using errcode = '22023';
  end if;
  if not v_is_template
     and public.current_user_role() <> 'procurement'
     and not public.can_see_project(v_project_id) then
    raise exception 'remove_supply_plan_line: not a project member' using errcode = '42501';
  end if;
  if v_status not in ('draft', 'rejected') then
    raise exception 'remove_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  delete from public.supply_plan_lines where id = p_line_id;
end;
$$;

comment on function public.remove_supply_plan_line(uuid) is
  'Spec 181/245 — remove a line from a draft/rejected plan or a template (is_template skips the membership gate; role check unchanged).';

-- ----------------------------------------------------------------------------
-- Seed the 2 templates, EMPTY. The operator fills real quantities through the
-- app itself (spec 245 U4, a later unit) — no BOM data guessed here.
-- ----------------------------------------------------------------------------
insert into public.supply_plans (is_template, project_id, name)
values
  (true, null, 'TFM 16m'),
  (true, null, 'TFM 20m');
```

- [ ] **Step 4: Push the migration**

First claim the schema lane: append a line to `D:\claude\projects\prc-ops\LANES.md`
noting this worktree + migration timestamp `20260813048000`, then re-read the file to
confirm no collision.

Run: `pnpm db:push` (auto-accepts the `[Y/n]` prompt in this environment).
Expected: the migration applies with no errors; output confirms
`20260813048000_spec245u1_ordering_plan_templates.sql` applied.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm db:test`
Expected: **PASS** — `252-ordering-plan-templates.test.sql` reports `13/13` (plan
count matches assertion count), and no other pgTAP file regresses (a quick skim of
the full run's summary line for `0 failed` — if any unrelated file shows new
failures, stop and investigate before continuing; per this repo's own lesson
(memory `189-multi-supply-plan`), pgTAP runs against the shared LIVE remote and can
show pre-existing flaky/unrelated reds — don't assume every red is this change's
fault, but don't wave away one that plausibly touches `supply_plans`/RLS either).

- [ ] **Step 6: Regenerate types and commit**

Run: `pnpm db:types` — regenerates `src/lib/db/database.types.ts` from the live
(now-migrated) schema. This will change the `supply_plans` `Row`/`Insert`/`Update`
shapes to include `is_template`, `name`, and make `project_id` optional/nullable —
expect the TypeScript compiler to surface every call site that assumed
`project_id: string` (non-null) once this regenerates; **do not fix those call
sites in this task** (none exist yet — U1 adds no new caller of these types outside
the test/migration; if `pnpm typecheck` surfaces any, they belong to spec 245's
later units, not U1 — note them as an open question in the PR body rather than
silently patching, per `CLAUDE.md`'s scope discipline).

Run: `pnpm typecheck && pnpm lint && pnpm test` — confirm all three are clean before
committing (this task adds no `src/` code, so `pnpm test`'s vitest suite should be
unaffected; this is a sanity check, not expected to find anything).

```bash
git add supabase/migrations/20260813048000_spec245u1_ordering_plan_templates.sql \
        supabase/tests/database/252-ordering-plan-templates.test.sql \
        src/lib/db/database.types.ts
git commit -m "feat(supply-plan): ordering-plan template schema + RLS + RPC fix (spec 245 U1)"
```

Then ship via `scripts/ship-pr.sh` (per this repo's autonomous-build-fence — a
migration is danger-path, so it will HOLD for the operator's one-tap merge unless
the standing PAT-override grant is still active for this session; check memory
`autonomous-build-fence` first rather than assuming). After merge: sync main,
`git worktree remove`, delete the branch, clear the `LANES.md` claim, update
`docs/progress-tracker.md` and the spec-245 memory note.

---

## Self-Review

**1. Spec coverage.** Spec 245 §3 (data model) → migration steps for
`project_id`/`is_template`/`name`/check-constraint/seed, all present. §4 (access
model) → the RLS `alter policy` statements + the 3-RPC fix (scoped to the 2 RPCs the
spec's own §4 says are "at minimum" required — `add_supply_plan_lines` and
`remove_supply_plan_line`; `add_supply_plan_line` singular is deliberately untouched,
since nothing in this plan or spec 245's later units calls it against a template).
§9 (governance) → danger-path/schema-lane handling in Global Constraints and Step 4/6.
§7's U1 line item is fully covered by this one task. U2–U4 are explicitly out of
scope for this plan (see Scope note) — no gap, by design.

**2. Placeholder scan.** No "TBD"/"TODO" in any step; every step has complete,
runnable code or an exact command + expected output.

**3. Type consistency.** `is_template`, `name`, `project_id` (nullable) are used
identically in the migration, the pgTAP fixture/assertions, and the doc-comments.
The RPC signatures (`add_supply_plan_lines(uuid, jsonb)`, `remove_supply_plan_line(uuid)`)
are unchanged from their existing LIVE signatures — no grant re-issuing needed
(`CREATE OR REPLACE` preserves them), consistent with how prior specs in this repo
handled RPC body edits (e.g. spec 224's DROP+CREATE precedent was needed only when
the *signature* changed; here it doesn't, so plain `CREATE OR REPLACE` is correct and
simpler).
