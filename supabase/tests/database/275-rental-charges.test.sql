begin;
select plan(55);

-- ============================================================================
-- Spec 275 U2 — one-time rental fees (rental_charges), mirroring spec 260's
-- purchase_order_charges but SIMPLER: a rental batch has no member lines, so
-- there is no proportional split — the whole net posts to one 1400 WIP leg.
-- Pins: enum + table shape + ZERO-GRANT posture (mirrors equipment_rental_batches
-- — RLS on, no policy, no authenticated grant at all); add gate (site_admin +
-- visitor refused, the 5 create-roles allowed) + validation CHECKs (amount > 0,
-- 'other' requires note); the outbox job enqueued with source_event
-- 'rental_charge'; the GL legs (Dr 1400 net + Dr 1300 Input VAT / Cr 2100 gross
-- with supplier party) for a VAT charge and a zero-VAT charge; drain_gl_posting
-- routes 'rental_charges' without dropping any pre-existing arm; void charge
-- (gate: plain procurement + site_admin refused, PM + procurement_manager
-- admitted; posted → reversed + row deleted, pending → job skipped + row deleted).
--
-- Data-independence (#243 lesson): every charge/audit lookup is scoped to the
-- fixture batch (aa…275) + a DISTINCT amount, never a bare amount a prod row
-- could also carry.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110275', 'pm@rc.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220275', 'sa@rc.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330275', 'vi@rc.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440275', 'proc@rc.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550275', 'pd@rc.local',   '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660275', 'super@rc.local','{}'::jsonb),
  ('77777777-7777-7777-7777-777777770275', 'pmgr@rc.local', '{}'::jsonb);
update public.users set role = 'project_manager'     where id = '11111111-1111-1111-1111-111111110275';
update public.users set role = 'site_admin'          where id = '22222222-2222-2222-2222-222222220275';
-- 33… stays visitor (the enum default)
update public.users set role = 'procurement'         where id = '44444444-4444-4444-4444-444444440275';
update public.users set role = 'project_director'    where id = '55555555-5555-5555-5555-555555550275';
update public.users set role = 'super_admin'         where id = '66666666-6666-6666-6666-666666660275';
update public.users set role = 'procurement_manager' where id = '77777777-7777-7777-7777-777777770275';

insert into public.suppliers (id, name, created_by) values
  ('bb000275-0000-4000-8000-000000000001', 'บ.เครนทดสอบ ค่าธรรมเนียม',
   '11111111-1111-1111-1111-111111110275');

-- The fixture rental batch. owner_id is omitted (U1 relaxed it to nullable);
-- rate_period / status / deposit_amount all carry their defaults.
insert into public.equipment_rental_batches
    (id, supplier_id, monthly_rate, starts_on, created_by) values
  ('aa000275-0000-4000-8000-000000000001',
   'bb000275-0000-4000-8000-000000000001', 90000, date '2026-07-01',
   '11111111-1111-1111-1111-111111110275');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Structure: enum, table shape, ZERO-GRANT posture, RPC/poster/trigger/drain.
-- ============================================================================
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
     from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'rental_charge_type'),
  'delivery,pickup,cleaning,insurance,other', 'rental_charge_type enum membership');
select ok(
  (select string_agg(e.enumlabel, ',') from pg_type t
     join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'audit_action') like '%rental_charge_add%',
  'audit_action gained rental_charge_add');
select ok(
  (select string_agg(e.enumlabel, ',') from pg_type t
     join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'audit_action') like '%rental_charge_void%',
  'audit_action gained rental_charge_void');
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'rental_charges'),
  'id,rental_batch_id,charge_type,amount,vat_rate,note,created_by,created_at',
  'rental_charges has exactly the spec columns');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.rental_charges'::regclass),
  'RLS enabled on rental_charges');
select is(
  (select count(*)::int from pg_policy where polrelid = 'public.rental_charges'::regclass),
  0, 'zero-grant money table: NO policies at all (admin-read only, mirrors the batch)');
select is(has_table_privilege('authenticated', 'public.rental_charges', 'INSERT'),
  false, 'authenticated has no INSERT grant');
select is(has_table_privilege('authenticated', 'public.rental_charges', 'UPDATE'),
  false, 'authenticated has no UPDATE grant');
select is(has_table_privilege('authenticated', 'public.rental_charges', 'DELETE'),
  false, 'authenticated has no DELETE grant');
select is(has_table_privilege('authenticated', 'public.rental_charges', 'SELECT'),
  false, 'authenticated has no SELECT grant (zero-grant — unlike the PO-charge table)');
select is(has_table_privilege('anon', 'public.rental_charges', 'SELECT'),
  false, 'anon has no SELECT grant');
select ok(to_regprocedure(
  'public.add_rental_charge(uuid, rental_charge_type, numeric, numeric, text)') is not null,
  'add_rental_charge exists with the spec signature');
select ok(to_regprocedure('public.void_rental_charge(uuid)') is not null,
  'void_rental_charge exists');
select ok(to_regprocedure('public.post_rental_charge_to_gl(uuid)') is not null,
  'post_rental_charge_to_gl exists');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('add_rental_charge', 'void_rental_charge', 'post_rental_charge_to_gl')
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'),
  3, 'all three charge functions are SECURITY DEFINER with pinned search_path');
select is(has_function_privilege('anon',
  'public.add_rental_charge(uuid, rental_charge_type, numeric, numeric, text)', 'EXECUTE'),
  false, 'anon cannot execute add_rental_charge');
select ok(has_function_privilege('authenticated',
  'public.add_rental_charge(uuid, rental_charge_type, numeric, numeric, text)', 'EXECUTE'),
  'authenticated may execute add_rental_charge');
select is(has_function_privilege('authenticated',
  'public.post_rental_charge_to_gl(uuid)', 'EXECUTE'),
  false, 'the poster is internal — authenticated cannot execute it');
select is(has_function_privilege('anon',
  'public.void_rental_charge(uuid)', 'EXECUTE'),
  false, 'anon cannot execute void_rental_charge');
select ok(has_function_privilege('authenticated',
  'public.void_rental_charge(uuid)', 'EXECUTE'),
  'authenticated may execute void_rental_charge');
select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.rental_charges'::regclass
      and not tgisinternal
      and tgname = 'rental_charges_enqueue_gl_posting'),
  1, 'AFTER INSERT enqueue trigger installed on rental_charges');
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'drain_gl_posting')
    like '%rental_charges%',
  'drain_gl_posting routes rental_charges');
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'drain_gl_posting')
    like all (array[
      '%purchase_requests%', '%wage_payments%', '%wp_labor_costs%',
      '%equipment_rental_batches%', '%client_billings%', '%retention_receivables%',
      '%wht_certificates%', '%client_receipts%', '%stock_receipts%',
      '%stock_issues%', '%stock_returns%', '%stock_counts%', '%stock_reversals%',
      '%subcontract_payments%', '%purchase_order_charges%']),
  'no pre-existing drain arm was dropped by the re-source');

-- ============================================================================
-- B. add gate (the 5 create-roles allowed; site_admin + visitor refused) +
--    validation CHECKs. Each admitted role adds one DISTINCT-amount charge.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220275"}';  -- site_admin
select throws_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'delivery', 10, 0, null) $$,
  '42501', null, 'add refuses site_admin');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330275"}';  -- visitor
select throws_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'delivery', 10, 0, null) $$,
  '42501', null, 'add refuses visitor');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110275"}';  -- PM
select lives_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'delivery', 11, 0, null) $$,
  'project_manager may add a charge');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440275"}';  -- procurement
select lives_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'pickup', 12, 0, null) $$,
  'procurement may add a charge');
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777770275"}';  -- procurement_manager
select lives_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'cleaning', 13, 0, null) $$,
  'procurement_manager may add a charge (spec 261 parity)');
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660275"}';  -- super_admin
select lives_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'insurance', 14, 0, null) $$,
  'super_admin may add a charge');
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550275"}';  -- project_director
select lives_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'other', 15, 0, 'ค่าเอกสาร') $$,
  'project_director may add a charge (ADR 0058 completeness)');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110275"}';
select throws_ok(
  $$ select public.add_rental_charge(
       '00000000-0000-0000-0000-000000000000'::uuid, 'delivery', 10, 0, null) $$,
  'P0001', null, 'add refuses an unknown batch id');
select throws_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'delivery', 0, 0, null) $$,
  '23514', null, 'CHECK refuses amount = 0 (always positive)');
select throws_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'other', 10, 0, '  ') $$,
  '23514', null, 'CHECK refuses an ''other'' charge without a note');
reset role;

-- ============================================================================
-- C. The AFTER-INSERT trigger enqueued an outbox job + the add audit row
--    (the PM delivery-11 charge).
-- ============================================================================
select is(
  (select status::text from public.gl_posting_outbox
    where source_table = 'rental_charges'
      and source_id = (select id from public.rental_charges
                        where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                          and charge_type = 'delivery' and amount = 11)
      and source_event = 'rental_charge'),
  'pending', 'add enqueued a pending outbox job with source_event rental_charge');
select is(
  (select count(*)::int from public.audit_log
    where action = 'rental_charge_add'
      and payload->>'charge_type' = 'delivery'
      and (payload->>'amount')::numeric = 11
      and payload->>'rental_batch_id' = 'aa000275-0000-4000-8000-000000000001'),
  1, 'one rental_charge_add audit row with {rental_batch_id, charge_type, amount}');

-- ============================================================================
-- D. GL legs. delivery 107 @7% → net 100 / VAT 7: Dr 1400 100 + Dr 1300 7 /
--    Cr 2100 107 (supplier). Routed through drain_gl_posting (proves the arm).
--    Then cleaning 500 @0% → Dr 1400 500 / Cr 2100 500, NO 1300 leg (poster
--    called directly).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110275"}';
select lives_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'delivery', 107, 7, null) $$,
  'PM adds delivery 107 @7%');
reset role;

select ok((select public.drain_gl_posting() >= 1), 'drain_gl_posting processed jobs');
select is(
  (select o.status::text from public.gl_posting_outbox o
    where o.source_table = 'rental_charges'
      and o.source_id = (select id from public.rental_charges
                          where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                            and charge_type = 'delivery' and amount = 107)
      and o.source_event = 'rental_charge'),
  'posted', 'the charge job drained to posted (the rental_charges arm routed it)');
select is(
  (select l.debit from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1400'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_charges'
                           and e.source_id = (select id from public.rental_charges
                                               where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                                                 and charge_type = 'delivery' and amount = 107)
                           and e.source_event = 'rental_charge' and e.status = 'posted')),
  100::numeric, 'delivery: Dr 1400 WIP = 100 (net)');
select ok(
  (select l.project_id is null and l.work_package_id is null
     from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1400'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_charges'
                           and e.source_id = (select id from public.rental_charges
                                               where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                                                 and charge_type = 'delivery' and amount = 107)
                           and e.source_event = 'rental_charge' and e.status = 'posted')),
  'delivery: the WIP leg carries no project/WP dimension (mirrors the rent poster)');
select is(
  (select l.debit from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1300'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_charges'
                           and e.source_id = (select id from public.rental_charges
                                               where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                                                 and charge_type = 'delivery' and amount = 107)
                           and e.source_event = 'rental_charge' and e.status = 'posted')),
  7::numeric, 'delivery: Dr 1300 Input VAT = 7');
select ok(
  (select l.credit = 107 and l.supplier_id = 'bb000275-0000-4000-8000-000000000001'
     from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '2100'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_charges'
                           and e.source_id = (select id from public.rental_charges
                                               where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                                                 and charge_type = 'delivery' and amount = 107)
                           and e.source_event = 'rental_charge' and e.status = 'posted')),
  'delivery: Cr 2100 AP = 107 gross, supplier-dimensioned');
select is(
  (select sum(l.debit) - sum(l.credit) from public.journal_lines l
    where l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_charges'
                           and e.source_id = (select id from public.rental_charges
                                               where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                                                 and charge_type = 'delivery' and amount = 107)
                           and e.source_event = 'rental_charge' and e.status = 'posted')),
  0::numeric, 'delivery entry balances (ΣDr = ΣCr)');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110275"}';
select lives_ok(
  $$ select public.add_rental_charge(
       'aa000275-0000-4000-8000-000000000001'::uuid, 'cleaning', 500, 0, null) $$,
  'PM adds cleaning 500 @0%');
reset role;
select public.post_rental_charge_to_gl(
  (select id from public.rental_charges
    where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
      and charge_type = 'cleaning' and amount = 500));
select is(
  (select l.debit from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1400'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_charges'
                           and e.source_id = (select id from public.rental_charges
                                               where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                                                 and charge_type = 'cleaning' and amount = 500)
                           and e.source_event = 'rental_charge' and e.status = 'posted')),
  500::numeric, 'cleaning: Dr 1400 WIP = 500 (net = gross, no VAT)');
select is(
  (select count(*)::int from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '1300'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_charges'
                           and e.source_id = (select id from public.rental_charges
                                               where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                                                 and charge_type = 'cleaning' and amount = 500)
                           and e.source_event = 'rental_charge' and e.status = 'posted')),
  0, 'cleaning: no Input VAT leg when vat_rate = 0');
select ok(
  (select l.credit = 500 and l.supplier_id = 'bb000275-0000-4000-8000-000000000001'
     from public.journal_lines l
     join public.gl_accounts a on a.id = l.account_id
    where a.code = '2100'
      and l.entry_id = (select e.id from public.journal_entries e
                         where e.source_table = 'rental_charges'
                           and e.source_id = (select id from public.rental_charges
                                               where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                                                 and charge_type = 'cleaning' and amount = 500)
                           and e.source_event = 'rental_charge' and e.status = 'posted')),
  'cleaning: Cr 2100 AP = 500 gross, supplier-dimensioned');

-- ============================================================================
-- E. Void: gate (plain procurement + site_admin refused; PM + procurement_manager
--    admitted); posted → reversed + deleted, pending → skipped + deleted.
-- ============================================================================
-- rental_charges is ZERO-GRANT — the authenticated role cannot SELECT it (the
-- void RPC reads it internally as definer). Resolve the target charge ids AS
-- OWNER into session GUCs, so the gated void calls pass a uuid without reading
-- the zero-grant table under authenticated (which would raise its OWN 42501 and
-- mask the gate — a false pass).
reset role;
do $$
begin
  perform set_config('test275.charge11',
    (select id::text from public.rental_charges
      where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
        and charge_type = 'delivery' and amount = 11), false);
  perform set_config('test275.charge107',
    (select id::text from public.rental_charges
      where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
        and charge_type = 'delivery' and amount = 107), false);
end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440275"}';  -- procurement
select throws_ok(
  $$ select public.void_rental_charge(current_setting('test275.charge11')::uuid) $$,
  '42501', null, 'void refuses plain procurement (manager-only: un-booking money)');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220275"}';  -- site_admin
select throws_ok(
  $$ select public.void_rental_charge(current_setting('test275.charge11')::uuid) $$,
  '42501', null, 'void refuses site_admin');

-- PM voids the POSTED delivery-107 charge → its entry is reversed, row deleted.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110275"}';
select lives_ok(
  $$ select public.void_rental_charge(current_setting('test275.charge107')::uuid) $$,
  'project_manager voids the posted delivery charge');
reset role;
-- The 2100 credit of 107 uniquely identifies the delivery-107 charge entry
-- (the charge row is now deleted, so scope via the journal line, not the charge).
select is(
  (select count(*)::int from public.journal_entries r
    where r.reversal_of in (
      select e.id from public.journal_entries e
       where e.source_table = 'rental_charges' and e.source_event = 'rental_charge'
         and e.status = 'posted' and e.reversal_of is null
         and e.id in (select l.entry_id from public.journal_lines l
                        join public.gl_accounts a on a.id = l.account_id
                       where a.code = '2100' and l.credit = 107))),
  1, 'void: the posted charge entry got exactly one reversal entry');
select ok(
  not exists (select 1 from public.rental_charges
               where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                 and charge_type = 'delivery' and amount = 107),
  'void: the posted charge row is deleted');

-- procurement_manager voids a FRESH still-pending charge → job skipped, row gone.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110275"}';  -- PM adds
select public.add_rental_charge(
  'aa000275-0000-4000-8000-000000000001'::uuid, 'other', 30, 0, 'ค่ามัดจำ');
reset role;
-- Resolve the fresh charge's id as owner (zero-grant table).
do $$
begin
  perform set_config('test275.charge30',
    (select id::text from public.rental_charges
      where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
        and charge_type = 'other' and amount = 30), false);
end $$;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "77777777-7777-7777-7777-777777770275"}';  -- procurement_manager voids
select lives_ok(
  $$ select public.void_rental_charge(current_setting('test275.charge30')::uuid) $$,
  'procurement_manager voids a still-pending charge (spec 261 item 2 gate)');
reset role;
select is(
  (select o.status::text from public.gl_posting_outbox o
    where o.source_table = 'rental_charges' and o.source_event = 'rental_charge'
      -- Scope via the void audit (target_id) — the charge row is gone (#243).
      and o.source_id = (select target_id from public.audit_log
                          where action = 'rental_charge_void'
                            and payload->>'charge_type' = 'other'
                            and (payload->>'amount')::numeric = 30
                            and payload->>'rental_batch_id' = 'aa000275-0000-4000-8000-000000000001')),
  'skipped', 'void: the pending job is skipped, never postable');
select ok(
  not exists (select 1 from public.rental_charges
               where rental_batch_id = 'aa000275-0000-4000-8000-000000000001'
                 and charge_type = 'other' and amount = 30),
  'void: the pending charge row is deleted too');

select * from finish();
rollback;
