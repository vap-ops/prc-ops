begin;
select plan(42);

-- ============================================================================
-- rls-audit-2026-07 Pass A — audit_log confidentiality + integrity (F2/F3/F4).
--   F2: audit_log SELECT scoped to internal roles — full read for
--       super_admin/project_director/accounting/project_manager; an
--       event-scoped arm keeps the app's only field reads working
--       (wp_reopened_for_defect rows for site_admin + procurement — the
--       /sa home rework banner + WP-detail rework gallery, pre-flight 1).
--       client/contractor/visitor and a NULL role see NOTHING.
--   F3: audit_log INSERT is trusted-server only — all 49 live writers are
--       SECURITY DEFINER owned by postgres (pre-flight 2), so the
--       authenticated/anon INSERT grant + WITH CHECK (true) policy are pure
--       forgery surface. Revoked + dropped; service_role keeps INSERT.
--   F4: inert anon DML grants revoked on projects / work_packages /
--       deliverables / reports / work_package_dependencies / users.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22000000-0000-4000-8000-000000000253', 'sa@rls253.local',   '{}'::jsonb),
  ('33000000-0000-4000-8000-000000000253', 'pm@rls253.local',   '{}'::jsonb),
  ('44000000-0000-4000-8000-000000000253', 'proc@rls253.local', '{}'::jsonb),
  ('55000000-0000-4000-8000-000000000253', 'acct@rls253.local', '{}'::jsonb),
  ('dd000000-0000-4000-8000-000000000253', 'cli@rls253.local',  '{}'::jsonb);
update public.users set role='site_admin'      where id='22000000-0000-4000-8000-000000000253';
update public.users set role='project_manager' where id='33000000-0000-4000-8000-000000000253';
update public.users set role='procurement'     where id='44000000-0000-4000-8000-000000000253';
update public.users set role='accounting'      where id='55000000-0000-4000-8000-000000000253';
update public.users set role='client'          where id='dd000000-0000-4000-8000-000000000253';

insert into public.projects (id, code, name, project_lead_id) values
  ('a1000000-0000-4000-8000-000000000253', 'PRC-253', 'RLS audit pass A',
   '33000000-0000-4000-8000-000000000253');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0000-4000-8000-000000000253',
   '22000000-0000-4000-8000-000000000253', '33000000-0000-4000-8000-000000000253');
insert into public.work_packages (id, project_id, code, name, status) values
  ('c1000000-0000-4000-8000-000000000253', 'a1000000-0000-4000-8000-000000000253',
   'WP-253', 'งานทดสอบ', 'complete');

-- A generic (non-rework) audit row, inserted as postgres — the owner path that
-- must keep working after F3.
insert into public.audit_log (action, target_table, target_id, payload)
  values ('other', 'pgtap-f2', null, '{"test": true}'::jsonb);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Posture — F2/F3 shape (owner context).
-- ============================================================================

-- F2: the blanket USING (true) SELECT policy is gone.
select is(
  (select count(*)::int from pg_policies
    where schemaname='public' and tablename='audit_log' and cmd='SELECT' and qual='true'),
  0, 'F2: no audit_log SELECT policy is USING (true)');

-- F3: direct INSERT is trusted-server only.
select ok(has_table_privilege('anon', 'public.audit_log', 'INSERT') = false,
  'F3: anon has no INSERT grant on audit_log');
select ok(has_table_privilege('authenticated', 'public.audit_log', 'INSERT') = false,
  'F3: authenticated has no INSERT grant on audit_log');
select ok(has_table_privilege('service_role', 'public.audit_log', 'INSERT') = true,
  'F3: service_role keeps INSERT on audit_log');
select is(
  (select count(*)::int from pg_policies
    where schemaname='public' and tablename='audit_log' and cmd='INSERT'),
  0, 'F3: no INSERT policy remains on audit_log');
select ok(has_table_privilege('authenticated', 'public.audit_log', 'SELECT') = true,
  'F2: authenticated keeps the SELECT grant (rows come from the scoped policies)');

-- ============================================================================
-- B. Posture — F4 inert anon DML grants revoked.
-- ============================================================================

select ok(has_table_privilege('anon', 'public.projects', 'SELECT') = false, 'F4: anon no SELECT on projects');
select ok(has_table_privilege('anon', 'public.projects', 'INSERT') = false, 'F4: anon no INSERT on projects');
select ok(has_table_privilege('anon', 'public.projects', 'UPDATE') = false, 'F4: anon no UPDATE on projects');
select ok(has_table_privilege('anon', 'public.projects', 'DELETE') = false, 'F4: anon no DELETE on projects');

select ok(has_table_privilege('anon', 'public.work_packages', 'SELECT') = false, 'F4: anon no SELECT on work_packages');
select ok(has_table_privilege('anon', 'public.work_packages', 'INSERT') = false, 'F4: anon no INSERT on work_packages');
select ok(has_table_privilege('anon', 'public.work_packages', 'UPDATE') = false, 'F4: anon no UPDATE on work_packages');
select ok(has_table_privilege('anon', 'public.work_packages', 'DELETE') = false, 'F4: anon no DELETE on work_packages');

select ok(has_table_privilege('anon', 'public.deliverables', 'SELECT') = false, 'F4: anon no SELECT on deliverables');
select ok(has_table_privilege('anon', 'public.deliverables', 'INSERT') = false, 'F4: anon no INSERT on deliverables');
select ok(has_table_privilege('anon', 'public.deliverables', 'UPDATE') = false, 'F4: anon no UPDATE on deliverables');
select ok(has_table_privilege('anon', 'public.deliverables', 'DELETE') = false, 'F4: anon no DELETE on deliverables');

select ok(has_table_privilege('anon', 'public.reports', 'SELECT') = false, 'F4: anon no SELECT on reports');
select ok(has_table_privilege('anon', 'public.reports', 'INSERT') = false, 'F4: anon no INSERT on reports');
select ok(has_table_privilege('anon', 'public.reports', 'UPDATE') = false, 'F4: anon no UPDATE on reports');
select ok(has_table_privilege('anon', 'public.reports', 'DELETE') = false, 'F4: anon no DELETE on reports');

select ok(has_table_privilege('anon', 'public.work_package_dependencies', 'SELECT') = false, 'F4: anon no SELECT on work_package_dependencies');
select ok(has_table_privilege('anon', 'public.work_package_dependencies', 'INSERT') = false, 'F4: anon no INSERT on work_package_dependencies');
select ok(has_table_privilege('anon', 'public.work_package_dependencies', 'UPDATE') = false, 'F4: anon no UPDATE on work_package_dependencies');
select ok(has_table_privilege('anon', 'public.work_package_dependencies', 'DELETE') = false, 'F4: anon no DELETE on work_package_dependencies');

select ok(has_table_privilege('anon', 'public.users', 'SELECT') = false, 'F4: anon no SELECT on users');
select ok(has_table_privilege('anon', 'public.users', 'INSERT') = false, 'F4: anon no INSERT on users');
select ok(has_table_privilege('anon', 'public.users', 'UPDATE') = false, 'F4: anon no UPDATE on users');
select ok(has_table_privilege('anon', 'public.users', 'DELETE') = false, 'F4: anon no DELETE on users');

-- ============================================================================
-- C. Behavior — the definer write path survives F3, and F2 scopes reads.
-- ============================================================================

set local role authenticated;

-- C.1 site_admin member reopens the complete WP — a SECURITY DEFINER write that
-- records an audit row. This is the write path that must keep working.
set local "request.jwt.claims" = '{"sub": "22000000-0000-4000-8000-000000000253"}';
select is(
  (select public.reopen_work_package_for_defect('c1000000-0000-4000-8000-000000000253', 'รอยร้าวที่ผนัง')),
  true, 'F3: the definer write path still works (site_admin reopens a WP)');
select is(
  (select count(*)::int from public.audit_log
    where target_id='c1000000-0000-4000-8000-000000000253'
      and payload->>'event'='wp_reopened_for_defect'),
  1, 'F3: the reopen recorded its audit row through the definer');

-- C.2 site_admin: sees rework-event rows (the /sa home + WP detail read,
-- pre-flight 1) but NOT the generic audit stream.
select is(
  (select count(*)::int from public.audit_log
    where target_id='c1000000-0000-4000-8000-000000000253'
      and payload->>'event'='wp_reopened_for_defect'),
  1, 'F2: site_admin reads wp_reopened_for_defect rows');
select is(
  (select count(*)::int from public.audit_log where target_table='pgtap-f2'),
  0, 'F2: site_admin cannot read the generic audit stream');

-- C.3 procurement (WP detail viewer): rework events only.
set local "request.jwt.claims" = '{"sub": "44000000-0000-4000-8000-000000000253"}';
select is(
  (select count(*)::int from public.audit_log
    where target_id='c1000000-0000-4000-8000-000000000253'
      and payload->>'event'='wp_reopened_for_defect'),
  1, 'F2: procurement reads wp_reopened_for_defect rows');
select is(
  (select count(*)::int from public.audit_log where target_table='pgtap-f2'),
  0, 'F2: procurement cannot read the generic audit stream');

-- C.4 project_manager: full read; direct INSERT now refused (42501, layer 1).
set local "request.jwt.claims" = '{"sub": "33000000-0000-4000-8000-000000000253"}';
select is(
  (select count(*)::int from public.audit_log where target_table='pgtap-f2'),
  1, 'F2: project_manager reads the full audit stream');
select is(
  (select count(*)::int from public.audit_log
    where target_id='c1000000-0000-4000-8000-000000000253'
      and payload->>'event'='wp_reopened_for_defect'),
  1, 'F2: project_manager reads rework events too');
select throws_ok(
  $$ insert into public.audit_log (action, target_table, target_id, payload)
     values ('other', 'pgtap-forge', null, '{"forged": true}'::jsonb) $$,
  '42501', null,
  'F3: an authenticated session cannot INSERT audit_log directly');

-- C.5 accounting: full read.
set local "request.jwt.claims" = '{"sub": "55000000-0000-4000-8000-000000000253"}';
select is(
  (select count(*)::int from public.audit_log where target_table='pgtap-f2'),
  1, 'F2: accounting reads the full audit stream');

-- C.6 client (external portal role): ZERO audit rows of any kind.
set local "request.jwt.claims" = '{"sub": "dd000000-0000-4000-8000-000000000253"}';
select is(
  (select count(*)::int from public.audit_log),
  0, 'F2: a client sees zero audit_log rows');
select is(
  (select count(*)::int from public.audit_log
    where payload->>'event'='wp_reopened_for_defect'),
  0, 'F2: a client sees zero rework-event rows either');

reset role;

select * from finish();
rollback;
