begin;
select plan(47);

-- ============================================================================
-- Spec 46 — daily labor capture: workers master + labor_logs.
-- Pins: catalog shape, the money posture (rate columns carry NO
-- authenticated grant), zero direct write paths, RPC role gates and
-- semantics (advisory-lock uniqueness, snapshots, self_logged,
-- supersede corrections, tombstones), append-only triple layer.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-1111111ab0fe', 'pm@labor-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-2222222ab0fe', 'sa@labor-test.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-3333333ab0fe', 'vi@labor-test.local', '{}'::jsonb);

update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-1111111ab0fe';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-2222222ab0fe';
-- third user stays visitor

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccab0fe', 'TAP-LABOR', 'Labor fixture project');
insert into public.work_packages (id, project_id, code, name, status) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
   'cccccccc-cccc-cccc-cccc-cccccccab0fe', 'WP-LAB-1', 'Open WP', 'in_progress'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeee2ab0fe',
   'cccccccc-cccc-cccc-cccc-cccccccab0fe', 'WP-LAB-2', 'Second open WP', 'in_progress'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeee3ab0fe',
   'cccccccc-cccc-cccc-cccc-cccccccab0fe', 'WP-LAB-3', 'Closed WP', 'complete');

insert into public.contractors (id, name, created_by) values
  ('dddddddd-dddd-dddd-dddd-dddddddab0fe', 'DC Crew Co',
   '11111111-1111-1111-1111-1111111ab0fe');

-- Worker fixtures (direct insert as postgres — owner bypasses the
-- zero-grant posture; the app can only use the RPCs).
insert into public.workers (id, name, worker_type, contractor_id, user_id,
                            day_rate, active, created_by) values
  ('aaaaaaa1-0000-4000-8000-000000ab0fe1', 'Own Tech A', 'own', null, null,
   500.00, true,  '11111111-1111-1111-1111-1111111ab0fe'),
  ('aaaaaaa2-0000-4000-8000-000000ab0fe2', 'Own Tech B (inactive)', 'own', null,
   null, 450.00, false, '11111111-1111-1111-1111-1111111ab0fe'),
  ('aaaaaaa3-0000-4000-8000-000000ab0fe3', 'DC Worker C', 'dc',
   'dddddddd-dddd-dddd-dddd-dddddddab0fe', null, 380.00, true,
   '11111111-1111-1111-1111-1111111ab0fe'),
  ('aaaaaaa4-0000-4000-8000-000000ab0fe4', 'SA Self Worker', 'own', null,
   '22222222-2222-2222-2222-2222222ab0fe', 520.00, true,
   '11111111-1111-1111-1111-1111111ab0fe');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog.
-- ============================================================================

select has_table('public', 'workers', 'workers exists');
select has_table('public', 'labor_logs', 'labor_logs exists');
select enum_has_labels('public', 'worker_type', array['own', 'dc'],
  'worker_type labels');
select enum_has_labels('public', 'day_fraction', array['full', 'half'],
  'day_fraction labels');
select ok((select relrowsecurity from pg_class where oid = 'public.workers'::regclass),
  'RLS enabled on workers');
select ok((select relrowsecurity from pg_class where oid = 'public.labor_logs'::regclass),
  'RLS enabled on labor_logs');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'workers' and cmd <> 'SELECT'),
  0::bigint, 'workers has no non-SELECT policies (RPC-only writes)');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'labor_logs' and cmd <> 'SELECT'),
  0::bigint, 'labor_logs has no non-SELECT policies (RPC-only writes)');

-- dc requires contractor at the constraint layer too.
select throws_ok(
  $$ insert into public.workers (name, worker_type, day_rate, created_by)
     values ('Bad DC', 'dc', 100, '11111111-1111-1111-1111-1111111ab0fe') $$,
  '23514', null, 'dc worker without contractor violates CHECK');

-- ============================================================================
-- B. Money posture + zero direct writes (as authenticated SA).
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222ab0fe"}';

select throws_ok(
  $$ select day_rate from public.workers limit 1 $$,
  '42501', null, 'authenticated cannot read workers.day_rate (column grant)');
select ok(
  (select count(id) from public.workers) = 4,
  'authenticated reads the roster (presence columns)');
select throws_ok(
  $$ select day_rate_snapshot from public.labor_logs limit 1 $$,
  '42501', null, 'authenticated cannot read labor_logs.day_rate_snapshot');
select throws_ok(
  $$ insert into public.workers (name, worker_type, day_rate, created_by)
     values ('Rogue', 'own', 1, '22222222-2222-2222-2222-2222222ab0fe') $$,
  '42501', null, 'authenticated cannot INSERT workers directly');
select throws_ok(
  $$ insert into public.labor_logs (work_package_id, worker_id, work_date,
       day_fraction, day_rate_snapshot, worker_name_snapshot,
       worker_type_snapshot, entered_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
             'aaaaaaa1-0000-4000-8000-000000ab0fe1', current_date, 'full',
             0, 'x', 'own', '22222222-2222-2222-2222-2222222ab0fe') $$,
  '42501', null, 'authenticated cannot INSERT labor_logs directly');

-- ============================================================================
-- C. Worker RPC gates (SA refused; PM allowed; audit lands).
-- ============================================================================

select throws_ok(
  $$ select public.create_worker('New Guy', 'own', 400) $$,
  '42501', null, 'create_worker refuses site_admin');
select throws_ok(
  $$ select public.set_worker_day_rate('aaaaaaa1-0000-4000-8000-000000ab0fe1', 999) $$,
  '42501', null, 'set_worker_day_rate refuses site_admin');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-1111111ab0fe"}';

select ok(
  (select public.create_worker('New Own Tech', 'own', 470)) is not null,
  'create_worker works for project_manager');
select lives_ok(
  $$ select public.set_worker_day_rate('aaaaaaa1-0000-4000-8000-000000ab0fe1', 510) $$,
  'set_worker_day_rate works for project_manager');
select lives_ok(
  $$ select public.update_worker('aaaaaaa1-0000-4000-8000-000000ab0fe1',
       p_name => 'Own Tech A1') $$,
  'update_worker works for project_manager');

reset role;
select is(
  (select active from public.workers
    where id = 'aaaaaaa1-0000-4000-8000-000000ab0fe1'),
  true, 'update_worker coalesce preserves omitted fields (active untouched)');
select is(
  (select count(*) from public.audit_log
    where action = 'worker_change' and target_table = 'workers'),
  3::bigint, 'worker RPCs wrote audit rows (create + rate + update)');

-- ============================================================================
-- D. log_labor_day.
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333ab0fe"}';
select throws_ok(
  $$ select public.log_labor_day('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
       'aaaaaaa1-0000-4000-8000-000000ab0fe1', current_date, 'full') $$,
  '42501', null, 'log_labor_day refuses visitor');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222ab0fe"}';
select ok(
  (select public.log_labor_day('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
     'aaaaaaa1-0000-4000-8000-000000ab0fe1', date '2026-06-10', 'full')) is not null,
  'site_admin logs a full day');
select throws_ok(
  $$ select public.log_labor_day('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
       'aaaaaaa1-0000-4000-8000-000000ab0fe1', date '2026-06-10', 'half') $$,
  'P0001', null, 'duplicate (wp, worker, date) refused');
select ok(
  (select public.log_labor_day('eeeeeeee-eeee-eeee-eeee-eeeeee2ab0fe',
     'aaaaaaa1-0000-4000-8000-000000ab0fe1', date '2026-06-10', 'full')) is not null,
  'same worker+date on a DIFFERENT WP is allowed (C5: surfaced, not blocked)');
select throws_ok(
  $$ select public.log_labor_day('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
       'aaaaaaa2-0000-4000-8000-000000ab0fe2', date '2026-06-10', 'full') $$,
  'P0001', null, 'inactive worker refused');
select throws_ok(
  $$ select public.log_labor_day('eeeeeeee-eeee-eeee-eeee-eeeeee3ab0fe',
       'aaaaaaa1-0000-4000-8000-000000ab0fe1', date '2026-06-10', 'full') $$,
  'P0001', null, 'complete WP refused');
select ok(
  (select public.log_labor_day('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
     'aaaaaaa4-0000-4000-8000-000000ab0fe4', date '2026-06-10', 'half')) is not null,
  'SA logs own linked worker (allowed, flagged below)');

reset role;
select is(
  (select self_logged from public.labor_logs
    where worker_id = 'aaaaaaa4-0000-4000-8000-000000ab0fe4'),
  true, 'self_logged computed when the worker is linked to the entering user');
select is(
  (select day_rate_snapshot from public.labor_logs
    where worker_id = 'aaaaaaa1-0000-4000-8000-000000ab0fe1'
      and work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe'
      and work_date = date '2026-06-10'),
  510.00, 'rate snapshot captured at entry time (post-rate-change value)');

-- ============================================================================
-- E. correct_labor_log + tombstone + re-log.
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222ab0fe"}';

select ok(
  (select public.correct_labor_log(
     (select id from public.labor_logs
       where worker_id = 'aaaaaaa1-0000-4000-8000-000000ab0fe1'
         and work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe'
         and work_date = date '2026-06-10' and superseded_by is null),
     'ลงผิด ครึ่งวัน', p_fraction => 'half')) is not null,
  'correction supersedes with reason');
select throws_ok(
  $$ select public.correct_labor_log(
       (select id from public.labor_logs
         where worker_id = 'aaaaaaa1-0000-4000-8000-000000ab0fe1'
           and work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe'
           and work_date = date '2026-06-10'
           and superseded_by is null and correction_reason is null),
       'ซ้ำ', p_fraction => 'full') $$,
  'P0001', null, 'correcting an already-superseded row refused');
select throws_ok(
  $$ select public.correct_labor_log(
       (select id from public.labor_logs
         where worker_id = 'aaaaaaa4-0000-4000-8000-000000ab0fe4'),
       '   ', p_fraction => 'full') $$,
  'P0001', null, 'blank reason refused');

-- Tombstone the SA self row, then the triple is loggable again.
select ok(
  (select public.correct_labor_log(
     (select id from public.labor_logs
       where worker_id = 'aaaaaaa4-0000-4000-8000-000000ab0fe4'
         and superseded_by is null),
     'คนละงาน ลบทิ้ง', p_tombstone => true)) is not null,
  'tombstone removal works');
select ok(
  (select public.log_labor_day('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
     'aaaaaaa4-0000-4000-8000-000000ab0fe4', date '2026-06-10', 'full')) is not null,
  're-log after tombstone allowed (triple has no current entry)');

reset role;
select is(
  (select count(*) from public.labor_logs ll
    where ll.work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe'
      and ll.work_date = date '2026-06-10'
      and ll.day_fraction is not null
      and not exists (select 1 from public.labor_logs n
                       where n.superseded_by = ll.id)),
  2::bigint, 'current-state anti-join: exactly 2 live entries for the day');
select is(
  (select day_rate_snapshot from public.labor_logs
    where worker_id = 'aaaaaaa1-0000-4000-8000-000000ab0fe1'
      and correction_reason is not null),
  510.00, 'correction carries the ORIGINAL rate snapshot (history preserved)');

-- ============================================================================
-- G. Labor note (spec 74): stored at entry, carried through a correction,
--    cleared on tombstone; the length CHECK. The note column has the
--    authenticated SELECT grant (presence data, not money), but the reads
--    here run as postgres after reset role anyway.
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222ab0fe"}';

-- The "current" row is the anti-join (latest in the supersede chain) —
-- never `superseded_by is null`, which is the ORIGINAL row a correction
-- supersedes (ADR 0009).

-- G.1 log a fresh day WITH a note (DC worker on wp1, 2026-06-12).
select ok(
  (select public.log_labor_day('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
     'aaaaaaa3-0000-4000-8000-000000ab0fe3', date '2026-06-12', 'full',
     p_note => 'มาสายครึ่งชั่วโมง')) is not null,
  'log_labor_day stores a note');

reset role;
select is(
  (select ll.note from public.labor_logs ll
    where ll.worker_id = 'aaaaaaa3-0000-4000-8000-000000ab0fe3'
      and ll.work_date = date '2026-06-12'
      and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  'มาสายครึ่งชั่วโมง', 'the day note was stored');

-- G.2 a correction carries the note forward.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222ab0fe"}';
select ok(
  (select public.correct_labor_log(
     (select ll.id from public.labor_logs ll
       where ll.worker_id = 'aaaaaaa3-0000-4000-8000-000000ab0fe3'
         and ll.work_date = date '2026-06-12'
         and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
     'แก้เป็นครึ่งวัน', p_fraction => 'half')) is not null,
  'correction succeeds');

reset role;
select is(
  (select ll.note from public.labor_logs ll
    where ll.worker_id = 'aaaaaaa3-0000-4000-8000-000000ab0fe3'
      and ll.work_date = date '2026-06-12'
      and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  'มาสายครึ่งชั่วโมง', 'the correction carries the note forward (unedited)');

-- G.3 a tombstone removal clears the note.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222ab0fe"}';
select ok(
  (select public.correct_labor_log(
     (select ll.id from public.labor_logs ll
       where ll.worker_id = 'aaaaaaa3-0000-4000-8000-000000ab0fe3'
         and ll.work_date = date '2026-06-12'
         and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
     'ลบทิ้ง', p_tombstone => true)) is not null,
  'tombstone succeeds');

reset role;
select is(
  (select ll.note from public.labor_logs ll
    where ll.worker_id = 'aaaaaaa3-0000-4000-8000-000000ab0fe3'
      and ll.work_date = date '2026-06-12'
      and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  null::text, 'a tombstone removal clears the note');

-- G.4 the length CHECK rejects an over-long note.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222ab0fe"}';
select throws_ok(
  $$ select public.log_labor_day('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
       'aaaaaaa1-0000-4000-8000-000000ab0fe1', date '2026-06-13', 'full',
       repeat('x', 2001)) $$,
  '23514', null, 'a note longer than 2000 chars violates labor_logs_note_len');

reset role;

-- ============================================================================
-- F. Append-only triple layer (even as table owner the triggers refuse).
-- ============================================================================

select throws_ok(
  $$ update public.labor_logs set work_date = current_date
     where worker_id = 'aaaaaaa1-0000-4000-8000-000000ab0fe1' $$,
  'P0001', null, 'UPDATE on labor_logs blocked by trigger');
select throws_ok(
  $$ delete from public.labor_logs
     where worker_id = 'aaaaaaa1-0000-4000-8000-000000ab0fe1' $$,
  'P0001', null, 'DELETE on labor_logs blocked by trigger');
select throws_ok(
  $$ truncate public.labor_logs $$,
  'P0001', null, 'TRUNCATE on labor_logs blocked by trigger');

select * from finish();
rollback;
