-- Writing failing test first.
--
-- Spec 271 U1 / ADR 0075 — plan baselines: append-only versioned plan
-- snapshots (the incentive anchor, D3) + weekly variance_snapshots (tamper
-- evidence, §3) + guards, and the PRC-2026-004 v1 backfill (unscored
-- calibration pilot — scoring_go_live NULL, D8).
--
-- Posture pins: read-only for authenticated (SELECT via can_see_project);
-- zero write grants (writes = U3 definer RPCs / the report job / migrations);
-- append-only triple-layer (grants · RLS · P0001 triggers, the approvals
-- pattern); leaf-only binding via wp_reject_group_binding (spec 270).

begin;
select plan(46);

-- ---------------------------------------------------------------- enums
select has_type('public', 'plan_baseline_kind', 'plan_baseline_kind enum exists');
select enum_has_labels('public', 'plan_baseline_kind',
  array['initial', 'rebaseline', 'scope_change'],
  'plan_baseline_kind labels (D3)');
select has_type('public', 'variance_class', 'variance_class enum exists');
select enum_has_labels('public', 'variance_class',
  array['unplanned', 'no_evidence', 'completed', 'completed_undated',
        'never_started_past_end', 'late_start', 'late', 'at_risk', 'on_track'],
  'variance_class labels mirror the spec §3 decision table');

-- ---------------------------------------------------------------- tables + columns
select has_table('public', 'plan_baselines', 'plan_baselines exists');
select has_table('public', 'plan_baseline_items', 'plan_baseline_items exists');
select has_table('public', 'variance_snapshots', 'variance_snapshots exists');

select col_type_is('public', 'plan_baselines', 'version', 'integer',
  'baseline version is an integer');
select col_type_is('public', 'plan_baselines', 'kind', 'plan_baseline_kind',
  'baseline kind uses the enum');
select col_type_is('public', 'plan_baselines', 'as_of', 'timestamp with time zone',
  'as_of is timestamptz (pre-baseline cut, §3)');
select col_is_null('public', 'plan_baselines', 'scoring_go_live',
  'scoring_go_live nullable (NULL = unscored, D8)');

select col_type_is('public', 'plan_baseline_items', 'planned_start', 'date',
  'item planned_start is a date');
select col_not_null('public', 'plan_baseline_items', 'planned_end',
  'item planned_end NOT NULL (NULL-dated leaves are omitted, not stored)');
select col_is_pk('public', 'plan_baseline_items',
  array['baseline_id', 'work_package_id'],
  'items pk = (baseline_id, work_package_id)');

select col_is_unique('public', 'plan_baselines',
  array['project_id', 'version'],
  'one version number per project');

select col_type_is('public', 'variance_snapshots', 'class', 'variance_class',
  'snapshot class uses the enum');
select col_is_null('public', 'variance_snapshots', 'slip_days',
  'slip_days nullable (classes without slip)');
select col_is_null('public', 'variance_snapshots', 'baseline_version',
  'baseline_version nullable (NULL = current-plan lens)');

-- ---------------------------------------------------------------- privileges + RLS
select table_privs_are('public', 'plan_baselines', 'authenticated',
  array['SELECT'], 'plan_baselines: authenticated may only SELECT');
select table_privs_are('public', 'plan_baseline_items', 'authenticated',
  array['SELECT'], 'plan_baseline_items: authenticated may only SELECT');
select table_privs_are('public', 'variance_snapshots', 'authenticated',
  array['SELECT'], 'variance_snapshots: authenticated may only SELECT');

select ok((select relrowsecurity from pg_class where oid = 'public.plan_baselines'::regclass),
  'RLS enabled on plan_baselines');
select ok((select relrowsecurity from pg_class where oid = 'public.plan_baseline_items'::regclass),
  'RLS enabled on plan_baseline_items');
select ok((select relrowsecurity from pg_class where oid = 'public.variance_snapshots'::regclass),
  'RLS enabled on variance_snapshots');

select policies_are('public', 'plan_baselines',
  array['plan baselines readable in visible projects'],
  'baselines: SELECT policy only (no write policies)');
select policies_are('public', 'plan_baseline_items',
  array['plan baseline items readable in visible projects'],
  'items: SELECT policy only');
select policies_are('public', 'variance_snapshots',
  array['variance snapshots readable in visible projects'],
  'snapshots: SELECT policy only');

-- ---------------------------------------------------------------- dedupe indexes
select index_is_unique('public', 'variance_snapshots',
  'variance_snapshots_current_lens_key',
  'one current-lens snapshot per leaf per date');
select index_is_unique('public', 'variance_snapshots',
  'variance_snapshots_baseline_lens_key',
  'one baseline-lens snapshot per leaf per date per version');

-- ---------------------------------------------------------------- fixtures (rolled back)
-- Real 004 rows as FK targets: one leaf + one group + the project.
create temp table _t as
select
  (select id from public.projects where code = 'PRC-2026-004')                          as project_id,
  (select w.id from public.work_packages w
     join public.projects p on p.id = w.project_id
    where p.code = 'PRC-2026-004' and not w.is_group
    order by w.code limit 1)                                                            as leaf_id,
  (select w.id from public.work_packages w
     join public.projects p on p.id = w.project_id
    where p.code = 'PRC-2026-004' and w.is_group
    order by w.code limit 1)                                                            as group_id;

insert into public.plan_baselines (project_id, version, kind, reason)
select project_id, 900, 'rebaseline', 'pgTAP fixture' from _t;

insert into public.plan_baseline_items (baseline_id, work_package_id, planned_start, planned_end)
select b.id, t.leaf_id, date '2026-07-01', date '2026-07-05'
from public.plan_baselines b, _t t
where b.version = 900 and b.project_id = t.project_id;

insert into public.variance_snapshots (project_id, work_package_id, snapshot_date, class, slip_days)
select project_id, leaf_id, date '1999-01-04', 'on_track', null from _t;

-- ---------------------------------------------------------------- append-only (P0001)
select throws_ok(
  $$ update public.plan_baselines set reason = 'x' where version = 900 $$,
  'P0001', null, 'plan_baselines rejects UPDATE');
select throws_ok(
  $$ delete from public.plan_baselines where version = 900 $$,
  'P0001', null, 'plan_baselines rejects DELETE');
select throws_ok(
  $$ update public.plan_baseline_items set planned_end = date '2026-07-06'
     where baseline_id in (select id from public.plan_baselines where version = 900) $$,
  'P0001', null, 'plan_baseline_items rejects UPDATE');
select throws_ok(
  $$ delete from public.plan_baseline_items
     where baseline_id in (select id from public.plan_baselines where version = 900) $$,
  'P0001', null, 'plan_baseline_items rejects DELETE');
select throws_ok(
  $$ update public.variance_snapshots set slip_days = 9 where snapshot_date = date '1999-01-04' $$,
  'P0001', null, 'variance_snapshots rejects UPDATE');
select throws_ok(
  $$ delete from public.variance_snapshots where snapshot_date = date '1999-01-04' $$,
  'P0001', null, 'variance_snapshots rejects DELETE');

-- ---------------------------------------------------------------- leaf-only binding (23514)
select throws_ok(
  $$ insert into public.plan_baseline_items (baseline_id, work_package_id, planned_start, planned_end)
     select b.id, t.group_id, date '2026-07-01', date '2026-07-05'
     from public.plan_baselines b, _t t
     where b.version = 900 and b.project_id = t.project_id $$,
  '23514', null, 'baseline items reject a งาน (group) binding');
select throws_ok(
  $$ insert into public.variance_snapshots (project_id, work_package_id, snapshot_date, class)
     select project_id, group_id, date '1999-01-05', 'on_track' from _t $$,
  '23514', null, 'variance snapshots reject a งาน (group) binding');

-- ---------------------------------------------------------------- CHECKs (23514)
select throws_ok(
  $$ insert into public.plan_baselines (project_id, version, kind, reason)
     select project_id, 0, 'rebaseline', 'zero' from _t $$,
  '23514', null, 'version must be >= 1');
select throws_ok(
  $$ insert into public.plan_baselines (project_id, version, kind, reason, scoring_go_live)
     select project_id, 901, 'rebaseline', 'scored rebaseline', current_date from _t $$,
  '23514', null, 'scoring_go_live only rides the initial row');
select throws_ok(
  $$ insert into public.plan_baselines (project_id, version, kind, reason)
     select project_id, 902, 'scope_change', '   ' from _t $$,
  '23514', null, 'non-initial baselines require a reason (D3)');
select throws_ok(
  $$ insert into public.plan_baseline_items (baseline_id, work_package_id, planned_start, planned_end)
     select b.id, t.leaf_id, date '2026-07-05', date '2026-07-01'
     from public.plan_baselines b, _t t
     where b.version = 900 and b.project_id = t.project_id
     on conflict do nothing $$,
  '23514', null, 'item window must satisfy end >= start');

-- ---------------------------------------------------------------- 004 backfill (D8)
select is(
  (select count(*) from public.plan_baselines b, _t t
    where b.project_id = t.project_id and b.version = 1 and b.kind = 'initial'),
  1::bigint,
  '004 carries exactly one v1 initial baseline');
select ok(
  (select b.scoring_go_live is null and b.as_of is not null
     from public.plan_baselines b, _t t
    where b.project_id = t.project_id and b.version = 1),
  'v1 is UNSCORED (scoring_go_live NULL) and as_of-stamped');
select is(
  (select count(*) from public.plan_baseline_items i
     join public.plan_baselines b on b.id = i.baseline_id
     join _t t on t.project_id = b.project_id
    where b.version = 1),
  331::bigint,
  'v1 snapshot holds all 331 dated leaves');
select is(
  (select count(*) from public.plan_baseline_items i
     join public.plan_baselines b on b.id = i.baseline_id
     join _t t on t.project_id = b.project_id
    where b.version = 1),
  (select count(*) from public.work_packages w, _t t
    where w.project_id = t.project_id and not w.is_group
      and w.planned_start is not null and w.planned_end is not null),
  'v1 item count equals the live dated-leaf count');
select is(
  (select count(*) from public.plan_baseline_items i
     join public.work_packages w on w.id = i.work_package_id
    where w.is_group),
  0::bigint,
  'no baseline item binds a งาน (group)');

select * from finish();
rollback;
