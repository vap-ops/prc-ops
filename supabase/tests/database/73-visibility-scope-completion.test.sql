begin;
select plan(12);

-- ============================================================================
-- Spec 143 U3 / ADR 0056 — complete the membership-scoping U1 (20260728000000)
-- missed, for the tables that can be scoped without a policy self-reference.
--   READ leaks closed: labor_logs (staff policy only — the bound-contractor
--     self-read is untouched) and work_package_dependencies were still
--     role-level (cross-project). Now gated by can_see_wp.
--   WRITE mirror (defense-in-depth): the app INSERT/UPDATE policies that the
--     SELECT scoping left role-level now also require can_see_*; each role list
--     is KEPT (so project_coordinator — read-only — stays out of writes).
--   photo_markups scoping is DEFERRED to U4 (its self-referential INSERT policy
--     recurses under a function-based SELECT policy; needs a definer
--     tombstone-target helper — see 20260732000000).
-- can_see_wp/can_see_project are proven behaviourally in file 70; here the read
-- scope is proven end-to-end on work_package_dependencies, the rest by wiring.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'pmmem@v3-test.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'pmoth@v3-test.local', '{}'::jsonb);

update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333333333';
update public.users set role='project_manager' where id='44444444-4444-4444-4444-444444444444';

-- P1: pm_member is the lead. WP1 + WP1b in P1; a dependency between them.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'PRC-V3-P1', 'โครงการสาม',
   '33333333-3333-3333-3333-333333333333');
insert into public.work_packages (id, project_id, code, name) values
  ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'WP-1', 'งานหนึ่ง'),
  ('c1c2c1c2-c1c2-c1c2-c1c2-c1c2c1c2c1c2', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'WP-1B', 'งานหนึ่งบี');
insert into public.work_package_dependencies (predecessor_id, successor_id) values
  ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'c1c2c1c2-c1c2-c1c2-c1c2-c1c2c1c2c1c2');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Read-scope wiring (catalog).
-- ============================================================================
select ok((select qual from pg_policies where tablename='labor_logs'
            and policyname='labor logs readable by field and pm') like '%can_see_wp%',
  'labor_logs staff SELECT now gates on can_see_wp');
select is((select count(*)::int from pg_policies where tablename='labor_logs' and cmd='SELECT'),
  2, 'labor_logs keeps 2 SELECT policies (staff scoped + worker self-read; bound-contractor self-read retired in the DC->chang merge, spec 266)');
select ok((select qual from pg_policies where tablename='work_package_dependencies'
            and policyname='wp_dependencies readable by privileged roles') like '%can_see_wp%',
  'work_package_dependencies SELECT now gates on can_see_wp');

-- ============================================================================
-- B. Write-mirror wiring (catalog).
-- ============================================================================
select ok((select with_check from pg_policies where tablename='photo_logs'
            and policyname='photo_logs insert by sa/pm/super') like '%can_see_wp%',
  'photo_logs INSERT mirrors can_see_wp');
select ok((select with_check from pg_policies where tablename='approvals'
            and policyname='approvals insert by pm/super') like '%can_see_wp%',
  'approvals INSERT mirrors can_see_wp');
select ok((select with_check from pg_policies where tablename='purchase_requests'
            and policyname='purchase_requests insert by wp-readers') like '%can_see_wp%',
  'purchase_requests INSERT mirrors can_see_wp');
select ok((select with_check from pg_policies where tablename='deliverables'
            and policyname='deliverables insert by pm or super_admin') like '%can_see_project%',
  'deliverables INSERT mirrors can_see_project');
select ok((select with_check from pg_policies where tablename='deliverables'
            and policyname='deliverables update by pm or super_admin') like '%can_see_project%',
  'deliverables UPDATE mirrors can_see_project');
select ok((select with_check from pg_policies where tablename='reports'
            and policyname='reports insert by pm or super_admin') like '%can_see_project%',
  'reports INSERT mirrors can_see_project');
select ok((select with_check from pg_policies where tablename='work_packages'
            and policyname='work_packages update by pm or super_admin') like '%can_see_project%',
  'work_packages UPDATE mirrors can_see_project');

-- ============================================================================
-- C. Behaviour: work_package_dependencies row filtering (read leak closed).
-- ============================================================================
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select is((select count(*)::int from public.work_package_dependencies
            where predecessor_id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'), 1,
  'pm_member (lead) sees the P1 dependency');

set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is((select count(*)::int from public.work_package_dependencies
            where predecessor_id='c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'), 0,
  'pm_other (not on P1) does NOT see the P1 dependency (leak closed)');

reset role;

select * from finish();
rollback;
