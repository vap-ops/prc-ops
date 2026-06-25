begin;
select plan(13);

-- ============================================================================
-- Spec 201 U2 — feedback two-way: the conversation thread on a report.
-- feedback_messages is append-only (the message doctrine — like
-- feedback_attachments). Reads are own-thread (the submitter) or super_admin
-- (the operator + CC). Writes are RPC-only: in U2 post_feedback_message is
-- super_admin-only (an operator reply — the human-approved channel); the
-- reporter-reply path is U3, CC drafts are U4.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-4000-8000-000000000218', 'sa@fbmsg.local', '{}'::jsonb),
  ('59000000-0000-4000-8000-000000000218', 'super@fbmsg.local', '{}'::jsonb),
  ('50000000-0000-4000-8000-000000000218', 'other@fbmsg.local', '{}'::jsonb);
update public.users set role = 'site_admin'      where id = '5a000000-0000-4000-8000-000000000218';
update public.users set role = 'super_admin'     where id = '59000000-0000-4000-8000-000000000218';
update public.users set role = 'project_manager' where id = '50000000-0000-4000-8000-000000000218';

-- Seed one report owned by the site_admin (direct insert as the test owner).
insert into public.feedback (id, type, title, body, submitted_by, role_snapshot, status)
values ('7e000000-0000-4000-8000-000000000218', 'bug', 'รูปไม่ขึ้น', 'อัปโหลดแล้วค้าง',
        '5a000000-0000-4000-8000-000000000218', 'site_admin', 'open');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog + execute lockdown.
select has_table('public', 'feedback_messages', 'feedback_messages exists');
select has_function('public', 'post_feedback_message', array['uuid', 'text'],
  'post_feedback_message exists');
select is(
  has_function_privilege('anon', 'public.post_feedback_message(uuid, text)', 'EXECUTE'),
  false, 'anon cannot execute post_feedback_message');
select is(
  has_function_privilege('authenticated', 'public.post_feedback_message(uuid, text)', 'EXECUTE'),
  true, 'authenticated can execute post_feedback_message');

-- B. super_admin posts an operator reply on the thread.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000218"}';
select lives_ok(
  $$ select public.post_feedback_message('7e000000-0000-4000-8000-000000000218', 'ขอรูปหน้าจอตอนค้างด้วยครับ') $$,
  'super_admin posts a message');
reset role;
select is(
  (select author_kind::text from public.feedback_messages
   where feedback_id = '7e000000-0000-4000-8000-000000000218'),
  'operator', 'the posted message is authored as operator');

-- C. the submitter can read their own thread.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000218"}';
select is(
  (select count(*)::int from public.feedback_messages
   where feedback_id = '7e000000-0000-4000-8000-000000000218'),
  1, 'submitter reads the thread on their own feedback');
reset role;

-- D. an unrelated non-super user cannot read the thread.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "50000000-0000-4000-8000-000000000218"}';
select is(
  (select count(*)::int from public.feedback_messages
   where feedback_id = '7e000000-0000-4000-8000-000000000218'),
  0, 'a non-submitter non-super reads nothing');
reset role;

-- E. a non-owner non-super caller cannot post (42501). (The submitter posting is
-- the reporter-reply path — covered by U3 / file 219.)
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "50000000-0000-4000-8000-000000000218"}';
select throws_ok(
  $$ select public.post_feedback_message('7e000000-0000-4000-8000-000000000218', 'ตอบกลับ') $$,
  '42501', null, 'a non-owner non-super cannot post a message');
reset role;

-- F. unknown feedback id raises not-found (22023); empty body raises 22023.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000218"}';
select throws_ok(
  $$ select public.post_feedback_message('00000000-0000-4000-8000-000000000000', 'hi') $$,
  '22023', null, 'unknown feedback id raises not-found');
select throws_ok(
  $$ select public.post_feedback_message('7e000000-0000-4000-8000-000000000218', '   ') $$,
  '22023', null, 'empty body is rejected');
reset role;

-- G. append-only — UPDATE/DELETE are blocked at the table (owner context, so RLS
-- does not filter the rows away before the trigger fires).
select throws_ok(
  $$ update public.feedback_messages set body = 'x'
     where feedback_id = '7e000000-0000-4000-8000-000000000218' $$,
  'P0001', null, 'feedback_messages is append-only (no UPDATE)');
select throws_ok(
  $$ delete from public.feedback_messages
     where feedback_id = '7e000000-0000-4000-8000-000000000218' $$,
  'P0001', null, 'feedback_messages is append-only (no DELETE)');

select * from finish();
rollback;
