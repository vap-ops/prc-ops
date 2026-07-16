begin;
select plan(24);

-- ============================================================================
-- Spec 324 U1 — receipt-correction schema.
--   receipt_correction_requests = the SA flag, a STATUS-LIFECYCLE table
--     (pending → applied/rejected/obsolete), mirroring identity_change_requests:
--     RLS SELECT-only, writes RPC-only, NO block-mutation trigger (its status
--     must transition). One-pending-per-receipt enforced by a PARTIAL UNIQUE
--     index, not an app exists-check.
--   stock_receipt_corrections = the applied-correction LEDGER, append-only
--     (block-mutation trigger, like stock_reversals).
--   Enum growth: audit_action gains 'stock_receipt_correction';
--     notification_event_type gains 'receipt_correction_flagged' /
--     'receipt_correction_resolved'.
-- ============================================================================

-- Fixtures (existing tables only, so the top block survives the RED run).
insert into auth.users (id, email, raw_user_meta_data) values
  ('32432432-0000-0000-0000-000000000324', 'bo@rc324.local', '{}'::jsonb);
update public.users set role='procurement' where id='32432432-0000-0000-0000-000000000324';

insert into public.projects (id, code, name) values
  ('aa324000-0000-0000-0000-000000000324', 'RC-PROJ-324', 'แก้จำนวนรับ ทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee324000-0000-0000-0000-000000000324', 'electrical', 'วัสดุแก้จำนวน', 'ชิ้น', true);
insert into public.stock_receipts (id, project_id, catalog_item_id, qty, unit, unit_cost) values
  ('d0324001-0000-0000-0000-000000000324', 'aa324000-0000-0000-0000-000000000324',
   'ee324000-0000-0000-0000-000000000324', 100, 'ชิ้น', 10);

-- A. Tables + columns.
select has_table('public','receipt_correction_requests','receipt_correction_requests exists');
select has_table('public','stock_receipt_corrections','stock_receipt_corrections exists');
select has_column('public','receipt_correction_requests','proposed_qty','requests.proposed_qty');
select col_type_is('public','receipt_correction_requests','proposed_qty','numeric(12,2)',
  'requests.proposed_qty is numeric(12,2)');
select has_column('public','receipt_correction_requests','status','requests.status');
select has_column('public','receipt_correction_requests','correction_id','requests.correction_id (circular FK)');
select has_column('public','stock_receipt_corrections','removed_net','corrections.removed_net');
select has_column('public','stock_receipt_corrections','removed_gross','corrections.removed_gross');
select has_column('public','stock_receipt_corrections','true_qty','corrections.true_qty');

-- B. One-pending partial-unique index.
select has_index('public','receipt_correction_requests','rcr_one_pending','rcr_one_pending index exists');
select ok(
  (select indexdef from pg_indexes where schemaname='public' and indexname='rcr_one_pending')
    like '%(status = ''pending''::text)%',
  'rcr_one_pending is PARTIAL on status=pending');

-- C. Enum growth (values added; not yet used — safe in-txn).
select ok('stock_receipt_correction' = any(enum_range(null::public.audit_action)::text[]),
  'audit_action gains stock_receipt_correction');
select ok('receipt_correction_flagged' = any(enum_range(null::public.notification_event_type)::text[]),
  'notification_event_type gains receipt_correction_flagged');
select ok('receipt_correction_resolved' = any(enum_range(null::public.notification_event_type)::text[]),
  'notification_event_type gains receipt_correction_resolved');

-- D. stock_receipt_corrections is APPEND-ONLY (block-mutation trigger).
insert into public.stock_receipt_corrections
  (id, receipt_id, removed_qty, removed_net, removed_vat, removed_gross, true_qty, reason, corrected_by)
values
  ('c0324001-0000-0000-0000-000000000324', 'd0324001-0000-0000-0000-000000000324',
   5, 50, 0, 50, 95, 'fixture', '32432432-0000-0000-0000-000000000324');
select throws_ok(
  $$ update public.stock_receipt_corrections set removed_qty = 1
       where id='c0324001-0000-0000-0000-000000000324' $$,
  'P0001', null, 'stock_receipt_corrections blocks UPDATE (append-only)');
select throws_ok(
  $$ delete from public.stock_receipt_corrections where id='c0324001-0000-0000-0000-000000000324' $$,
  'P0001', null, 'stock_receipt_corrections blocks DELETE (append-only)');

-- E. One PENDING flag per receipt (partial-unique); a decided row for the same receipt is fine.
insert into public.receipt_correction_requests (id, receipt_id, proposed_qty, reason, requested_by)
values ('f0324001-0000-0000-0000-000000000324', 'd0324001-0000-0000-0000-000000000324',
        95, 'first flag', '32432432-0000-0000-0000-000000000324');
select throws_ok(
  $$ insert into public.receipt_correction_requests (receipt_id, proposed_qty, reason, requested_by)
       values ('d0324001-0000-0000-0000-000000000324', 90, 'second flag',
               '32432432-0000-0000-0000-000000000324') $$,
  '23505', null, 'a second PENDING flag for the same receipt is rejected (partial-unique)');
select lives_ok(
  $$ insert into public.receipt_correction_requests
       (receipt_id, proposed_qty, reason, requested_by, status, decided_by, decided_at)
     values ('d0324001-0000-0000-0000-000000000324', 90, 'rejected flag',
             '32432432-0000-0000-0000-000000000324', 'rejected',
             '32432432-0000-0000-0000-000000000324', now()) $$,
  'a non-pending (rejected) flag for the same receipt inserts fine (partial index ignores it)');

-- F. receipt_correction_requests is NOT append-only — its status must transition
--    (deliberate deviation from the plan's "block both": §8 + U2/U4 UPDATE status).
select lives_ok(
  $$ update public.receipt_correction_requests
       set status='applied', decided_by='32432432-0000-0000-0000-000000000324', decided_at=now()
     where id='f0324001-0000-0000-0000-000000000324' $$,
  'receipt_correction_requests status transitions pending→applied (lifecycle table, no block trigger)');

-- G. RPC-only writer posture: authenticated reads, cannot directly write.
select is(has_table_privilege('authenticated','public.receipt_correction_requests','SELECT'), true,
  'authenticated may SELECT receipt_correction_requests');
select is(has_table_privilege('authenticated','public.receipt_correction_requests','INSERT'), false,
  'authenticated may NOT directly INSERT receipt_correction_requests (RPC-only)');
select is(has_table_privilege('authenticated','public.stock_receipt_corrections','INSERT'), false,
  'authenticated may NOT directly INSERT stock_receipt_corrections (RPC-only)');
-- The lifecycle table has NO block trigger, so its write-lockdown rests entirely
-- on the missing UPDATE/DELETE grant — assert it explicitly (the deviation's floor).
select is(has_table_privilege('authenticated','public.receipt_correction_requests','UPDATE'), false,
  'authenticated may NOT directly UPDATE receipt_correction_requests (RPC-only lifecycle)');
select is(has_table_privilege('authenticated','public.receipt_correction_requests','DELETE'), false,
  'authenticated may NOT directly DELETE receipt_correction_requests');

select * from finish();
rollback;
