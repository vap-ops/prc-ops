begin;
select plan(11);

-- ============================================================================
-- Spec 193 U2 — feedback attachments (screenshots). A user attaches images to
-- their own bug/feature report; CC reads them (via the service-role admin) to see
-- exactly what's wrong. Mirrors contact_attachments: zero authenticated access
-- (RLS on, no grants), write via the add_feedback_attachment definer (caller must
-- OWN the feedback), append-only.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('aa000000-0000-4000-8000-000000000210', 'a@fb.local', '{}'::jsonb),
  ('bb000000-0000-4000-8000-000000000210', 'b@fb.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = 'aa000000-0000-4000-8000-000000000210';
update public.users set role = 'project_manager' where id = 'bb000000-0000-4000-8000-000000000210';

-- A feedback row owned by A.
insert into public.feedback (id, type, title, body, submitted_by, role_snapshot) values
  ('fb000000-0000-4000-8000-000000000210', 'bug', 'ปุ่มเพี้ยน', 'ดูรูป',
   'aa000000-0000-4000-8000-000000000210', 'site_admin');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog.
select has_table('public', 'feedback_attachments', 'feedback_attachments table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.feedback_attachments'::regclass),
  'RLS enabled');

-- B. add_feedback_attachment — the owner can, a non-owner cannot.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "aa000000-0000-4000-8000-000000000210"}';
select isnt(
  (select public.add_feedback_attachment(
     'fb000000-0000-4000-8000-000000000210', 'feedback/fb000000-0000-4000-8000-000000000210/x.png')),
  null, 'the feedback owner attaches an image');

set local "request.jwt.claims" = '{"sub": "bb000000-0000-4000-8000-000000000210"}';
select throws_ok(
  $$ select public.add_feedback_attachment(
       'fb000000-0000-4000-8000-000000000210', 'feedback/fb000000-0000-4000-8000-000000000210/y.png') $$,
  '42501', null, 'a non-owner cannot attach to someone else''s feedback');

-- C. Zero authenticated read (CC/operator read via the service-role admin). A
-- no-grant table hard-errors on a direct SELECT, so check the privilege catalog.
select is(
  has_table_privilege('authenticated', 'public.feedback_attachments', 'SELECT'),
  false, 'no authenticated SELECT grant — admin-read only');

reset role;
select is((select count(*) from public.feedback_attachments
            where feedback_id = 'fb000000-0000-4000-8000-000000000210'),
  1::bigint, 'the row landed (service-role sees it)');
select is((select uploaded_by from public.feedback_attachments
            where feedback_id = 'fb000000-0000-4000-8000-000000000210'),
  'aa000000-0000-4000-8000-000000000210'::uuid, 'uploaded_by = the caller');

-- D. Append-only (block trigger).
select throws_ok(
  $$ update public.feedback_attachments set storage_path = 'z'
       where feedback_id = 'fb000000-0000-4000-8000-000000000210' $$,
  'P0001', null, 'feedback_attachments is append-only (no UPDATE)');
select throws_ok(
  $$ delete from public.feedback_attachments
       where feedback_id = 'fb000000-0000-4000-8000-000000000210' $$,
  'P0001', null, 'feedback_attachments is append-only (no DELETE)');

-- E. Execute lockdown.
select is(has_function_privilege('anon', 'public.add_feedback_attachment(uuid, text)', 'EXECUTE'),
  false, 'anon cannot execute add_feedback_attachment');
select is(has_function_privilege('authenticated', 'public.add_feedback_attachment(uuid, text)', 'EXECUTE'),
  true, 'authenticated can execute add_feedback_attachment');

select * from finish();
rollback;
