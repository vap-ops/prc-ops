begin;
select plan(59);

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

-- Spec 143 U3 / ADR 0056: labor_logs SELECT is now membership-scoped — enrol the
-- PM/site_admin test users so the labor reads (and the correct_labor_log id
-- lookups) below see the rows. The log_labor_day/correct_labor_log RPCs are
-- definer and write regardless; this is for the SELECTs.
insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('TAP-LABOR')
     and u.id in (select au.id from auth.users au where au.email like '%@labor-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;

insert into public.contractors (id, name, created_by) values
  ('dddddddd-dddd-dddd-dddd-dddddddab0fe', 'DC Crew Co',
   '11111111-1111-1111-1111-1111111ab0fe');

-- Worker fixtures (direct insert as postgres — owner bypasses the
-- zero-grant posture; the app can only use the RPCs).
insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id,
                            day_rate, active, created_by) values
  ('aaaaaaa1-0000-4000-8000-000000ab0fe1', 'Own Tech A', 'monthly', 'permanent', null, null,
   500.00, true,  '11111111-1111-1111-1111-1111111ab0fe'),
  ('aaaaaaa2-0000-4000-8000-000000ab0fe2', 'Own Tech B (inactive)', 'monthly', 'permanent', null,
   null, 450.00, false, '11111111-1111-1111-1111-1111111ab0fe'),
  ('aaaaaaa3-0000-4000-8000-000000ab0fe3', 'DC Worker C', 'daily', 'permanent',
   'dddddddd-dddd-dddd-dddd-dddddddab0fe', null, 380.00, true,
   '11111111-1111-1111-1111-1111111ab0fe'),
  ('aaaaaaa4-0000-4000-8000-000000ab0fe4', 'SA Self Worker', 'monthly', 'permanent', null,
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
select enum_has_labels('public', 'pay_type', array['monthly', 'daily'],
  'pay_type labels');
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

-- The dc-contractor force-tie is DROPPED (spec 160 U1 / ADR 0061): a DC belongs
-- to a project, not a crew, so a contractor is no longer required at the
-- constraint layer. (own-has-no-contractor stays; see file 95.)
select is(
  (select count(*)::int from pg_constraint where conname = 'workers_dc_has_contractor'),
  0, 'the dc-contractor force-tie CHECK is dropped (spec 160 U1)');

-- ============================================================================
-- B. Money posture + zero direct writes (as authenticated SA).
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222ab0fe"}';

select throws_ok(
  $$ select day_rate from public.workers limit 1 $$,
  '42501', null, 'authenticated cannot read workers.day_rate (column grant)');
-- Scoped to the four fixtures so a real/concurrent worker in the roster can't
-- skew the visibility count (the table is shared + accumulates).
select ok(
  (select count(id) from public.workers
     where id in ('aaaaaaa1-0000-4000-8000-000000ab0fe1', 'aaaaaaa2-0000-4000-8000-000000ab0fe2',
                  'aaaaaaa3-0000-4000-8000-000000ab0fe3', 'aaaaaaa4-0000-4000-8000-000000ab0fe4')) = 4,
  'authenticated reads the roster (presence columns)');
select throws_ok(
  $$ select day_rate_snapshot from public.labor_logs limit 1 $$,
  '42501', null, 'authenticated cannot read labor_logs.day_rate_snapshot');
select throws_ok(
  $$ insert into public.workers (name, pay_type, employment_type, day_rate, created_by)
     values ('Rogue', 'monthly', 'permanent', 1, '22222222-2222-2222-2222-2222222ab0fe') $$,
  '42501', null, 'authenticated cannot INSERT workers directly');
select throws_ok(
  $$ insert into public.labor_logs (work_package_id, worker_id, work_date,
       day_fraction, day_rate_snapshot, worker_name_snapshot,
       pay_type_snapshot, entered_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeab0fe',
             'aaaaaaa1-0000-4000-8000-000000ab0fe1', current_date, 'full',
             0, 'x', 'monthly', '22222222-2222-2222-2222-2222222ab0fe') $$,
  '42501', null, 'authenticated cannot INSERT labor_logs directly');

-- ============================================================================
-- C. Worker RPC gates (SA refused; PM allowed; audit lands).
-- ============================================================================

select throws_ok(
  $$ select public.create_worker('New Guy', 'monthly', 'permanent', 400) $$,
  '42501', null, 'create_worker refuses site_admin');
select throws_ok(
  $$ select public.set_worker_day_rate('aaaaaaa1-0000-4000-8000-000000ab0fe1', 999) $$,
  '42501', null, 'set_worker_day_rate refuses site_admin');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-1111111ab0fe"}';

select ok(
  (select public.create_worker('New Own Tech', 'monthly', 'permanent', 470)) is not null,
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
-- Scoped to this test's PM actor: audit_log is append-only and accumulates, so
-- a real/concurrent worker_change would inflate a table-wide count.
select is(
  (select count(*) from public.audit_log
    where action = 'worker_change' and target_table = 'workers'
      and actor_id = '11111111-1111-1111-1111-1111111ab0fe'),
  3::bigint, 'worker RPCs wrote audit rows (create + rate + update)');

-- C.note (spec 75): the roster note rides create_worker / update_worker.
-- Placed AFTER the audit-count pin above so the two extra worker_change rows
-- it writes don't disturb that count.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-1111111ab0fe"}';
select ok(
  (select public.create_worker('Noted Tech', 'monthly', 'permanent', 400, p_note => 'มีหมายเหตุ')) is not null,
  'create_worker stores a note');
select lives_ok(
  $$ select public.update_worker('aaaaaaa1-0000-4000-8000-000000ab0fe1',
       p_note => 'แก้หมายเหตุ') $$,
  'update_worker sets a note');
select throws_ok(
  $$ select public.update_worker('aaaaaaa1-0000-4000-8000-000000ab0fe1',
       p_note => repeat('x', 2001)) $$,
  '23514', null, 'a note longer than 2000 chars violates workers_note_len');

reset role;
select is(
  (select note from public.workers where name = 'Noted Tech'),
  'มีหมายเหตุ', 'create_worker note landed');
select is(
  (select note from public.workers where id = 'aaaaaaa1-0000-4000-8000-000000ab0fe1'),
  'แก้หมายเหตุ', 'update_worker note landed');
select is(
  (select name from public.workers where id = 'aaaaaaa1-0000-4000-8000-000000ab0fe1'),
  'Own Tech A1', 'a note-only update preserves the name (coalesce)');

-- C.dc (ADR 0073, was ADR 0062 U1): a ช่าง worker's pay_type/employment_type
-- (ประจำ/ชั่วคราว) + payee fields, no contractor parent required. bank_* + tax_id
-- are money/PII-isolated like day_rate (no authenticated grant); employment_type
-- is non-sensitive and readable.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222ab0fe"}';
select throws_ok(
  $$ select bank_account_number from public.workers limit 1 $$,
  '42501', null, 'authenticated cannot read workers.bank_account_number (isolated)');
select throws_ok(
  $$ select tax_id from public.workers limit 1 $$,
  '42501', null, 'authenticated cannot read workers.tax_id (isolated)');
select lives_ok(
  $$ select employment_type from public.workers limit 1 $$,
  'authenticated can read workers.employment_type (granted, non-sensitive)');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-1111111ab0fe"}';
select ok(
  (select public.create_worker('DC Direct', 'daily', 'temporary', 420,
     p_bank_account_number => '1234567890')) is not null,
  'create_worker makes a daily-pay, temporary worker with no contractor parent + bank');

reset role;
select is(
  (select employment_type from public.workers where name = 'DC Direct'),
  'temporary'::public.employment_type, 'create_worker stored the employment_type');
select is(
  (select bank_account_number from public.workers where name = 'DC Direct'),
  '1234567890', 'create_worker stored the (isolated) bank account number');

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
