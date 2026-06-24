begin;
select plan(8);

-- ============================================================================
-- Spec 193 U3 — feedback triage. set_feedback_status moves a report through its
-- lifecycle (open → in_progress → done / declined). super_admin-only (the RLS
-- already scopes reads to super; the write RPC re-checks the role). The feedback
-- table has no UPDATE grant/policy, so this definer is the sole status writer.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-4000-8000-000000000217', 'sa@fbst.local', '{}'::jsonb),
  ('59000000-0000-4000-8000-000000000217', 'super@fbst.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = '5a000000-0000-4000-8000-000000000217';
update public.users set role = 'super_admin' where id = '59000000-0000-4000-8000-000000000217';

-- Seed one report (direct insert as the test owner — bypasses RLS, like a fixture).
insert into public.feedback (id, type, title, body, submitted_by, role_snapshot, status)
values ('7e000000-0000-4000-8000-000000000217', 'bug', 'ปุ่มกดไม่ได้', 'กดแล้วเงียบ',
        '5a000000-0000-4000-8000-000000000217', 'site_admin', 'open');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog + execute lockdown.
select has_function('public', 'set_feedback_status', array['uuid', 'feedback_status'],
  'set_feedback_status exists');
select is(
  has_function_privilege('anon',
    'public.set_feedback_status(uuid, public.feedback_status)', 'EXECUTE'),
  false, 'anon cannot execute set_feedback_status');
select is(
  has_function_privilege('authenticated',
    'public.set_feedback_status(uuid, public.feedback_status)', 'EXECUTE'),
  true, 'authenticated can execute set_feedback_status');

-- B. super_admin moves the report to done.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000217"}';
select lives_ok(
  $$ select public.set_feedback_status('7e000000-0000-4000-8000-000000000217', 'done') $$,
  'super_admin sets the status');
reset role;
select is(
  (select status::text from public.feedback where id = '7e000000-0000-4000-8000-000000000217'),
  'done', 'status updated to done');

-- C. a non-super caller is denied (42501) and the status is unchanged.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000217"}';
select throws_ok(
  $$ select public.set_feedback_status('7e000000-0000-4000-8000-000000000217', 'declined') $$,
  '42501', null, 'site_admin cannot set status');
reset role;
select is(
  (select status::text from public.feedback where id = '7e000000-0000-4000-8000-000000000217'),
  'done', 'status unchanged after a denied call');

-- D. an unknown id raises not-found (22023).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000217"}';
select throws_ok(
  $$ select public.set_feedback_status('00000000-0000-4000-8000-000000000000', 'done') $$,
  '22023', null, 'unknown feedback id raises not-found');
reset role;

select * from finish();
rollback;
