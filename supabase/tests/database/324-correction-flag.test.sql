begin;
select plan(20);

-- ============================================================================
-- Spec 324 U4 — the SA flag lifecycle RPCs + notification capture.
--   submit_receipt_correction_request — a project member (the SA) flags a
--     miscount: proposed_qty in [0, booked), non-empty reason + photo, one
--     PENDING per receipt (partial-unique), refused once a prior flag was
--     REJECTED (no unbounded re-flag loop).
--   decide_receipt_correction_request — back-office approves (→ correct_stock_
--     receipt, status 'applied') or rejects (note required, status 'rejected');
--     lock + re-assert pending (double-apply safe).
--   Two AFTER triggers enqueue notification_outbox: 'receipt_correction_flagged'
--     on insert, 'receipt_correction_resolved' on pending→applied/rejected.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000324', 'sa@fl324.local',  '{}'::jsonb),
  ('b0000000-0000-0000-0000-000000000324', 'bo@fl324.local',  '{}'::jsonb),
  ('c0000000-0000-0000-0000-000000000324', 'vis@fl324.local', '{}'::jsonb),
  ('70000000-0000-0000-0000-000000000324', 'pm@fl324.local',  '{}'::jsonb);
update public.users set role='site_admin'      where id='a0000000-0000-0000-0000-000000000324';
update public.users set role='procurement'     where id='b0000000-0000-0000-0000-000000000324';
update public.users set role='project_manager' where id='70000000-0000-0000-0000-000000000324';
-- the project_manager (70…324) is back-office by role but NOT a member of this project.

insert into public.projects (id, code, name) values
  ('40000000-0000-0000-0000-000000000324', 'FL324-PROJ', 'ธง แก้จำนวน');
insert into public.project_members (project_id, user_id, added_by) values
  ('40000000-0000-0000-0000-000000000324', 'a0000000-0000-0000-0000-000000000324', 'b0000000-0000-0000-0000-000000000324');
insert into public.suppliers (id, name, created_by) values
  ('50000000-0000-0000-0000-000000000324', 'ผู้ขาย ธง', 'b0000000-0000-0000-0000-000000000324');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('11000000-0000-0000-0000-000000000324', 'electrical', 'สายไฟ', 'ชิ้น', true),
  ('12000000-0000-0000-0000-000000000324', 'electrical', 'ท่อ',   'ชิ้น', true);
-- Rv (approve flow) + Rz (reject flow); both clean pools.
insert into public.stock_receipts (id, project_id, catalog_item_id, qty, unit, unit_cost, vat_rate, supplier_id, created_by) values
  ('a1000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '11000000-0000-0000-0000-000000000324', 100, 'ชิ้น', 10, 7, '50000000-0000-0000-0000-000000000324', 'a0000000-0000-0000-0000-000000000324'),
  ('a2000000-0000-0000-0000-000000000324', '40000000-0000-0000-0000-000000000324', '12000000-0000-0000-0000-000000000324', 50,  'ชิ้น', 10, 0, '50000000-0000-0000-0000-000000000324', 'a0000000-0000-0000-0000-000000000324');
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('40000000-0000-0000-0000-000000000324', '11000000-0000-0000-0000-000000000324', 100, 1000),
  ('40000000-0000-0000-0000-000000000324', '12000000-0000-0000-0000-000000000324', 50,  500);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- Structure
select ok(to_regprocedure('public.submit_receipt_correction_request(uuid,numeric,text,text)') is not null,
  'submit_receipt_correction_request exists');
select ok(to_regprocedure('public.decide_receipt_correction_request(uuid,boolean,numeric,text)') is not null,
  'decide_receipt_correction_request exists');

set local role authenticated;

-- Submit gate — a non-member (visitor) is denied.
set local "request.jwt.claims" = '{"sub":"c0000000-0000-0000-0000-000000000324"}';
select throws_ok($$ select public.submit_receipt_correction_request('a1000000-0000-0000-0000-000000000324', 80, 'x', 'p.jpg') $$,
  '42501', null, 'a non-member (visitor) cannot flag');

-- Submit floors — as the member SA.
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000324"}';
select throws_ok($$ select public.submit_receipt_correction_request('a1000000-0000-0000-0000-000000000324', 100, 'x', 'p.jpg') $$,
  'P0001', null, 'proposed_qty == booked rejected');
select throws_ok($$ select public.submit_receipt_correction_request('a1000000-0000-0000-0000-000000000324', -1, 'x', 'p.jpg') $$,
  'P0001', null, 'negative proposed_qty rejected');
select throws_ok($$ select public.submit_receipt_correction_request('a1000000-0000-0000-0000-000000000324', 80, '', 'p.jpg') $$,
  'P0001', null, 'empty reason rejected');
select throws_ok($$ select public.submit_receipt_correction_request('a1000000-0000-0000-0000-000000000324', 80, 'x', '') $$,
  'P0001', null, 'empty photo_path rejected');

-- Submit happy + one-pending.
select lives_ok($$ select public.submit_receipt_correction_request('a1000000-0000-0000-0000-000000000324', 80, 'มาไม่ครบ', 'photo/rv.jpg') $$,
  'the SA flags the receipt');
select throws_ok($$ select public.submit_receipt_correction_request('a1000000-0000-0000-0000-000000000324', 70, 'อีก', 'photo/rv2.jpg') $$,
  '23505', null, 'a second PENDING flag for the same receipt is rejected (partial-unique)');

-- Decide gate — a site_admin cannot decide.
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000324"}';
select throws_ok(
  format($$ select public.decide_receipt_correction_request(%L, true, 80, null) $$,
    (select id from public.receipt_correction_requests where receipt_id='a1000000-0000-0000-0000-000000000324' and status='pending')),
  '42501', null, 'site_admin cannot decide (back-office only)');
-- Membership parity: a back-office project_manager who is NOT a member of the
-- receipt's project cannot decide (reject-close) its flag.
set local "request.jwt.claims" = '{"sub":"70000000-0000-0000-0000-000000000324"}';
select throws_ok(
  format($$ select public.decide_receipt_correction_request(%L, false, null, 'no') $$,
    (select id from public.receipt_correction_requests where receipt_id='a1000000-0000-0000-0000-000000000324' and status='pending')),
  '42501', null, 'a non-member project_manager cannot decide (membership scope)');

-- Decide approve — as back office → correction applied, on-hand reduced.
set local "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000324"}';
select lives_ok(
  format($$ select public.decide_receipt_correction_request(%L, true, 80, 'ตรวจแล้ว') $$,
    (select id from public.receipt_correction_requests where receipt_id='a1000000-0000-0000-0000-000000000324' and status='pending')),
  'back office approves the flag');
select is((select status from public.receipt_correction_requests where receipt_id='a1000000-0000-0000-0000-000000000324'),
  'applied', 'the flag is marked applied with its correction linked');
select is((select qty_on_hand from public.stock_on_hand where catalog_item_id='11000000-0000-0000-0000-000000000324'),
  80::numeric, 'the approved correction reduced on-hand 100 → 80');

-- Reject flow (Rz) — note required; reject closes the receipt to further flags.
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000324"}';
select lives_ok($$ select public.submit_receipt_correction_request('a2000000-0000-0000-0000-000000000324', 40, 'ขาด', 'photo/rz.jpg') $$,
  'the SA flags the second receipt');
set local "request.jwt.claims" = '{"sub":"b0000000-0000-0000-0000-000000000324"}';
select throws_ok(
  format($$ select public.decide_receipt_correction_request(%L, false, null, null) $$,
    (select id from public.receipt_correction_requests where receipt_id='a2000000-0000-0000-0000-000000000324' and status='pending')),
  'P0001', null, 'rejecting without a note is refused');
select lives_ok(
  format($$ select public.decide_receipt_correction_request(%L, false, null, 'จำนวนถูกต้องแล้ว') $$,
    (select id from public.receipt_correction_requests where receipt_id='a2000000-0000-0000-0000-000000000324' and status='pending')),
  'back office rejects the flag with a note');
set local "request.jwt.claims" = '{"sub":"a0000000-0000-0000-0000-000000000324"}';
select throws_ok($$ select public.submit_receipt_correction_request('a2000000-0000-0000-0000-000000000324', 45, 'อีกครั้ง', 'photo/rz2.jpg') $$,
  'P0001', null, 'a rejected receipt is closed to further flags (no re-flag loop)');

reset role;
-- notification_outbox is zero-user-access — read the captured events after reset.
select is((select count(*)::int from public.notification_outbox where event_type='receipt_correction_flagged'), 2,
  'each successful flag enqueued a receipt_correction_flagged notification (Rv + Rz)');
select is((select count(*)::int from public.notification_outbox where event_type='receipt_correction_resolved'), 2,
  'the approve and the reject each enqueued a receipt_correction_resolved notification');
select * from finish();
rollback;
