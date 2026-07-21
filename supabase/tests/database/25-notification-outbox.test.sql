begin;
select plan(39);

-- ============================================================================
-- Spec 32 / ADR 0037 — LINE notification outbox.
-- Capture layer: enums + table shape, zero-user-access posture, and the four
-- SECURITY DEFINER capture triggers (WP pending_approval, approvals decision,
-- PR created, PR status transitions incl. derive-driven and cancellation).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-11111111feed', 'super@notif-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-22222222feed', 'sa@notif-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-33333333feed', 'pm@notif-test.local',    '{}'::jsonb);

update public.users set role = 'super_admin'     where id = '11111111-1111-1111-1111-11111111feed';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-22222222feed';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-33333333feed';

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-ccccccccfeed', 'PRC-TEST-NOTIF', 'Notification fixture project');

-- Spec 143 / ADR 0056: visibility is now membership-scoped — enrol this
-- fixture's PM/site_admin users so they can read the project.
insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('PRC-TEST-NOTIF')
     and u.id in (select au.id from auth.users au where au.email like '%@notif-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed',
   'cccccccc-cccc-cccc-cccc-ccccccccfeed', 'WP-NOTIF-1', 'Notification fixture WP');

-- q1: approved (purchased-derive fixture). q2: requested (decision fixture).
-- q4: approved (cancellation fixture). q3 is created in-test by the SA.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status,
   approved_by, decided_at)
values
  ('b1000000-0000-4000-8000-00000000feed',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed',
   'Cement', 10, 'bag', '22222222-2222-2222-2222-22222222feed', 'approved',
   '33333333-3333-3333-3333-33333333feed', now()),
  ('b2000000-0000-4000-8000-00000000feed',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed',
   'Sand', 2, 'truck', '22222222-2222-2222-2222-22222222feed', 'requested',
   null, null),
  ('b4000000-0000-4000-8000-00000000feed',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed',
   'Steel', 5, 'ton', '22222222-2222-2222-2222-22222222feed', 'approved',
   '33333333-3333-3333-3333-33333333feed', now());

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- B. Catalog.
-- ============================================================================

select has_table('public', 'notification_outbox', 'notification_outbox exists');
select enum_has_labels('public', 'notification_event_type',
  array['wp_pending_approval', 'wp_decision', 'pr_created',
        'pr_decision', 'pr_progress', 'pr_cancelled',
        'feedback_submitted', 'wp_reopened', 'site_issue_reported',
        -- Spec 324: SA flags a receipt miscount / BO resolves it.
        'receipt_correction_flagged', 'receipt_correction_resolved',
        -- Spec 337 U1: SA answered a needs_revision and pressed ส่งตรวจอีกครั้ง.
        'wp_evidence_resubmitted'],
  'notification_event_type labels');
select enum_has_labels('public', 'notification_status',
  array['pending', 'sending', 'sent', 'failed', 'expired'],
  'notification_status labels');
select has_column('public', 'notification_outbox', 'event_type', 'event_type exists');
select has_column('public', 'notification_outbox', 'payload',    'payload exists');
select has_column('public', 'notification_outbox', 'attempts',   'attempts exists');
select has_column('public', 'notification_outbox', 'sent_at',    'sent_at exists');
select has_column('public', 'notification_outbox', 'claimed_at', 'claimed_at exists (drain claim)');
select ok(
  (select relrowsecurity from pg_class
     where oid = 'public.notification_outbox'::regclass),
  'RLS is enabled on notification_outbox');

-- ============================================================================
-- C. Zero user access (privileges revoked; no policies).
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-11111111feed"}';

select throws_ok(
  $$ select count(*) from public.notification_outbox $$,
  '42501', null, 'authenticated SELECT on outbox is denied (privilege revoked)');
select throws_ok(
  $$ insert into public.notification_outbox (event_type)
     values ('pr_created') $$,
  '42501', null, 'authenticated INSERT on outbox is denied (privilege revoked)');
select throws_ok(
  $$ update public.notification_outbox set status = 'sent' $$,
  '42501', null, 'authenticated UPDATE on outbox is denied (privilege revoked)');
select throws_ok(
  $$ delete from public.notification_outbox $$,
  '42501', null, 'authenticated DELETE on outbox is denied (privilege revoked)');

set local role anon;
select throws_ok(
  $$ select count(*) from public.notification_outbox $$,
  '42501', null, 'anon SELECT on outbox is denied');

reset role;

select policies_are('public', 'notification_outbox', array[]::name[],
  'outbox has ZERO RLS policies on purpose (no user access path)');
select ok(
  not has_function_privilege('authenticated', 'public.invoke_notification_drain()', 'execute'),
  'authenticated cannot execute invoke_notification_drain (no PostgREST RPC exposure)');
select ok(
  not has_function_privilege('anon', 'public.invoke_notification_drain()', 'execute'),
  'anon cannot execute invoke_notification_drain');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('notify_wp_pending_approval', 'notify_wp_decision',
                        'notify_pr_created', 'notify_pr_status_change',
                        'notify_wp_reopened')
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'),
  5, 'all five capture functions are SECURITY DEFINER with pinned search_path');

-- ============================================================================
-- D. Capture triggers exist.
-- ============================================================================

select has_trigger('public', 'work_packages',
  'work_packages_notify_pending_approval', 'WP pending_approval capture trigger exists');
select has_trigger('public', 'work_packages',
  'work_packages_notify_reopened', 'WP reopen (→rework) capture trigger exists');
select has_trigger('public', 'approvals',
  'approvals_notify_decision', 'approvals decision capture trigger exists');
select has_trigger('public', 'purchase_requests',
  'purchase_requests_notify_created', 'PR created capture trigger exists');
select has_trigger('public', 'purchase_requests',
  'purchase_requests_notify_status_change', 'PR status-change capture trigger exists');

-- ============================================================================
-- E. Capture behavior — purchase requests.
-- ============================================================================

set local role authenticated;

-- E.1 SA raises a PR through the real RLS path → pr_created row.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222feed"}';
select lives_ok(
  $$ insert into public.purchase_requests
       (id, work_package_id, item_description, quantity, unit, requested_by, source)
     values
       ('b3000000-0000-4000-8000-00000000feed',
        'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed',
        'Notify cement', 3, 'bag', '22222222-2222-2222-2222-22222222feed', 'app') $$,
  'SA creates a PR (capture trigger must not block the insert)');

-- E.2 PM decides q2 through the real RLS path → pr_decision row.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-33333333feed"}';
select lives_ok(
  $$ update public.purchase_requests
       set status = 'approved',
           approved_by = '33333333-3333-3333-3333-33333333feed',
           decided_at = now()
     where id = 'b2000000-0000-4000-8000-00000000feed'
       and status = 'requested' $$,
  'PM approves a PR (capture trigger must not block the decide path)');

reset role;

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'pr_created'
       and purchase_request_id = 'b3000000-0000-4000-8000-00000000feed'::uuid
       and payload->>'item_description' = 'Notify cement'
       and payload->>'requested_by' = '22222222-2222-2222-2222-22222222feed'),
  1, 'PR insert produced one pr_created outbox row with snapshot payload');

select is(
  (select status::text || '/' || attempts::text from public.notification_outbox
     where purchase_request_id = 'b3000000-0000-4000-8000-00000000feed'::uuid),
  'pending/0', 'new outbox rows default to pending with zero attempts');

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'pr_decision'
       and purchase_request_id = 'b2000000-0000-4000-8000-00000000feed'::uuid
       and payload->'transition' = '["requested", "approved"]'::jsonb
       and payload->>'decided_by' = '33333333-3333-3333-3333-33333333feed'),
  1, 'decision produced one pr_decision row with transition + decided_by');

-- E.2b WHEN-guard negative: an INSERT that lands in a non-requested
--      status must produce no pr_created row.
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status,
   approved_by, decided_at)
values
  ('b5000000-0000-4000-8000-00000000feed',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed',
   'Direct approved', 1, 'ea', '22222222-2222-2222-2222-22222222feed', 'approved',
   '33333333-3333-3333-3333-33333333feed', now());

select is(
  (select count(*)::int from public.notification_outbox
     where purchase_request_id = 'b5000000-0000-4000-8000-00000000feed'::uuid),
  0, 'INSERT with non-requested status produces no outbox row (WHEN guard)');

-- E.3 Derive-driven transition (the AppSheet write path shape): setting
--     purchased_at flips approved→purchased via the derive trigger; the
--     capture trigger must see it even though no client wrote `status`.
update public.purchase_requests
   set purchased_at = now()
 where id = 'b1000000-0000-4000-8000-00000000feed';

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'pr_progress'
       and purchase_request_id = 'b1000000-0000-4000-8000-00000000feed'::uuid
       and payload->'transition' = '["approved", "purchased"]'::jsonb),
  1, 'derive-driven approved→purchased produced one pr_progress row');

-- E.4 Cancellation → pr_cancelled with the reason snapshot.
update public.purchase_requests
   set status = 'cancelled',
       cancelled_at = now(),
       cancelled_by = '33333333-3333-3333-3333-33333333feed',
       cancellation_reason = 'ไม่ต้องการแล้ว'
 where id = 'b4000000-0000-4000-8000-00000000feed';

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'pr_cancelled'
       and purchase_request_id = 'b4000000-0000-4000-8000-00000000feed'::uuid
       and payload->>'cancellation_reason' = 'ไม่ต้องการแล้ว'),
  1, 'cancellation produced one pr_cancelled row with the reason');

-- ============================================================================
-- F. Capture behavior — work packages + approvals.
-- ============================================================================

-- F.1 WP flips to pending_approval (admin-client path shape: direct UPDATE).
update public.work_packages
   set status = 'pending_approval'
 where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed';

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'wp_pending_approval'
       and work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed'::uuid
       and payload->>'code' = 'WP-NOTIF-1'),
  1, 'WP → pending_approval produced one wp_pending_approval row with code');

-- F.2 A WP update that does NOT change status must not produce a second row.
update public.work_packages
   set name = 'Notification fixture WP (renamed)'
 where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed';

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'wp_pending_approval'
       and work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed'::uuid),
  1, 'status-unchanged WP update produced no extra wp_pending_approval row');

-- F.3 Approvals insert → wp_decision with decision + comment snapshot.
insert into public.approvals (work_package_id, decision, comment, decided_by)
values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed', 'needs_revision', 'แก้ไขรูปช่วงหลัง',
        '33333333-3333-3333-3333-33333333feed');

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'wp_decision'
       and work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed'::uuid
       and payload->>'decision' = 'needs_revision'
       and payload->>'comment' = 'แก้ไขรูปช่วงหลัง'
       and payload->>'decided_by' = '33333333-3333-3333-3333-33333333feed'),
  1, 'approvals insert produced one wp_decision row with snapshot payload');

-- F.4 (spec 218 U5) complete → rework (defect reopen) → one wp_reopened row,
-- snapshotting code + round. Direct UPDATE exercises the trigger independent of
-- the reopen RPC (the RPC path is covered by 75-reopen-wp-for-defect).
update public.work_packages
   set status = 'complete'
 where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed';
update public.work_packages
   set status = 'rework', rework_round = 1
 where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed';

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'wp_reopened'
       and work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeefeed'::uuid
       and payload->>'code' = 'WP-NOTIF-1'
       and payload->>'round' = '1'),
  1, 'complete → rework produced one wp_reopened row with code + round');

-- ============================================================================
-- F2. Failure-swallowing posture (ADR 0037's headline divergence from the
--     audit triggers): a capture failure must NOT block the domain write.
--     Renaming the outbox away makes every capture insert fail; the WP
--     status write must still land, with only a WARNING raised.
-- ============================================================================

insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeee2feed',
   'cccccccc-cccc-cccc-cccc-ccccccccfeed', 'WP-NOTIF-2', 'Swallow fixture WP');

alter table public.notification_outbox rename to notification_outbox_hidden;

select lives_ok(
  $$ update public.work_packages
       set status = 'pending_approval'
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeee2feed' $$,
  'WP write lives while the outbox insert fails (capture failure swallowed)');

alter table public.notification_outbox_hidden rename to notification_outbox;

select is(
  (select status::text from public.work_packages
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeee2feed'),
  'pending_approval', 'the status transition landed despite the capture failure');
select is(
  (select count(*)::int from public.notification_outbox
     where work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeee2feed'::uuid),
  0, 'no outbox row was written during the failure window');

-- ============================================================================
-- G. Drain schedule (migration B) is in place.
-- ============================================================================

select is(
  (select count(*)::int from cron.job
     where jobname = 'notification-drain' and schedule = '* * * * *'),
  1, 'notification-drain cron job is scheduled every minute');

select * from finish();
rollback;
