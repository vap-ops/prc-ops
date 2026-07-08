begin;
select plan(12);

-- ============================================================================
-- Spec 279 U4 / ADR 0079 — direct SA-add of a phoneless worker (unblocks the live
-- SA who has no crew). sa_add_project_worker: an SA adds a worker straight onto
-- their OWN project (gate: role in site_admin|super_admin AND can_see_project).
-- Thai-ID checksum + age≥18 + firm-wide dedup; mints PRC-YY-NNNN; the worker is
-- active + project-bound but sets NO money (day_rate=0, level null,
-- cost_confirmed_at null) → NOT cost-loggable until a PM confirms. Valid Thai IDs:
-- 3201200000008 · 1101700000001 · 3400000000001.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0281-0281-0281-700000000281', 'sa-mem@s281.local',  '{}'::jsonb),
  ('71000000-0281-0281-0281-710000000281', 'sa-none@s281.local', '{}'::jsonb),
  ('75000000-0281-0281-0281-750000000281', 'super@s281.local',   '{}'::jsonb),
  ('72000000-0281-0281-0281-720000000281', 'visitor@s281.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = '70000000-0281-0281-0281-700000000281';
update public.users set role = 'site_admin'  where id = '71000000-0281-0281-0281-710000000281';
update public.users set role = 'super_admin' where id = '75000000-0281-0281-0281-750000000281';

insert into public.projects (id, code, name) values
  ('73000000-0281-0281-0281-730000000281', 'TAP-281', 'Spec 281 fixture project');
-- the member SA can see the project (can_see_project checks project_members).
insert into public.project_members (project_id, user_id, added_by) values
  ('73000000-0281-0281-0281-730000000281', '70000000-0281-0281-0281-700000000281',
   '75000000-0281-0281-0281-750000000281');

-- an existing worker so the national-ID dedup has something to collide with.
insert into public.workers (name, pay_type, employment_type, day_rate, active, created_by, tax_id) values
  ('มีอยู่แล้ว', 'daily', 'temporary', 400, true,
   '75000000-0281-0281-0281-750000000281', '1101700000001');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Gate — SA-member adds; visitor + non-member SA + bad data all refused.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0281-0281-0281-700000000281"}';
select ok(
  (select public.sa_add_project_worker('73000000-0281-0281-0281-730000000281', 'สมบัติ ไร่นา',
     '3201200000008', '1990-05-01')) is not null,
  'a project-member site_admin adds a worker to their own project');

set local "request.jwt.claims" = '{"sub": "72000000-0281-0281-0281-720000000281"}';
select throws_ok(
  $$ select public.sa_add_project_worker('73000000-0281-0281-0281-730000000281', 'x',
       '5000000000010', '1990-01-01') $$,
  '42501', null, 'a visitor is refused (role gate)');

set local "request.jwt.claims" = '{"sub": "71000000-0281-0281-0281-710000000281"}';
select throws_ok(
  $$ select public.sa_add_project_worker('73000000-0281-0281-0281-730000000281', 'x',
       '5000000000010', '1990-01-01') $$,
  '42501', null, 'a site_admin who is NOT a member of the project is refused (can_see_project)');

set local "request.jwt.claims" = '{"sub": "70000000-0281-0281-0281-700000000281"}';
select throws_ok(
  $$ select public.sa_add_project_worker('73000000-0281-0281-0281-730000000281', 'เลขมั่ว',
       '1101700000000', '1990-01-01') $$,
  'P0001', null, 'an invalid Thai national-ID checksum is refused');
select throws_ok(
  $$ select public.sa_add_project_worker('73000000-0281-0281-0281-730000000281', 'เด็ก',
       '3400000000001', '2015-01-01') $$,
  'P0001', null, 'a worker under 18 is refused');
select throws_ok(
  $$ select public.sa_add_project_worker('73000000-0281-0281-0281-730000000281', 'ซ้ำ',
       '1101700000001', '1990-01-01') $$,
  'P0001', null, 'a national-ID already on a worker is refused (firm-wide dedup)');

-- ============================================================================
-- B. Effect (owner read-back).
-- ============================================================================
reset role;
select is(
  (select project_id from public.workers where tax_id = '3201200000008'),
  '73000000-0281-0281-0281-730000000281'::uuid, 'the worker is bound to the SA''s project');
select is(
  (select user_id from public.workers where tax_id = '3201200000008'),
  null, 'the worker has no user_id (phoneless)');
select ok(
  (select day_rate = 0 and level is null and cost_confirmed_at is null and active
     from public.workers where tax_id = '3201200000008'),
  'the worker is active but NOT cost-loggable (no money set — a PM confirms later)');
select is(
  (select left(employee_id, 4) from public.workers where tax_id = '3201200000008'),
  'PRC-', 'sa_add_project_worker minted a PRC-YY-NNNN employee_id');
select is(
  (select count(*)::int from public.worker_project_moves wpm
     join public.workers w on w.id = wpm.worker_id where w.tax_id = '3201200000008'),
  1, 'a worker_project_moves row was written');
select ok(
  (select count(*) from public.audit_log
     where target_table = 'workers' and action = 'worker_change'
       and payload->>'source' = 'sa_add') >= 1,
  'the add wrote a worker_change audit row (source=sa_add)');

select * from finish();
rollback;
