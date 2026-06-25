begin;
select plan(8);

-- ============================================================================
-- Spec 201 awareness arc A4 — feedback_submitted LINE capture (ADR 0037).
-- A new bug report / feature request enqueues one notification_outbox row
-- (snapshot in payload — feedback has no WP/PR FK) so the drainer can push the
-- operator (super_admin). SECURITY DEFINER + failure-SWALLOW: a capture failure
-- must never block submit_feedback. (Enum value added in mig …001700.)
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-4000-8000-000000000222', 'sa@fbn.local', '{}'::jsonb);
update public.users set role = 'site_admin' where id = '5a000000-0000-4000-8000-000000000222';

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog: the capture trigger + a SECURITY DEFINER, pinned-search_path function.
select has_trigger('public', 'feedback', 'feedback_notify_submitted',
  'feedback submit capture trigger exists');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'notify_feedback_submitted'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'),
  1, 'notify_feedback_submitted is SECURITY DEFINER with pinned search_path');

-- B. Enqueue behavior — a reporter files through the real submit_feedback path.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000222"}';
select lives_ok(
  $$ select public.submit_feedback('bug', 'รูปอัปโหลดไม่ขึ้น', 'กดแล้วไม่ขึ้น') $$,
  'submit_feedback succeeds (the capture trigger must not block it)');
reset role;

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'feedback_submitted'
       and payload->>'feedback_title' = 'รูปอัปโหลดไม่ขึ้น'
       and payload->>'feedback_type'  = 'bug'
       and payload->>'role_snapshot'  = 'site_admin'
       and payload->>'submitted_by'   = '5a000000-0000-4000-8000-000000000222'),
  1, 'submit produced one feedback_submitted outbox row with the snapshot payload');

select is(
  (select status::text || '/' || attempts::text from public.notification_outbox
     where event_type = 'feedback_submitted'
       and payload->>'feedback_title' = 'รูปอัปโหลดไม่ขึ้น'),
  'pending/0', 'the feedback_submitted row defaults to pending with zero attempts');

-- C. Failure-swallow: hide the outbox so the capture insert fails; the report must
--    still land, with only a WARNING. A direct insert (known id) fires the trigger.
alter table public.notification_outbox rename to notification_outbox_hidden;
select lives_ok(
  $$ insert into public.feedback (id, type, title, body, submitted_by, role_snapshot)
     values ('7e000000-0000-4000-8000-000000000222', 'feature', 'SWALLOW', 'x',
             '5a000000-0000-4000-8000-000000000222', 'site_admin') $$,
  'a feedback insert lives while the outbox insert fails (capture failure swallowed)');
alter table public.notification_outbox_hidden rename to notification_outbox;

select is(
  (select count(*)::int from public.feedback
     where id = '7e000000-0000-4000-8000-000000000222'),
  1, 'the report landed despite the capture failure');
select is(
  (select count(*)::int from public.notification_outbox
     where payload->>'feedback_id' = '7e000000-0000-4000-8000-000000000222'),
  0, 'no outbox row was written during the failure window');

select * from finish();
rollback;
