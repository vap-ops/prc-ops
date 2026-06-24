begin;
select plan(13);

-- ============================================================================
-- Spec 193 — in-app feedback (bug report / feature request). Any authenticated
-- user submits via the submit_feedback definer (which stamps submitted_by +
-- role_snapshot server-side, so CC sees who/what-role hit it). RLS: the submitter
-- reads their own, super_admin reads all (CC + the operator); other users see
-- nothing. Writes are RPC-only.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-4000-8000-000000000208', 'sa@fb.local', '{}'::jsonb),
  ('11000000-0000-4000-8000-000000000208', 'pm@fb.local', '{}'::jsonb),
  ('59000000-0000-4000-8000-000000000208', 'super@fb.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = '5a000000-0000-4000-8000-000000000208';
update public.users set role = 'project_manager' where id = '11000000-0000-4000-8000-000000000208';
update public.users set role = 'super_admin' where id = '59000000-0000-4000-8000-000000000208';

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog.
select has_table('public', 'feedback', 'feedback table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.feedback'::regclass),
  'RLS enabled');
select enum_has_labels('public', 'feedback_type', array['bug', 'feature'], 'feedback_type labels');
select enum_has_labels('public', 'feedback_status',
  array['open', 'in_progress', 'done', 'declined'], 'feedback_status labels');

-- B. submit — any authenticated user; submitted_by + role_snapshot are stamped.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000208"}';
select isnt(
  (select public.submit_feedback('bug', 'ปุ่มกดไม่ได้', 'กดแล้วไม่มีอะไรเกิดขึ้น',
     'หน้ารายการงาน', '/sa', '0.1.0', 'jsdom')),
  null, 'a site_admin submits a bug');

reset role;
select is(
  (select submitted_by from public.feedback where title = 'ปุ่มกดไม่ได้'),
  '5a000000-0000-4000-8000-000000000208'::uuid, 'submitted_by = the caller');
select is(
  (select role_snapshot from public.feedback where title = 'ปุ่มกดไม่ได้'),
  'site_admin'::public.user_role, 'role_snapshot = the caller''s role');
select is(
  (select type::text from public.feedback where title = 'ปุ่มกดไม่ได้'),
  'bug', 'type stored');

-- C. RLS read scoping.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000208"}';
select is((select count(*) from public.feedback where title = 'ปุ่มกดไม่ได้'),
  1::bigint, 'the submitter reads their own feedback');
set local "request.jwt.claims" = '{"sub": "11000000-0000-4000-8000-000000000208"}';
select is((select count(*) from public.feedback where title = 'ปุ่มกดไม่ได้'),
  0::bigint, 'another user does not see it');
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000208"}';
select is((select count(*) from public.feedback where title = 'ปุ่มกดไม่ได้'),
  1::bigint, 'super_admin reads all feedback');

reset role;

-- D. Execute lockdown.
select is(
  has_function_privilege('anon',
    'public.submit_feedback(public.feedback_type, text, text, text, text, text, text)', 'EXECUTE'),
  false, 'anon cannot execute submit_feedback');
select is(
  has_function_privilege('authenticated',
    'public.submit_feedback(public.feedback_type, text, text, text, text, text, text)', 'EXECUTE'),
  true, 'authenticated can execute submit_feedback');

select * from finish();
rollback;
