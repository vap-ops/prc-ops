begin;
select plan(9);

-- ============================================================================
-- Regression: delivery-confirmation photo upload to the pr-attachments bucket
-- must succeed for a STORE-BOUND (work_package_id NULL) purchase request.
--
-- Bug (operator-reported 2026-07-11): procurement + site_admin could not upload
-- delivery-receipt photos. The storage.objects INSERT policy
-- "pr attachment uploads by request owner or receiver" INNER-joined
-- work_packages (wp.id = pr.work_package_id) and matched wp.project_id. Since
-- spec 208 (store-first: deliveries land in the store, no WP) purchase requests
-- are WP-less — the inner join yields zero rows → EXISTS false → RLS denies the
-- browser byte-upload. The uploader then reports "saved, will auto-send" but the
-- offline queue marks it authz-denied and never sends. Live at report time:
-- 209/209 on_route|delivered PRs had work_package_id NULL.
--
-- The path is {project_id}/{pr_id}/{attachment_id}.{ext} — segment 1 is the PR's
-- OWN project_id (spec 195 P1: NOT NULL; store-bound PRs have no WP). The fix
-- keys the policy on pr.project_id and drops the WP join, mirroring the (already
-- correct) purchase_request_attachments INSERT policy's delivery arm.
--
-- These behavioural asserts insert directly into storage.objects under role
-- simulation, so they exercise the actual storage RLS policy (the file 21 asserts
-- are static string pins and pass even against the broken policy).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('aa11c000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'proc@wpless-test.local',  '{}'::jsonb),
  ('aa11c002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sa@wpless-test.local',    '{}'::jsonb),
  ('aa11c003-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pmgr@wpless-test.local',  '{}'::jsonb),
  ('aa11c004-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vis@wpless-test.local',   '{}'::jsonb),
  ('aa11c005-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sa2@wpless-test.local',   '{}'::jsonb);

update public.users set role = 'procurement'         where id = 'aa11c000-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.users set role = 'site_admin'          where id = 'aa11c002-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.users set role = 'procurement_manager' where id = 'aa11c003-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update public.users set role = 'site_admin'          where id = 'aa11c005-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- aa11c004 keeps default 'visitor'. aa11c002 is a site_admin ENROLLED in the
-- fixture project; aa11c005 is a site_admin deliberately NOT enrolled (the
-- membership-deny control).

insert into public.projects (id, code, name) values
  ('aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRC-WPLESS', 'WP-less delivery fixture project');

-- site_admin visibility is membership-scoped (ADR 0056: can_see_project) — enrol
-- aa11c002 so the storage policy's EXISTS (which reads purchase_requests under the
-- caller's RLS) can see the parent via the membership path. procurement /
-- procurement_manager see all PRs by role, so they need no enrolment; aa11c005 is
-- intentionally left out.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aa11c002-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'aa11c002-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Control WP (for the no-regression WP-bound case).
insert into public.work_packages (id, project_id, code, name) values
  ('aa11ee00-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'WP-WPLESS-1', 'control WP');

-- Store-bound (work_package_id NULL) DELIVERED PR — requested by procurement
-- (store-first: procurement raises store PRs), so the SA is never its requester.
insert into public.purchase_requests
  (id, work_package_id, project_id, item_description, quantity, unit, requested_by, status,
   approved_by, decided_at, purchased_at, delivered_at)
values
  ('aa11d000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Cement (store)', 10, 'bag', 'aa11c000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delivered',
   'aa11c003-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day');

-- Store-bound (work_package_id NULL) ON_ROUTE PR, also requested by procurement.
-- The SA that uploads on it (assertion B) is a NON-requester member, so B rides
-- the can_see_project membership disjunct — not requested_by = auth.uid().
insert into public.purchase_requests
  (id, work_package_id, project_id, item_description, quantity, unit, requested_by, status,
   approved_by, decided_at, purchased_at, shipped_at)
values
  ('aa11d001-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Sand (store)', 5, 'ton', 'aa11c000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'on_route',
   'aa11c003-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day');

-- WP-BOUND DELIVERED PR (control: must keep working after the fix).
insert into public.purchase_requests
  (id, work_package_id, project_id, item_description, quantity, unit, requested_by, status,
   approved_by, decided_at, purchased_at, delivered_at)
values
  ('aa11d002-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aa11ee00-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Rebar (WP)', 50, 'rod', 'aa11c000-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'delivered',
   'aa11c003-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- Privilege sanity: authenticated may INSERT into storage.objects at all (so a
-- denial below is the RLS policy, never a missing table grant).
select is(
  has_table_privilege('authenticated', 'storage.objects', 'INSERT'),
  true, 'authenticated has INSERT privilege on storage.objects (denials below are RLS, not grant)');

set local role authenticated;

-- A. procurement uploads a delivery photo on a WP-less DELIVERED store PR.
--    RED before the fix (WP inner-join empty → 42501); GREEN after.
set local "request.jwt.claims" = '{"sub": "aa11c000-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
select lives_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'pr-attachments',
        'aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11d000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11f000-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg') $$,
  'procurement may upload a delivery photo on a WP-less (store-bound) delivered PR');

-- B. site_admin who is an enrolled member but NOT the requester (the store
--    receiver) uploads on the WP-less ON_ROUTE store PR. Exercises the
--    can_see_project membership disjunct specifically. RED before the fix; GREEN
--    after.
set local "request.jwt.claims" = '{"sub": "aa11c002-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
select lives_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'pr-attachments',
        'aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11d001-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11f001-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg') $$,
  'a non-requester enrolled site_admin (store receiver) may upload on a WP-less on_route PR (membership path)');

-- B2. A site_admin who is NOT a project member is denied — proves the EXISTS
--     gate actually restricts via can_see_project (no fall-open). This SA rides
--     no requested_by / role disjunct, so only membership could admit it, and it
--     must not.
set local "request.jwt.claims" = '{"sub": "aa11c005-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'pr-attachments',
        'aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11d001-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11f006-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg') $$,
  '42501', null, 'a non-member site_admin is denied (membership gate restricts, no fall-open)');

-- C. Control: procurement uploads on a WP-BOUND delivered PR — GREEN before and
--    after (the fix must not regress the WP-bound path).
set local "request.jwt.claims" = '{"sub": "aa11c000-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
select lives_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'pr-attachments',
        'aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11d002-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11f002-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg') $$,
  'procurement may upload a delivery photo on a WP-bound delivered PR (no regression)');

-- D. Negative: a visitor is denied by the role gate.
set local "request.jwt.claims" = '{"sub": "aa11c004-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'pr-attachments',
        'aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11d000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11f003-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg') $$,
  '42501', null, 'visitor delivery upload is denied (role gate)');

-- E. Negative: path-binding preserved — a project segment that does not match the
--    PR's own project_id is denied (the fix keeps segment 1 = pr.project_id).
set local "request.jwt.claims" = '{"sub": "aa11c000-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'pr-attachments',
        'ffffffff-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11d000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11f004-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg') $$,
  '42501', null, 'wrong project segment in the path is denied (path-binding preserved)');

-- F. procurement_manager (zeeparn) uploads on a WP-less delivered PR. RED before
--    the fix on TWO counts (WP join + role absent from the storage gate); GREEN
--    after (fix adds procurement_manager, present on the table policy already).
set local "request.jwt.claims" = '{"sub": "aa11c003-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
select lives_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'pr-attachments',
        'aa110000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11d000-aaaa-aaaa-aaaa-aaaaaaaaaaaa/aa11f005-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg') $$,
  'procurement_manager may upload a delivery photo on a WP-less delivered PR');

reset role;

-- Static pin: the fixed policy binds pr.project_id and no longer joins
-- work_packages (guards against a future re-introduction of the WP inner join).
select ok(
  (select with_check like '%project_id%' and with_check not like '%work_packages%'
     from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'pr attachment uploads by request owner or receiver'),
  'storage upload policy binds pr.project_id and no longer joins work_packages');

select * from finish();
rollback;
