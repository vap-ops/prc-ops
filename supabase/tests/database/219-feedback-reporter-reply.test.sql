begin;
select plan(5);

-- ============================================================================
-- Spec 201 U3 — reporter reply. post_feedback_message widens: the report's own
-- submitter may now post (stamped author_kind = 'reporter'); the super_admin
-- operator still posts (stamped 'operator'). The author voice is derived from the
-- caller, not trusted from an argument. A non-owner non-super is still denied.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-4000-8000-000000000219', 'sa@fbrr.local', '{}'::jsonb),
  ('59000000-0000-4000-8000-000000000219', 'super@fbrr.local', '{}'::jsonb),
  ('50000000-0000-4000-8000-000000000219', 'other@fbrr.local', '{}'::jsonb);
update public.users set role = 'site_admin'      where id = '5a000000-0000-4000-8000-000000000219';
update public.users set role = 'super_admin'     where id = '59000000-0000-4000-8000-000000000219';
update public.users set role = 'project_manager' where id = '50000000-0000-4000-8000-000000000219';

insert into public.feedback (id, type, title, body, submitted_by, role_snapshot, status)
values ('7e000000-0000-4000-8000-000000000219', 'bug', 'แอปค้าง', 'กดแล้วไม่ไป',
        '5a000000-0000-4000-8000-000000000219', 'site_admin', 'open');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. the submitter posts a reply on their own report.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000219"}';
select lives_ok(
  $$ select public.post_feedback_message('7e000000-0000-4000-8000-000000000219', 'ส่งรูปให้แล้วครับ') $$,
  'the submitter posts a reply on their own report');
reset role;

-- B. that message is authored as 'reporter', by the submitter.
select is(
  (select author_kind::text from public.feedback_messages
   where feedback_id = '7e000000-0000-4000-8000-000000000219'),
  'reporter', 'the submitter''s message is authored as reporter');
select is(
  (select author_id::text from public.feedback_messages
   where feedback_id = '7e000000-0000-4000-8000-000000000219'),
  '5a000000-0000-4000-8000-000000000219', 'the message records the submitter as author');

-- C. a non-owner non-super still cannot post (42501).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "50000000-0000-4000-8000-000000000219"}';
select throws_ok(
  $$ select public.post_feedback_message('7e000000-0000-4000-8000-000000000219', 'แทรก') $$,
  '42501', null, 'a non-owner non-super cannot post');
reset role;

-- D. the super_admin still posts, stamped as operator (role-derived both ways).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000219"}';
select public.post_feedback_message('7e000000-0000-4000-8000-000000000219', 'รับเรื่องแล้วครับ');
reset role;
select is(
  (select count(*)::int from public.feedback_messages
   where feedback_id = '7e000000-0000-4000-8000-000000000219' and author_kind = 'operator'),
  1, 'the super_admin reply is stamped as operator');

select * from finish();
rollback;
