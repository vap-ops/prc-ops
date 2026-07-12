begin;
select plan(14);

-- ============================================================================
-- Spec 312 — void_equipment_rental_batch. Pins: the back-office role gate
-- (site_admin + visitor refused 42501; procurement ALLOWED — mirrors
-- create_equipment_rental_batch), the state/guards (RB404 unknown, RB409
-- non-active, RB409 batch-with-charge), and the money effect (reverses the
-- posted rental GL so the payable nets to zero, marks the batch cancelled,
-- clears pending outbox, writes exactly one equipment_batch_void audit row).
--
-- Identity is driven by request.jwt.claims only (auth.uid()/current_user_role()
-- read the JWT) — the RPC is SECURITY DEFINER, so no PG-role switch is needed and
-- setup/effect reads run as the owner (past the zero-grant money posture).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110312', 'pm@void312.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220312', 'sa@void312.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330312', 'vi@void312.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440312', 'proc@void312.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110312';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220312';
update public.users set role = 'procurement'     where id = '44444444-4444-4444-4444-444444440312';
-- third user stays visitor

insert into public.suppliers (id, name, created_by) values
  ('5a000001-0000-4000-8000-000000000312', 'Void Vendor 312',
   '11111111-1111-1111-1111-111111110312');

-- Two batches, created via the real RPC (as pm — JWT drives the gate).
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110312"}';
select public.create_equipment_rental_batch(
  '5a000001-0000-4000-8000-000000000312', 50000, date '2026-07-01');  -- batch A
select public.create_equipment_rental_batch(
  '5a000001-0000-4000-8000-000000000312', 60000, date '2026-08-01');  -- batch B
set local "request.jwt.claims" = '{}';

-- Batch A → drained state: post its GL synchronously (what the cron drain does)
-- and mark its outbox posted, so void has a real posted entry to reverse.
select public.post_rental_batch_to_gl(
  (select id from public.equipment_rental_batches
     where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-07-01'));
update public.gl_posting_outbox
   set status = 'posted'
 where source_table = 'equipment_rental_batches'
   and source_id = (select id from public.equipment_rental_batches
                      where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-07-01');

-- Batch B → attach a charge so void must refuse it (RB409). rental_charges has no
-- block trigger — seed it directly as owner.
insert into public.rental_charges (rental_batch_id, charge_type, amount, vat_rate, created_by)
values ((select id from public.equipment_rental_batches
           where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-08-01'),
        'cleaning', 500, 0, '11111111-1111-1111-1111-111111110312');

-- Batch C → a DEPOSIT-PAID batch. A paid deposit books a SECOND GL leg under the
-- synthetic source_table='rental_deposits' (source_id = the batch id), so void
-- must reverse BOTH legs. The RPC accepts a deposit + paid date even though the
-- current UI does not yet send a paid date.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110312"}';
select public.create_equipment_rental_batch(
  '5a000001-0000-4000-8000-000000000312', 40000, date '2026-09-01',
  p_deposit_amount => 5000, p_deposit_paid_date => date '2026-09-01');
set local "request.jwt.claims" = '{}';
select public.post_rental_batch_to_gl(
  (select id from public.equipment_rental_batches
     where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-09-01'));
select public.post_rental_deposit_to_gl(
  (select id from public.equipment_rental_batches
     where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-09-01'));

-- ============================================================================
-- A. Role gate — site_admin and visitor refused (money).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220312"}';
select throws_ok(
  $$ select public.void_equipment_rental_batch(
       (select id from public.equipment_rental_batches
          where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-07-01')) $$,
  '42501', null, 'void_equipment_rental_batch refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330312"}';
select throws_ok(
  $$ select public.void_equipment_rental_batch(
       (select id from public.equipment_rental_batches
          where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-07-01')) $$,
  '42501', null, 'void_equipment_rental_batch refuses visitor');

-- ============================================================================
-- B. Procurement allowed — guards then happy path.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440312"}';
select throws_ok(
  $$ select public.void_equipment_rental_batch('d0000099-0000-4000-8000-000000000099') $$,
  'RB404', null, 'unknown batch id → RB404');
select lives_ok(
  $$ select public.void_equipment_rental_batch(
       (select id from public.equipment_rental_batches
          where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-07-01'),
       'system test') $$,
  'procurement voids an active rental batch');
select throws_ok(
  $$ select public.void_equipment_rental_batch(
       (select id from public.equipment_rental_batches
          where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-07-01')) $$,
  'RB409', null, 're-voiding a cancelled batch → RB409');
select throws_ok(
  $$ select public.void_equipment_rental_batch(
       (select id from public.equipment_rental_batches
          where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-08-01')) $$,
  'RB409', null, 'a batch with a charge cannot be voided → RB409');

-- ============================================================================
-- C. Effects (reads run as owner — past the zero-grant posture).
-- ============================================================================
set local "request.jwt.claims" = '{}';
select is(
  (select status::text from public.equipment_rental_batches
     where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-07-01'),
  'cancelled', 'batch A is cancelled');
select is(
  (select count(*) from public.journal_entries
     where reversal_of = (select e.id from public.journal_entries e
                            where e.source_table = 'equipment_rental_batches'
                              and e.source_id = (select id from public.equipment_rental_batches
                                                   where supplier_id = '5a000001-0000-4000-8000-000000000312'
                                                     and starts_on = date '2026-07-01')
                              and e.source_event = 'rental_batch' and e.reversal_of is null)),
  1::bigint, 'the rental GL entry gained exactly one reversal');
-- Every account touched by the batch (both possible GL legs) plus their reversals
-- nets to zero — a general balance check that also catches a stranded deposit leg,
-- not just the payable.
select is(
  (select count(*) from (
     select l.account_id
       from public.journal_lines l
      where l.entry_id in (
        select id from public.journal_entries
          where source_table in ('equipment_rental_batches', 'rental_deposits')
            and source_id = (select id from public.equipment_rental_batches
                               where supplier_id = '5a000001-0000-4000-8000-000000000312'
                                 and starts_on = date '2026-07-01')
        union
        select id from public.journal_entries
          where reversal_of in (
            select id from public.journal_entries
              where source_table in ('equipment_rental_batches', 'rental_deposits')
                and source_id = (select id from public.equipment_rental_batches
                                   where supplier_id = '5a000001-0000-4000-8000-000000000312'
                                     and starts_on = date '2026-07-01')))
      group by l.account_id
      having sum(l.debit - l.credit) <> 0) x),
  0::bigint, 'every account touched by batch A nets to zero after the reversal');
select is(
  (select count(*) from public.gl_posting_outbox
     where source_table = 'equipment_rental_batches'
       and source_id = (select id from public.equipment_rental_batches
                          where supplier_id = '5a000001-0000-4000-8000-000000000312'
                            and starts_on = date '2026-07-01')
       and status in ('pending', 'posting')),
  0::bigint, 'no pending/posting outbox job remains for the voided batch');
select is(
  (select count(*) from public.audit_log
     where action = 'equipment_batch_void'
       and target_id = (select id from public.equipment_rental_batches
                          where supplier_id = '5a000001-0000-4000-8000-000000000312'
                            and starts_on = date '2026-07-01')),
  1::bigint, 'exactly one equipment_batch_void audit row');

-- ============================================================================
-- D. Deposit-paid batch (C) — void must reverse BOTH the rent and the deposit
--    GL legs (the deposit leg is source_table='rental_deposits').
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440312"}';
select lives_ok(
  $$ select public.void_equipment_rental_batch(
       (select id from public.equipment_rental_batches
          where supplier_id = '5a000001-0000-4000-8000-000000000312' and starts_on = date '2026-09-01'),
       'deposit test') $$,
  'procurement voids a deposit-paid batch');

set local "request.jwt.claims" = '{}';
select is(
  (select count(*) from public.journal_entries e
     where e.source_table = 'rental_deposits'
       and e.source_id = (select id from public.equipment_rental_batches
                            where supplier_id = '5a000001-0000-4000-8000-000000000312'
                              and starts_on = date '2026-09-01')
       and e.status = 'posted'
       and not exists (select 1 from public.journal_entries r where r.reversal_of = e.id)),
  0::bigint, 'the deposit GL leg was reversed (no un-reversed rental_deposits entry remains)');
select is(
  (select count(*) from (
     select l.account_id
       from public.journal_lines l
      where l.entry_id in (
        select id from public.journal_entries
          where source_table in ('equipment_rental_batches', 'rental_deposits')
            and source_id = (select id from public.equipment_rental_batches
                               where supplier_id = '5a000001-0000-4000-8000-000000000312'
                                 and starts_on = date '2026-09-01')
        union
        select id from public.journal_entries
          where reversal_of in (
            select id from public.journal_entries
              where source_table in ('equipment_rental_batches', 'rental_deposits')
                and source_id = (select id from public.equipment_rental_batches
                                   where supplier_id = '5a000001-0000-4000-8000-000000000312'
                                     and starts_on = date '2026-09-01')))
      group by l.account_id
      having sum(l.debit - l.credit) <> 0) x),
  0::bigint, 'every account touched by deposit-paid batch C nets to zero after void');

select * from finish();
rollback;
