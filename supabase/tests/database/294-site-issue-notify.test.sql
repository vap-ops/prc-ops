begin;
select plan(12);

-- ============================================================================
-- Spec 277 P1a PR3 — serious-site-issue capture (AUTOMATION #1, ADR 0037).
-- A SERIOUS site issue (safety / access / equipment) enqueues ONE
-- notification_outbox row so the drainer can alert the project PM + the
-- project_director / procurement_manager pools. A MINOR issue (weather / other)
-- enqueues nothing — the serious-set SSOT is the trigger WHEN clause. The
-- capture is SECURITY DEFINER + failure-SWALLOW: it must never block the insert.
-- Trigger fires for any writer (AFTER INSERT), so these direct inserts exercise
-- it fully; the report_site_issue RPC path itself is covered by file 293.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('51700000-0000-4000-8000-000000000003', 'sa@siteissue-test.local', '{}'::jsonb);
update public.users set role = 'site_admin'
  where id = '51700000-0000-4000-8000-000000000003';

insert into public.projects (id, code, name) values
  ('51700000-0000-4000-8000-000000000001', 'PRC-TEST-SITEISSUE', 'Site-issue fixture project');
insert into public.work_packages (id, project_id, code, name) values
  ('51700000-0000-4000-8000-000000000002',
   '51700000-0000-4000-8000-000000000001', 'WP-ISSUE-1', 'Site-issue fixture WP');

-- ============================================================================
-- A. Catalog — the capture trigger + a SECURITY DEFINER, pinned-search_path fn.
-- ============================================================================

select has_trigger('public', 'site_issues', 'site_issues_notify_serious',
  'serious site-issue capture trigger exists');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'notify_site_issue_reported'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'),
  1, 'notify_site_issue_reported is SECURITY DEFINER with pinned search_path');

-- ============================================================================
-- B. Serious enqueue — a safety issue WITH a WP produces one snapshot row, with
--    work_package_id riding on the outbox row (drain resolves WP code for free).
-- ============================================================================
insert into public.site_issues (project_id, work_package_id, issue_type, note, reported_by)
values ('51700000-0000-4000-8000-000000000001',
        '51700000-0000-4000-8000-000000000002', 'safety', 'นั่งร้านถล่ม',
        '51700000-0000-4000-8000-000000000003');

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'site_issue_reported'
       and work_package_id = '51700000-0000-4000-8000-000000000002'
       and payload->>'project_id'  = '51700000-0000-4000-8000-000000000001'
       and payload->>'issue_type'  = 'safety'
       and payload->>'reported_by' = '51700000-0000-4000-8000-000000000003'),
  1, 'a serious (safety) issue enqueues one site_issue_reported row with the snapshot payload + WP id');
select is(
  (select status::text || '/' || attempts::text from public.notification_outbox
     where event_type = 'site_issue_reported' and payload->>'issue_type' = 'safety'),
  'pending/0', 'the site_issue_reported row defaults to pending with zero attempts');

-- Serious WITHOUT a WP — work_package_id is null on the row.
insert into public.site_issues (project_id, work_package_id, issue_type, reported_by)
values ('51700000-0000-4000-8000-000000000001', null, 'access',
        '51700000-0000-4000-8000-000000000003');
select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'site_issue_reported'
       and payload->>'issue_type' = 'access'
       and work_package_id is null),
  1, 'a serious (access) issue with no WP enqueues a row with a null work_package_id');

-- ============================================================================
-- C. Non-serious enqueue NOTHING — the WHEN clause is the serious-set SSOT.
-- ============================================================================
insert into public.site_issues (project_id, work_package_id, issue_type, note, reported_by)
values ('51700000-0000-4000-8000-000000000001',
        '51700000-0000-4000-8000-000000000002', 'weather', 'ฝนตกหนัก',
        '51700000-0000-4000-8000-000000000003');
select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'site_issue_reported' and payload->>'issue_type' = 'weather'),
  0, 'a minor (weather) issue enqueues NO outbox row');

insert into public.site_issues (project_id, issue_type, reported_by)
values ('51700000-0000-4000-8000-000000000001', 'other',
        '51700000-0000-4000-8000-000000000003');
select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'site_issue_reported' and payload->>'issue_type' = 'other'),
  0, 'a minor (other) issue enqueues NO outbox row');

-- equipment IS serious.
insert into public.site_issues (project_id, work_package_id, issue_type, reported_by)
values ('51700000-0000-4000-8000-000000000001',
        '51700000-0000-4000-8000-000000000002', 'equipment',
        '51700000-0000-4000-8000-000000000003');
select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'site_issue_reported' and payload->>'issue_type' = 'equipment'),
  1, 'a serious (equipment) issue enqueues one outbox row');

-- Exactly three serious rows total (safety + access + equipment) — weather/other made none.
select is(
  (select count(*)::int from public.notification_outbox where event_type = 'site_issue_reported'),
  3, 'three serious issues produced exactly three rows; the two minor issues produced none');

-- ============================================================================
-- D. Failure-SWALLOW — hide the outbox so the capture insert fails; the site
--    issue must still land, with only a WARNING and no orphaned outbox row.
-- ============================================================================
alter table public.notification_outbox rename to notification_outbox_hidden;
select lives_ok(
  $$ insert into public.site_issues (id, project_id, issue_type, reported_by)
     values ('51700000-0000-4000-8000-0000000000ff',
             '51700000-0000-4000-8000-000000000001', 'safety',
             '51700000-0000-4000-8000-000000000003') $$,
  'a site_issue insert lives while the outbox insert fails (capture failure swallowed)');
alter table public.notification_outbox_hidden rename to notification_outbox;

select is(
  (select count(*)::int from public.site_issues
     where id = '51700000-0000-4000-8000-0000000000ff'),
  1, 'the issue landed despite the capture failure');
select is(
  (select count(*)::int from public.notification_outbox where event_type = 'site_issue_reported'),
  3, 'no outbox row was written during the failure window (still exactly three)');

select * from finish();
rollback;
