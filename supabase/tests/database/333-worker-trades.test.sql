begin;
select plan(39);

-- ============================================================================
-- Spec 332 U1 — worker_trades (สายงานช่าง): assignment-axis trade tags from
-- workers to TOP-LEVEL work_categories (W01–W09).
--   * Sole writer = set_worker_trades(p_worker, p_categories, p_primary):
--     full-replace in one txn; gate PM/PD/super (null-safe); categories must
--     exist + be top-level (char_length(code)=3) + active; primary must be a
--     member of the set; array deduped silently; empty set clears.
--   * Same-errcode guards carry DISTINCT messages and every throws_ok below
--     pins the message (spec 330 U3c lesson).
--   * Table: RLS select for authenticated, DML revoked (writes RPC-only);
--     one-primary partial unique index; cascade on worker delete.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0332-0332-0332-700000000332', 'pm@s332.local',      '{}'::jsonb),
  ('71000000-0332-0332-0332-710000000332', 'pd@s332.local',      '{}'::jsonb),
  ('72000000-0332-0332-0332-720000000332', 'visitor@s332.local', '{}'::jsonb),
  ('73000000-0332-0332-0332-730000000332', 'tech@s332.local',    '{}'::jsonb);
update public.users set role = 'project_manager'  where id = '70000000-0332-0332-0332-700000000332';
update public.users set role = 'project_director' where id = '71000000-0332-0332-0332-710000000332';
update public.users set role = 'visitor'          where id = '72000000-0332-0332-0332-720000000332';
update public.users set role = 'technician'       where id = '73000000-0332-0332-0332-730000000332';

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('e1000000-0332-0332-0332-e10000000332', 'ช่างหลัก',    'daily', 'temporary', 400, true,
   '70000000-0332-0332-0332-700000000332'),
  ('e2000000-0332-0332-0332-e20000000332', 'ช่างของ PD',  'daily', 'temporary', 400, true,
   '70000000-0332-0332-0332-700000000332'),
  ('e3000000-0332-0332-0332-e30000000332', 'ช่างจะถูกลบ', 'daily', 'temporary', 400, true,
   '70000000-0332-0332-0332-700000000332');

-- an INACTIVE top-level category for the validation assert (rolled back with the txn)
insert into public.work_categories (id, code, name_th, is_active) values
  ('c9800000-0332-0332-0332-c98000000332', 'W98', 'หมวดทดสอบปิดใช้งาน', false);

-- role-switched asserts write into the runner's collector (pgtap-tapbuf lesson, PR #400)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Existence + anon lock.
-- ============================================================================
select has_table('public', 'worker_trades', 'worker_trades table exists');
select has_function('public', 'set_worker_trades', array['uuid', 'uuid[]', 'uuid'],
  'set_worker_trades exists');
select is(has_function_privilege('anon', 'public.set_worker_trades(uuid, uuid[], uuid)', 'EXECUTE'),
  false, 'anon cannot execute set_worker_trades');
select is(has_function_privilege('authenticated', 'public.set_worker_trades(uuid, uuid[], uuid)', 'EXECUTE'),
  true, 'authenticated can execute set_worker_trades');

-- ============================================================================
-- B. Structure: is_primary column, RLS enabled, one-primary partial unique index.
-- ============================================================================
select has_column('public', 'worker_trades', 'is_primary', 'worker_trades.is_primary exists');
select is((select relrowsecurity from pg_class where oid = 'public.worker_trades'::regclass),
  true, 'RLS enabled on worker_trades');
-- pin the PREDICATE, not just the column name: a `unique (worker_id, is_primary)`
-- index would satisfy a name-only match while forbidding two non-primary trades.
select is((select count(*)::int from pg_indexes
            where schemaname = 'public' and tablename = 'worker_trades'
              and indexdef like 'CREATE UNIQUE INDEX%'
              and indexdef like '%(worker_id) WHERE is_primary%'),
  1, 'one-primary index is partial on (worker_id) where is_primary');

-- ============================================================================
-- C. Role gate (null-safe) + PD allowed.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array[(select id from public.work_categories where code = 'W01')], null) $$,
  '42501', 'set_worker_trades: role not permitted',
  'a null-role session cannot set trades (null-safe gate)');

set local "request.jwt.claims" = '{"sub": "72000000-0332-0332-0332-720000000332"}';
select throws_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array[(select id from public.work_categories where code = 'W01')], null) $$,
  '42501', 'set_worker_trades: role not permitted',
  'visitor cannot set trades');

set local "request.jwt.claims" = '{"sub": "71000000-0332-0332-0332-710000000332"}';
select lives_ok(
  $$ select public.set_worker_trades('e2000000-0332-0332-0332-e20000000332',
       array[(select id from public.work_categories where code = 'W01')],
       (select id from public.work_categories where code = 'W01')) $$,
  'project_director can set trades');
reset role;

select is((select count(*)::int from public.worker_trades
            where worker_id = 'e2000000-0332-0332-0332-e20000000332'),
  1, 'PD write landed one tag row');

-- ============================================================================
-- D. PM happy path: set, primary, audit, full-replace, dedup, clear.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0332-0332-0332-700000000332"}';
select lives_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array[(select id from public.work_categories where code = 'W01'),
             (select id from public.work_categories where code = 'W05')],
       (select id from public.work_categories where code = 'W01')) $$,
  'PM sets two trades with W01 primary');
reset role;

select is((select count(*)::int from public.worker_trades
            where worker_id = 'e1000000-0332-0332-0332-e10000000332'),
  2, 'two tag rows after PM set');
select is((select wc.code from public.worker_trades wt
            join public.work_categories wc on wc.id = wt.work_category_id
            where wt.worker_id = 'e1000000-0332-0332-0332-e10000000332' and wt.is_primary),
  'W01', 'primary flag sits on W01');
select is((select count(*)::int from public.audit_log
            where action = 'worker_change'
              and target_id = 'e1000000-0332-0332-0332-e10000000332'
              and payload->>'kind' = 'trades_change'),
  1, 'one trades_change audit row written');
select is((select payload->'categories' from public.audit_log
            where action = 'worker_change'
              and target_id = 'e1000000-0332-0332-0332-e10000000332'
              and payload->>'kind' = 'trades_change'),
  '["W01", "W05"]'::jsonb, 'audit payload carries the category codes');
select is((select payload->>'primary' from public.audit_log
            where action = 'worker_change'
              and target_id = 'e1000000-0332-0332-0332-e10000000332'
              and payload->>'kind' = 'trades_change'),
  'W01', 'audit payload carries the primary code');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0332-0332-0332-700000000332"}';
select lives_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array[(select id from public.work_categories where code = 'W05')],
       (select id from public.work_categories where code = 'W05')) $$,
  'PM replaces the set with W05 only');
reset role;

select is((select count(*)::int from public.worker_trades
            where worker_id = 'e1000000-0332-0332-0332-e10000000332'),
  1, 'full-replace left exactly one row');
select is((select wc.code from public.worker_trades wt
            join public.work_categories wc on wc.id = wt.work_category_id
            where wt.worker_id = 'e1000000-0332-0332-0332-e10000000332'),
  'W05', 'surviving row is W05');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0332-0332-0332-700000000332"}';
select lives_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array[(select id from public.work_categories where code = 'W01'),
             (select id from public.work_categories where code = 'W01')], null) $$,
  'repeated id in the array is accepted (silent dedup)');
reset role;

select is((select count(*)::int from public.worker_trades
            where worker_id = 'e1000000-0332-0332-0332-e10000000332'),
  1, 'duplicate ids deduped to one row');

-- multiple trades with NO primary: two is_primary=false rows must coexist. This is
-- the assert a `unique (worker_id, is_primary)` index would break (the name-only
-- index pin above cannot tell the two shapes apart).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0332-0332-0332-700000000332"}';
select lives_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array[(select id from public.work_categories where code = 'W01'),
             (select id from public.work_categories where code = 'W05')], null) $$,
  'two trades with no primary accepted');
reset role;

select is((select count(*)::int from public.worker_trades
            where worker_id = 'e1000000-0332-0332-0332-e10000000332'
              and not is_primary),
  2, 'two non-primary trades coexist on one worker');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0332-0332-0332-700000000332"}';
select lives_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       '{}'::uuid[], null) $$,
  'empty set clears all tags (valid)');
reset role;

select is((select count(*)::int from public.worker_trades
            where worker_id = 'e1000000-0332-0332-0332-e10000000332'),
  0, 'clear removed every tag row');

-- ============================================================================
-- E. Validation guards — same errcode, DISTINCT pinned messages.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0332-0332-0332-700000000332"}';
select throws_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array['dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid], null) $$,
  '22023', 'set_worker_trades: invalid category',
  'unknown category id refused');
select throws_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array[(select id from public.work_categories where code = 'W0101')], null) $$,
  '22023', 'set_worker_trades: invalid category',
  'sub-level category (W0101) refused — top-9 grain only');
select throws_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array['c9800000-0332-0332-0332-c98000000332'::uuid], null) $$,
  '22023', 'set_worker_trades: invalid category',
  'inactive category refused');
select throws_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array[(select id from public.work_categories where code = 'W01')],
       (select id from public.work_categories where code = 'W05')) $$,
  '22023', 'set_worker_trades: primary not in set',
  'primary outside the set refused (distinct message)');
select throws_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       '{}'::uuid[],
       (select id from public.work_categories where code = 'W01')) $$,
  '22023', 'set_worker_trades: primary not in set',
  'empty set with a primary refused');
select throws_ok(
  $$ select public.set_worker_trades('dddddddd-dddd-dddd-dddd-dddddddddddd',
       array[(select id from public.work_categories where code = 'W01')], null) $$,
  'P0001', 'set_worker_trades: worker not found',
  'missing worker refused');
select lives_ok(
  $$ select public.set_worker_trades('e1000000-0332-0332-0332-e10000000332',
       array[(select id from public.work_categories where code = 'W01')],
       (select id from public.work_categories where code = 'W01')) $$,
  're-seed one primary tag for the RLS + index sections');
reset role;

-- ============================================================================
-- F. RLS: authenticated reads, all direct DML refused (writes RPC-only).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "73000000-0332-0332-0332-730000000332"}';
select is((select count(*)::int from public.worker_trades
            where worker_id = 'e1000000-0332-0332-0332-e10000000332'),
  1, 'authenticated session can read trade tags');
select throws_ok(
  $$ insert into public.worker_trades (worker_id, work_category_id)
     values ('e1000000-0332-0332-0332-e10000000332',
             (select id from public.work_categories where code = 'W02')) $$,
  '42501', null, 'direct insert refused');
select throws_ok(
  $$ update public.worker_trades set is_primary = false
     where worker_id = 'e1000000-0332-0332-0332-e10000000332' $$,
  '42501', null, 'direct update refused');
select throws_ok(
  $$ delete from public.worker_trades
     where worker_id = 'e1000000-0332-0332-0332-e10000000332' $$,
  '42501', null, 'direct delete refused');
reset role;

-- ============================================================================
-- G. DB invariants: one primary per worker; cascade with the worker.
-- ============================================================================
select throws_ok(
  $$ insert into public.worker_trades (worker_id, work_category_id, is_primary)
     values ('e1000000-0332-0332-0332-e10000000332',
             (select id from public.work_categories where code = 'W05'), true) $$,
  '23505', null, 'second primary for the same worker violates the partial unique index');

insert into public.worker_trades (worker_id, work_category_id)
values ('e3000000-0332-0332-0332-e30000000332',
        (select id from public.work_categories where code = 'W01'));
delete from public.workers where id = 'e3000000-0332-0332-0332-e30000000332';
select is((select count(*)::int from public.worker_trades
            where worker_id = 'e3000000-0332-0332-0332-e30000000332'),
  0, 'worker delete cascades to its trade tags');

select * from finish();
rollback;
