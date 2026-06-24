begin;
select plan(6);

-- ============================================================================
-- Procurement bug 2 — proof-of-payment attachments (purpose 'payment'). A
-- separate permissive INSERT policy lets the attachment role set attach a payment
-- slip once the PR has a purchase to pay for (purchased|on_route|delivered|
-- site_purchased); other statuses + roles outside the set are denied. Reads ride
-- the purpose-agnostic "select via parent" policy.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1205205-1111-1111-1111-111111111205', 'proc@pp205.local', '{}'::jsonb),
  ('a2205205-1111-1111-1111-111111111205', 'vis@pp205.local',  '{}'::jsonb),
  ('a3205205-1111-1111-1111-111111111205', 'req@pp205.local',  '{}'::jsonb);
update public.users set role='procurement' where id='a1205205-1111-1111-1111-111111111205';
-- a2 stays 'visitor'; a3 is the requester (role irrelevant to the gate).
update public.users set role='site_admin' where id='a3205205-1111-1111-1111-111111111205';

insert into public.projects (id, code, name) values
  ('aa205205-0000-0000-0000-000000000205', 'PP205', 'payment-proof 205');
insert into public.work_packages (id, project_id, code, name) values
  ('cc205205-0000-0000-0000-000000000205', 'aa205205-0000-0000-0000-000000000205', 'WP205', 'งาน 205');
-- one PURCHASED PR (payable) and one REQUESTED PR (not payable).
insert into public.purchase_requests (id, work_package_id, item_description, quantity, unit, requested_by, status) values
  ('d0205205-0000-0000-0000-000000000205', 'cc205205-0000-0000-0000-000000000205', 'ปูน', 10, 'ถุง',
   'a3205205-1111-1111-1111-111111111205', 'purchased'),
  ('d1205205-0000-0000-0000-000000000205', 'cc205205-0000-0000-0000-000000000205', 'ทราย', 5, 'คิว',
   'a3205205-1111-1111-1111-111111111205', 'requested');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- 0. enum has the new label.
select ok('payment' = any (enum_range(null::public.purchase_request_attachment_purpose)::text[]),
  'purpose enum has payment');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1205205-1111-1111-1111-111111111205"}';

-- A. procurement attaches a payment slip to the PURCHASED PR.
select lives_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, kind, purpose, storage_path, created_by)
     values ('e0205205-0000-0000-0000-000000000205', 'd0205205-0000-0000-0000-000000000205',
             'image', 'payment', 'aa205205/d0205205/e0205205.jpeg',
             'a1205205-1111-1111-1111-111111111205') $$,
  'procurement attaches a payment proof to a purchased PR');
select is(
  (select count(*)::int from public.purchase_request_attachments
     where purchase_request_id='d0205205-0000-0000-0000-000000000205' and purpose='payment'),
  1, 'the payment attachment landed');

-- B. a REQUESTED PR is not yet payable → RLS denies.
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, kind, purpose, storage_path, created_by)
     values ('e1205205-0000-0000-0000-000000000205', 'd1205205-0000-0000-0000-000000000205',
             'image', 'payment', 'aa205205/d1205205/e1205205.jpeg',
             'a1205205-1111-1111-1111-111111111205') $$,
  '42501', null, 'cannot attach payment to a not-yet-purchased PR (RLS)');

-- C. created_by must be the caller (no attaching as someone else).
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, kind, purpose, storage_path, created_by)
     values ('e2205205-0000-0000-0000-000000000205', 'd0205205-0000-0000-0000-000000000205',
             'image', 'payment', 'aa205205/d0205205/e2205205.jpeg',
             'a3205205-1111-1111-1111-111111111205') $$,
  '42501', null, 'created_by must equal the caller (RLS)');

-- D. a visitor (outside the attachment role set) is denied.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2205205-1111-1111-1111-111111111205"}';
select throws_ok(
  $$ insert into public.purchase_request_attachments
       (id, purchase_request_id, kind, purpose, storage_path, created_by)
     values ('e3205205-0000-0000-0000-000000000205', 'd0205205-0000-0000-0000-000000000205',
             'image', 'payment', 'aa205205/d0205205/e3205205.jpeg',
             'a2205205-1111-1111-1111-111111111205') $$,
  '42501', null, 'a visitor cannot attach a payment proof (role gate)');

reset role;
select * from finish();
rollback;
