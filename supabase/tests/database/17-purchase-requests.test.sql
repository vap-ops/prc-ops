begin;
select plan(100);

-- ============================================================================
-- A. Setup as postgres (the test transaction's outer role, which bypasses
--    RLS). Insert six auth.users; the on_auth_user_created trigger creates
--    six matching public.users rows with default role 'visitor' (ADR 0010).
--    Promote five to the privileged roles tested below; the sixth stays
--    'visitor'.
--
--    Insert one parent project and one parent work_package, then four
--    purchase_request fixtures used by the SELECT-visibility, UPDATE-guard,
--    and set_updated_at-trigger assertions later in the file.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@pr-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'sa1@pr-test.local',     '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@pr-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@pr-test.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555555555', 'sa2@pr-test.local',     '{}'::jsonb),
  ('66666666-6666-6666-6666-666666666666', 'proc@pr-test.local',    '{}'::jsonb);

update public.users set role = 'super_admin'
  where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'site_admin'
  where id = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'project_manager'
  where id = '33333333-3333-3333-3333-333333333333';
-- '4444…' keeps the default 'visitor' role from the trigger.
update public.users set role = 'site_admin'
  where id = '55555555-5555-5555-5555-555555555555';
update public.users set role = 'procurement'
  where id = '66666666-6666-6666-6666-666666666666';

-- Parent project + work_package.
insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'PRC-TEST-PR-A', 'PR fixture project');

-- Spec 143 / ADR 0056: visibility is now membership-scoped — enrol this
-- fixture's PM/site_admin users so they can read the project.
insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('PRC-TEST-PR-A')
     and u.id in (select au.id from auth.users au where au.email like '%@pr-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;

insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'WP-PR-A1', 'PR fixture WP');

-- PR fixtures.
--   a1111… requested by SA1 — visibility tests (F.1, F.3-F.5).
--   a2222… requested by SA2 — cross-user isolation (F.2).
--   a3333… requested by PM, updated_at backdated — trigger test (G.6).
--   a4444… already approved by PM — two-layer guard no-op test (G.5).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status)
values
  ('a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'Cement bag 50kg', 10, 'bag',
   '22222222-2222-2222-2222-222222222222',
   'requested'),
  ('a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'Rebar 12mm', 50, 'rod',
   '55555555-5555-5555-5555-555555555555',
   'requested');

insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status, updated_at)
values
  ('a3333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'Sand', 5, 'tonne',
   '33333333-3333-3333-3333-333333333333',
   'requested',
   '2020-01-01 00:00:00+00');

insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit,
   requested_by, status, approved_by, decided_at, decision_comment)
values
  ('a4444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'Bricks', 100, 'piece',
   '33333333-3333-3333-3333-333333333333',
   'approved',
   '33333333-3333-3333-3333-333333333333',
   '2020-01-02 00:00:00+00',
   null);

-- a5555… requested by SA1 — used by section I's reject-transition test
-- (a fresh 'requested' row that hasn't been touched by sections F/G/H).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status)
values
  ('a5555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   'Gravel', 2, 'tonne',
   '22222222-2222-2222-2222-222222222222',
   'requested');

-- Grant the runner's temp result buffer to authenticated, so the assertions
-- that run under `set local role authenticated` can still record their TAP
-- output via the runner's `insert into _tap_buf(line) select <pgtap>` rewrite.
-- Same pattern established in 06/07/08/09/10.
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog: enum, table shape, columns, FKs, indexes, trigger.
-- ============================================================================

select has_type('public', 'purchase_request_status', 'purchase_request_status enum exists');
select enum_has_labels(
  'public', 'purchase_request_status',
  array['requested', 'approved', 'rejected', 'cancelled', 'purchased', 'on_route', 'delivered',
        'site_purchased'],
  'purchase_request_status has the eight lifecycle values (site_purchased per ADR 0043)'
);

select has_table('public', 'purchase_requests', 'public.purchase_requests exists');

select col_is_pk('public', 'purchase_requests', 'id', 'id is primary key');
select col_type_is('public', 'purchase_requests', 'id', 'uuid', 'id is uuid');
select col_has_default('public', 'purchase_requests', 'id', 'id has a default (gen_random_uuid)');

select col_type_is('public', 'purchase_requests', 'work_package_id', 'uuid', 'work_package_id is uuid');
select col_not_null('public', 'purchase_requests', 'work_package_id', 'work_package_id is NOT NULL');

select col_type_is('public', 'purchase_requests', 'item_description', 'text', 'item_description is text');
select col_not_null('public', 'purchase_requests', 'item_description', 'item_description is NOT NULL');

select col_type_is('public', 'purchase_requests', 'quantity', 'numeric', 'quantity is numeric (fractional materials allowed)');
select col_not_null('public', 'purchase_requests', 'quantity', 'quantity is NOT NULL');

select col_type_is('public', 'purchase_requests', 'unit', 'text', 'unit is text');
select col_not_null('public', 'purchase_requests', 'unit', 'unit is NOT NULL');

select col_type_is('public', 'purchase_requests', 'status', 'purchase_request_status', 'status is purchase_request_status');
select col_not_null('public', 'purchase_requests', 'status', 'status is NOT NULL');
select col_default_is(
  'public', 'purchase_requests', 'status', 'requested'::public.purchase_request_status,
  'status defaults to requested'
);

select col_type_is('public', 'purchase_requests', 'source', 'text', 'source is text');
select col_not_null('public', 'purchase_requests', 'source', 'source is NOT NULL');
select col_default_is('public', 'purchase_requests', 'source', 'app', 'source defaults to app');

select col_type_is('public', 'purchase_requests', 'requested_by', 'uuid', 'requested_by is uuid');
select col_is_null('public', 'purchase_requests', 'requested_by', 'requested_by is NULLABLE (dual-identity)');

select col_type_is('public', 'purchase_requests', 'requested_by_email', 'text', 'requested_by_email is text');
select col_is_null('public', 'purchase_requests', 'requested_by_email', 'requested_by_email is NULLABLE');

select col_type_is(
  'public', 'purchase_requests', 'requested_at',
  'timestamp with time zone',
  'requested_at is timestamptz'
);
select col_not_null('public', 'purchase_requests', 'requested_at', 'requested_at is NOT NULL');

select col_type_is('public', 'purchase_requests', 'approved_by', 'uuid', 'approved_by is uuid');
select col_is_null('public', 'purchase_requests', 'approved_by', 'approved_by is NULLABLE');

select col_type_is(
  'public', 'purchase_requests', 'decided_at',
  'timestamp with time zone',
  'decided_at is timestamptz'
);
select col_is_null('public', 'purchase_requests', 'decided_at', 'decided_at is NULLABLE');

select col_type_is('public', 'purchase_requests', 'decision_comment', 'text', 'decision_comment is text');
select col_is_null('public', 'purchase_requests', 'decision_comment', 'decision_comment is NULLABLE');

-- Phase-2 columns (representative — pin existence + type so P2 needs no ALTER).
select col_type_is('public', 'purchase_requests', 'supplier', 'text', 'supplier (P2) is text');
select col_type_is('public', 'purchase_requests', 'amount', 'numeric', 'amount (P2) is numeric');
select col_type_is(
  'public', 'purchase_requests', 'purchased_at',
  'timestamp with time zone',
  'purchased_at (P2) is timestamptz'
);
select col_type_is(
  'public', 'purchase_requests', 'delivered_at',
  'timestamp with time zone',
  'delivered_at (P2) is timestamptz'
);

select col_type_is(
  'public', 'purchase_requests', 'created_at',
  'timestamp with time zone',
  'created_at is timestamptz'
);
select col_type_is(
  'public', 'purchase_requests', 'updated_at',
  'timestamp with time zone',
  'updated_at is timestamptz'
);

select fk_ok(
  'public', 'purchase_requests', 'work_package_id',
  'public', 'work_packages', 'id',
  'work_package_id FK references work_packages.id'
);
select fk_ok(
  'public', 'purchase_requests', 'requested_by',
  'public', 'users', 'id',
  'requested_by FK references public.users.id'
);
select fk_ok(
  'public', 'purchase_requests', 'approved_by',
  'public', 'users', 'id',
  'approved_by FK references public.users.id'
);

select has_index(
  'public', 'purchase_requests', 'purchase_requests_wp_idx',
  'purchase_requests_wp_idx exists'
);
select has_index(
  'public', 'purchase_requests', 'purchase_requests_status_requested_at_idx',
  'composite (status, requested_at desc) index exists'
);

select has_trigger(
  'public', 'purchase_requests', 'purchase_requests_set_updated_at',
  'purchase_requests_set_updated_at trigger exists'
);

-- Spec 16 P1 columns (ADR 0026 Decision A): needed_by / eta / priority.
select has_column('public', 'purchase_requests', 'needed_by', 'needed_by column exists');
select has_column('public', 'purchase_requests', 'eta', 'eta column exists');
select has_column('public', 'purchase_requests', 'priority', 'priority column exists');
select col_type_is('public', 'purchase_requests', 'needed_by', 'date', 'needed_by is date');
select col_type_is('public', 'purchase_requests', 'eta', 'date', 'eta is date');
select col_type_is(
  'public', 'purchase_requests', 'priority',
  'purchase_request_priority', 'priority is purchase_request_priority'
);
select col_not_null('public', 'purchase_requests', 'priority', 'priority is NOT NULL');
-- Behavioral default: the section-A fixtures never specify priority, so the
-- column default must have filled 'normal' on every seeded row.
select is(
  (select priority::text from public.purchase_requests
     where id = 'a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'normal',
  'priority defaults to ''normal'' on INSERT'
);

-- ============================================================================
-- C. RLS configuration.
-- ============================================================================

select is(
  (select relrowsecurity from pg_class where oid = 'public.purchase_requests'::regclass),
  true,
  'RLS enabled on public.purchase_requests'
);

-- No DELETE policy — count-independent assertion. Intentionally survives a
-- future P3 appsheet INSERT policy being added without turning false-green.
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'purchase_requests'
       and cmd = 'DELETE'),
  0,
  'no DELETE policy on purchase_requests (count-independent — survives future policy additions)'
);

-- All five current policies by name + cmd — individual existence checks.
-- Using is(count,1) per policy avoids name/text collation issues in results_eq.
-- Update this list whenever a policy ships; the no-DELETE check above is the durable gate.
--   3 native (P1a): select own-or-privileged, insert by wp-readers, update by pm/super
--   2 appsheet_writer (P2): select by status, update by status
select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='purchase_requests'
       and policyname='appsheet_writer select by status' and cmd::text='SELECT'),
  1, 'policy "appsheet_writer select by status" (SELECT) exists');
select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='purchase_requests'
       and policyname='appsheet_writer update by status' and cmd::text='UPDATE'),
  1, 'policy "appsheet_writer update by status" (UPDATE) exists');
select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='purchase_requests'
       and policyname='purchase_requests insert by wp-readers' and cmd::text='INSERT'),
  1, 'policy "purchase_requests insert by wp-readers" (INSERT) exists');
select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='purchase_requests'
       and policyname='purchase_requests select own or privileged' and cmd::text='SELECT'),
  1, 'policy "purchase_requests select own or privileged" (SELECT) exists');
select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='purchase_requests'
       and policyname='purchase_requests update by pm or super' and cmd::text='UPDATE'),
  1, 'policy "purchase_requests update by pm or super" (UPDATE) exists');

-- Spec 143 / ADR 0056 supersedes ADR 0026's site-wide PR visibility: the SELECT
-- policy now gates non-requester reads through can_see_wp (membership), keeping
-- the requester self-read + procurement's cross-project read. Qual-text pin so a
-- future rewrite that drops the membership gate is caught here, not in prod.
select ok(
  (select qual from pg_policies
     where schemaname='public' and tablename='purchase_requests'
       and policyname='purchase_requests select own or privileged') like '%can_see_wp%',
  'PR SELECT policy gates non-requester reads via can_see_wp (ADR 0056)'
);

-- ============================================================================
-- D. CHECK constraints behavioral. Run as postgres (the outer role, bypasses
--    RLS) so any failure is unambiguously from the constraint being tested.
--    23514 is check_violation.
-- ============================================================================

-- D.1 blank item_description rejected.
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             '   ', 1, 'each',
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  '23514',
  null,
  'blank item_description is rejected by CHECK'
);

-- D.2 blank unit rejected.
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Cement', 1, '   ',
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  '23514',
  null,
  'blank unit is rejected by CHECK'
);

-- D.3 quantity = 0 rejected (pr_quantity_positive: quantity > 0).
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Cement', 0, 'bag',
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  '23514',
  null,
  'quantity = 0 is rejected by CHECK (pr_quantity_positive)'
);

-- D.4 source='app' with NULL requested_by rejected (pr_native_has_requester).
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, source, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Cement', 1, 'bag', 'app', null) $$,
  '23514',
  null,
  'native (source=app) with NULL requested_by is rejected by CHECK'
);

-- D.5 status='rejected' + NULL decision_comment rejected (pr_reject_has_comment).
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by,
        status, decision_comment)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Cement', 1, 'bag',
             '22222222-2222-2222-2222-222222222222'::uuid,
             'rejected', null) $$,
  '23514',
  null,
  'rejected + NULL decision_comment is rejected by CHECK'
);

-- D.6 status='rejected' + whitespace decision_comment rejected (non-blank half).
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by,
        status, decision_comment)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Cement', 1, 'bag',
             '22222222-2222-2222-2222-222222222222'::uuid,
             'rejected', '   ') $$,
  '23514',
  null,
  'rejected + whitespace-only decision_comment is rejected by CHECK (non-blank half)'
);

-- D.7 AppSheet flow positive: source='appsheet' with NULL requested_by and
--     a requested_by_email is permitted by the dual-identity contract.
--     Pinning forward-compat with P2 (the AppSheet stage writes here).
select lives_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit,
        source, requested_by, requested_by_email)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Paint', 2, 'litre',
             'appsheet', null, 'site-foreman@example.com') $$,
  'appsheet source with null requested_by + email satisfies dual-identity CHECK'
);

-- ============================================================================
-- E. Role-gated INSERT under authenticated. From here every assertion's
--    TAP-recording insert hits _tap_buf as the authenticated role; hence
--    the grants in section A.
--
--    The WITH CHECK pins three things at once:
--      role in (site_admin, project_manager, super_admin)
--      AND requested_by = auth.uid()
--      AND source = 'app'
--    Any one of these failing → 42501 (insufficient_privilege).
-- ============================================================================

set local role authenticated;

-- E.1 site_admin self-insert OK (requested_by = auth.uid()).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select lives_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Steel bar', 3, 'rod',
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  'site_admin self-insert (requested_by = auth.uid()) is permitted'
);

-- E.2 site_admin foreign-requester INSERT denied. The WITH CHECK refuses a
--     row whose requested_by ≠ auth.uid() — the requester-pinning half.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Steel bar', 3, 'rod',
             '33333333-3333-3333-3333-333333333333'::uuid) $$,
  '42501',
  null,
  'site_admin INSERT with foreign requested_by is denied by RLS (requester-pin)'
);

-- E.3 site_admin INSERT with source='appsheet' denied from a JWT session —
--     the native-only pin. The AppSheet stage uses its own DB role, not an
--     authenticated user session, so this path is always wrong here.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, source, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Steel bar', 3, 'rod', 'appsheet',
             '22222222-2222-2222-2222-222222222222'::uuid) $$,
  '42501',
  null,
  'INSERT with source=appsheet from a JWT session is denied by RLS (native-only pin)'
);

-- E.4 project_manager can INSERT.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select lives_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Plywood', 4, 'sheet',
             '33333333-3333-3333-3333-333333333333'::uuid) $$,
  'project_manager can INSERT a purchase_request'
);

-- E.5 super_admin can INSERT.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select lives_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Nails', 5, 'kg',
             '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'super_admin can INSERT a purchase_request'
);

-- E.6 procurement INSERT denied — procurement is a reviewer/viewer in v1,
--     not a requester. Narrowed requester base per the owner's 2026-06-07
--     decision.
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666666666"}';
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Nails', 5, 'kg',
             '66666666-6666-6666-6666-666666666666'::uuid) $$,
  '42501',
  null,
  'procurement INSERT on purchase_requests is denied by RLS (not in v1 requester base)'
);

-- E.7 visitor INSERT denied.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
             'Nails', 5, 'kg',
             '44444444-4444-4444-4444-444444444444'::uuid) $$,
  '42501',
  null,
  'visitor INSERT on purchase_requests is denied by RLS'
);

-- E.8 Spec 16 P1: an SA INSERT carrying needed_by + priority persists both
--     (the authenticated INSERT grant is table-level — no grant change).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by,
   needed_by, priority)
values
  ('a7777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
   'Cement', 10, 'bag',
   '22222222-2222-2222-2222-222222222222'::uuid,
   current_date + 7, 'urgent');
select is(
  (select needed_by from public.purchase_requests
     where id = 'a7777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  current_date + 7,
  'needed_by persists on a requester INSERT'
);
select is(
  (select priority::text from public.purchase_requests
     where id = 'a7777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'urgent',
  'priority persists on a requester INSERT'
);

-- ============================================================================
-- F. SELECT visibility.
--   - SA1 sees own (PR_SA1) AND SA2's row (PR_SA2) — site-wide visibility
--     (ADR 0026 reversed the 2026-06-07 cross-user isolation; operator
--     decision 2026-06-11).
--   - PM, procurement, super_admin see all rows (role-level read).
--   - visitor sees nothing.
-- ============================================================================

-- F.1 SA1 sees PR_SA1 (own row).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select is(
  (select count(*)::int from public.purchase_requests
     where id = 'a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'site_admin sees own purchase_request via requested_by = auth.uid()'
);

-- F.2 SA1 SEES PR_SA2 (site-wide visibility — ADR 0026, load-bearing;
--     this assertion was count=0 cross-user isolation before 20260613100050).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select is(
  (select count(*)::int from public.purchase_requests
     where id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'site_admin SEES another site_admin''s purchase_request (site-wide visibility, ADR 0026)'
);

-- F.3 project_manager sees both PR_SA1 and PR_SA2 (role-level read).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select is(
  (select count(*)::int from public.purchase_requests
     where id in (
       'a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
     )),
  2,
  'project_manager sees all purchase_requests (role-level read)'
);

-- F.4 procurement sees both rows.
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666666666"}';
select is(
  (select count(*)::int from public.purchase_requests
     where id in (
       'a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
     )),
  2,
  'procurement sees all purchase_requests (role-level read)'
);

-- F.5 super_admin sees both rows.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select is(
  (select count(*)::int from public.purchase_requests
     where id in (
       'a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
       'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
     )),
  2,
  'super_admin sees all purchase_requests (role-level read)'
);

-- F.6 visitor sees nothing.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select is(
  (select count(*)::int from public.purchase_requests),
  0,
  'visitor sees no purchase_requests'
);

-- ============================================================================
-- G. UPDATE RLS + transition guard + set_updated_at trigger.
--    The UPDATE policy gates SELECT-FOR-UPDATE via USING: when USING returns
--    false for all candidate rows, the UPDATE statement affects 0 rows
--    silently (no SQLSTATE). Negative tests assert on row state, positive
--    ones on row state. Mirrors 07-projects / 08-work-packages.
-- ============================================================================

-- G.1 project_manager transitions PR_PM_UPDATE from requested → approved.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
update public.purchase_requests
  set status = 'approved',
      approved_by = '33333333-3333-3333-3333-333333333333'::uuid,
      decided_at = now()
  where id = 'a3333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
select is(
  (select status::text from public.purchase_requests
     where id = 'a3333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'approved',
  'project_manager UPDATE on purchase_requests succeeds (requested → approved)'
);

-- G.2 project_manager transitions PR_SA1 from requested → rejected with comment.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
update public.purchase_requests
  set status = 'rejected',
      approved_by = '33333333-3333-3333-3333-333333333333'::uuid,
      decided_at = now(),
      decision_comment = 'budget exceeded'
  where id = 'a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
select is(
  (select status::text from public.purchase_requests
     where id = 'a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'rejected',
  'project_manager UPDATE on purchase_requests succeeds (requested → rejected with comment)'
);

-- G.3 site_admin UPDATE is silently filtered by the USING clause —
--     0 rows affected, no error, row value unchanged. SA1 can now SEE
--     PR_SA2 (F.2, site-wide visibility per ADR 0026), but the UPDATE
--     policy admits only pm/super, so the UPDATE attempt as SA1 matches
--     0 rows; the verification SELECT switches to super_admin to read
--     the row's state.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
update public.purchase_requests
  set status = 'approved',
      approved_by = '22222222-2222-2222-2222-222222222222'::uuid,
      decided_at = now()
  where id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select is(
  (select status::text from public.purchase_requests
     where id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'requested',
  'site_admin UPDATE on purchase_requests has no effect — status unchanged (verified under super_admin)'
);

-- G.4 procurement UPDATE is denied by USING — procurement reads but does NOT
--     write the decision in v1 (PM/super only).
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666666666"}';
update public.purchase_requests
  set status = 'approved',
      approved_by = '66666666-6666-6666-6666-666666666666'::uuid,
      decided_at = now()
  where id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
select is(
  (select status::text from public.purchase_requests
     where id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'requested',
  'procurement UPDATE on purchase_requests has no effect — status unchanged (PM/super-only writers)'
);

-- G.5 Two-layer transition guard: PR_PM_APPROVED is already 'approved'
--     (set up in section A). A guarded UPDATE that includes
--     `... AND status = 'requested'` must NOT change the row — the
--     canonical concurrent-decision protection the server action
--     relies on (mirrors recordDecision's
--     `.eq('status','pending_approval')` clause).
--
--     Plain UPDATE form (no CTE): the runner's pgTAP rewrite wraps
--     only top-level `select`-leading statements, so a `with … select`
--     assertion is silently dropped. Sanity-check before + state-check
--     after fence the test from that runner quirk and keep the plan
--     count honest.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';

-- Sanity: confirm PR_PM_APPROVED is 'approved' before the attempt.
select is(
  (select status::text from public.purchase_requests
     where id = 'a4444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'approved',
  'two-layer guard fixture: PR_PM_APPROVED is initially ''approved'''
);

-- The guarded UPDATE. The `... AND status = 'requested'` clause
-- is the SQL safety net; the row's status is 'approved', so the
-- statement matches zero rows.
update public.purchase_requests
  set status = 'rejected',
      approved_by = '33333333-3333-3333-3333-333333333333'::uuid,
      decided_at = now(),
      decision_comment = 'too late'
  where id = 'a4444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
    and status = 'requested';

-- And the row itself is unchanged.
select is(
  (select status::text from public.purchase_requests
     where id = 'a4444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'approved',
  'two-layer guard: the already-approved row remains ''approved'' after the guarded UPDATE attempt'
);

-- G.6 set_updated_at trigger advanced updated_at on the G.1 UPDATE of
--     PR_PM_UPDATE (whose fixture updated_at was backdated to 2020-01-01).
--     transaction_timestamp() is frozen within a test transaction, but is
--     still > 2020-01-01.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select cmp_ok(
  (select updated_at from public.purchase_requests
     where id = 'a3333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  '>',
  '2020-01-01 00:00:00+00'::timestamptz,
  'set_updated_at trigger moves updated_at forward on UPDATE'
);

-- G.7 NAMED UPDATE-TEST (spec 33 / ADR 0038 reverses the spec-16 P1
--     posture this slot used to pin): authenticated sessions lost the
--     table-level UPDATE grant — fact columns like eta are now
--     RPC/appsheet_writer-only at the privilege layer. A super_admin
--     direct eta UPDATE is refused at 42501 (was: passed through the
--     derive trigger). appsheet_writer's eta write + its case-3 audit
--     diff stay covered by file 18 and smoke probe [4a].
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select throws_ok(
  $$ update public.purchase_requests
       set eta = current_date + 14
     where id = 'a3333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  '42501', null,
  'super_admin direct eta UPDATE is denied at the column-privilege layer (ADR 0038)');

-- G.8 The denied statement wrote nothing — no case-3 correction diff
--     appears for this PR (was: exactly one, when the write succeeded).
select is(
  (select count(*)::int from public.audit_log
     where target_table = 'purchase_requests'
       and target_id = 'a3333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
       and action = 'update'
       and payload->'changed' ? 'eta'),
  0,
  'denied eta UPDATE produced no case-3 audit diff'
);

-- ============================================================================
-- H. DELETE is denied at the privilege layer (REVOKE), NOT at RLS.
--    The migration's grants block REVOKEs ALL from authenticated then
--    GRANTs only SELECT/INSERT/UPDATE — DELETE is not granted. So a
--    DELETE attempt under the authenticated role raises 42501
--    (insufficient_privilege) BEFORE RLS gets a say. Same posture as
--    approvals (see 10-approvals.test.sql section D), NOT the
--    work_packages silent-no-op pattern.
--
--    With the REVOKE in place, there's no "no DELETE policy → 0 rows"
--    semantic to test — the privilege denial fires first. service_role
--    is the only remaining DELETE path (hard deletes via migration /
--    console action).
-- ============================================================================

-- H.1 project_manager DELETE raises 42501 (REVOKE — privilege layer).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select throws_ok(
  $$ delete from public.purchase_requests
       where id = 'a1111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  '42501',
  null,
  'project_manager DELETE on purchase_requests is denied by REVOKE (privilege layer)'
);

-- H.2 super_admin DELETE raises 42501 as well — the REVOKE binds the
--     authenticated role and a super_admin's session runs under
--     authenticated; super-admin status only matters at the RLS layer,
--     which is never reached.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select throws_ok(
  $$ delete from public.purchase_requests
       where id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  '42501',
  null,
  'super_admin DELETE on purchase_requests is denied by REVOKE (privilege layer)'
);

-- ============================================================================
-- I. Decision audit logging via AFTER UPDATE trigger.
--
--    `purchase_requests_audit_decision` (AFTER UPDATE FOR EACH ROW, WHEN
--    OLD.status='requested' AND NEW.status IN ('approved','rejected'))
--    writes one immutable audit_log row per decision transition. The
--    trigger function is SECURITY DEFINER (set search_path = public),
--    runs as the migration owner, and inserts mirroring the
--    update_my_display_name RPC's column shape (actor_id = auth.uid(),
--    actor_role = public.current_user_role(), action, target_table,
--    target_id, payload).
--
--    The atomicity contract (exactly one row per decision, never on a
--    non-transition update) is now a DB invariant — the action layer
--    does NOT INSERT audit_log; it just runs the guarded UPDATE.
--
--    This section pins:
--      1. requested → approved transitions write exactly one row.
--      2. requested → rejected transitions write exactly one row.
--      3. actor_role on the written row is the caller's current_user_role()
--         (non-null + value), so forensic identity is preserved.
--      4. a non-transition UPDATE (touching a non-status column on a row
--         whose status stays out of 'requested') writes ZERO audit rows
--         — proves the WHEN clause precision.
-- ============================================================================

-- I.1 PM transitions PR_SA2 (a2222) from requested → approved. The trigger
--     fires; the UPDATE itself lives (does not raise).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select lives_ok(
  $$ update public.purchase_requests
       set status      = 'approved',
           approved_by = '33333333-3333-3333-3333-333333333333'::uuid,
           decided_at  = now()
     where id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
       and status = 'requested' $$,
  'PM transitions PR (requested → approved) — guarded UPDATE lives, trigger does not raise'
);

-- I.2 Exactly one audit_log row was written for the transition.
--     This is the DB invariant the application layer used to enforce in TS;
--     now it's enforced by the trigger's FOR EACH ROW + AFTER UPDATE timing
--     and the WHEN clause's old/new status guards.
select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_decision'
       and target_table = 'purchase_requests'
       and target_id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'exactly one audit_log row written for the requested → approved transition'
);

-- I.3 The trigger populated actor_role via public.current_user_role().
--     auth.uid() and current_user_role() resolve under the SECURITY DEFINER
--     function the same way they do in update_my_display_name — to the
--     caller's identity, not the function owner's.
select is(
  (select actor_role::text from public.audit_log
     where action = 'purchase_request_decision'
       and target_id = 'a2222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  'project_manager',
  'actor_role on the audit row is the caller''s current_user_role() (non-null + correct)'
);

-- I.4 PM transitions PR_SA1_NEW (a5555) from requested → rejected with a
--     non-blank comment — the second transition the trigger handles.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select lives_ok(
  $$ update public.purchase_requests
       set status           = 'rejected',
           approved_by      = '33333333-3333-3333-3333-333333333333'::uuid,
           decided_at       = now(),
           decision_comment = 'over budget'
     where id = 'a5555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
       and status = 'requested' $$,
  'PM transitions PR (requested → rejected with comment) — guarded UPDATE lives'
);

-- I.5 Exactly one audit_log row was written for the rejection too.
select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_decision'
       and target_table = 'purchase_requests'
       and target_id = 'a5555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  1,
  'exactly one audit_log row written for the requested → rejected transition'
);

-- I.6 Non-transition UPDATE: PR_PM_APPROVED (a4444) was inserted as
--     'approved' in section A and was never transitioned (G.5's guarded
--     UPDATE matched zero rows). PM touches a non-status column —
--     decision_comment — leaving status='approved'. The trigger's WHEN
--     clause (OLD.status = 'requested') is false, so the trigger does
--     NOT fire. The UPDATE itself lives.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select lives_ok(
  $$ update public.purchase_requests
       set decision_comment = 'post-decision note'
     where id = 'a4444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  'PM non-transition UPDATE on an approved row (status unchanged) lives'
);

-- I.7 Zero audit_log rows for the non-transition target — the WHEN clause
--     kept the trigger from firing. This is the precision half of the
--     invariant: the trigger does not write spurious rows on any UPDATE,
--     only on the requested → approved | rejected boundary.
select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_decision'
       and target_table = 'purchase_requests'
       and target_id = 'a4444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
  0,
  'zero audit_log rows for a non-transition UPDATE — WHEN precision'
);

-- ============================================================================
-- J. Tear down. Reset role to postgres before finish() / the runner's
--    appended dump from _tap_buf, so those run with full privileges.
-- ============================================================================

reset role;

select * from finish();
rollback;
