begin;
select plan(16);

-- ============================================================================
-- Spec 201 awareness arc A2 — reporter reply-awareness (unread seen-state).
-- feedback_views(feedback_id, user_id, last_viewed_at) is a MUTABLE, zero-direct-
-- access table; the caller marks a report viewed (mark_feedback_viewed) and asks
-- which of their OWN reports have a team reply (operator/agent) newer than they last
-- viewed it (feedback_unread_ids). A reporter's own messages never count as unread.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-4000-8000-000000000221', 'sa@fbv.local',    '{}'::jsonb),
  ('50000000-0000-4000-8000-000000000221', 'other@fbv.local', '{}'::jsonb),
  ('59000000-0000-4000-8000-000000000221', 'super@fbv.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = '5a000000-0000-4000-8000-000000000221';
update public.users set role = 'site_admin'  where id = '50000000-0000-4000-8000-000000000221';
update public.users set role = 'super_admin' where id = '59000000-0000-4000-8000-000000000221';

-- F1 — submitted by S, carries an OLD operator reply (clearly before "now").
insert into public.feedback (id, type, title, body, submitted_by, role_snapshot, status)
values ('7e000000-0000-4000-8000-000000000221', 'bug', 'ปุ่มหาย', 'หาปุ่มไม่เจอ',
        '5a000000-0000-4000-8000-000000000221', 'site_admin', 'open');
insert into public.feedback_messages (feedback_id, author_kind, author_id, body, created_at)
values ('7e000000-0000-4000-8000-000000000221', 'operator',
        '59000000-0000-4000-8000-000000000221', 'กำลังดูให้ครับ', timestamptz '2020-01-01 00:00:00+00');

-- F2 — submitted by S, carries ONLY the reporter's own message (must never be unread).
insert into public.feedback (id, type, title, body, submitted_by, role_snapshot, status)
values ('7e000000-0000-4000-8000-000000000222', 'feature', 'ขอกลุ่มวัสดุ', 'อยากได้กลุ่มใหม่',
        '5a000000-0000-4000-8000-000000000221', 'site_admin', 'open');
insert into public.feedback_messages (feedback_id, author_kind, author_id, body, created_at)
values ('7e000000-0000-4000-8000-000000000222', 'reporter',
        '5a000000-0000-4000-8000-000000000221', 'เพิ่มเติมนิดนึง', timestamptz '2020-02-01 00:00:00+00');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog + execute lockdown.
select has_table('public', 'feedback_views', 'feedback_views exists');
select is(
  has_function_privilege('authenticated', 'public.mark_feedback_viewed(uuid)', 'EXECUTE'),
  true, 'authenticated can execute mark_feedback_viewed');
select is(
  has_function_privilege('anon', 'public.mark_feedback_viewed(uuid)', 'EXECUTE'),
  false, 'anon cannot execute mark_feedback_viewed');
select is(
  has_function_privilege('authenticated', 'public.feedback_unread_ids()', 'EXECUTE'),
  true, 'authenticated can execute feedback_unread_ids');
select is(
  has_function_privilege('anon', 'public.feedback_unread_ids()', 'EXECUTE'),
  false, 'anon cannot execute feedback_unread_ids');
-- Zero direct access: the table is RPC-only (a direct SELECT would raise 42501, not
-- return rows), so assert the privilege is absent rather than running a SELECT.
select is(
  has_table_privilege('authenticated', 'public.feedback_views', 'SELECT'),
  false, 'authenticated has no direct SELECT on feedback_views (RPC-only)');

-- B. The reporter has an unread team reply on F1 (operator msg, no view yet); F2
--    (their own reporter message only) is NOT unread.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000221"}';
select is(
  (select count(*)::int from public.feedback_unread_ids() as t(id)
   where t.id = '7e000000-0000-4000-8000-000000000221'),
  1, 'F1 (an unanswered team reply) is unread for its reporter');
select is(
  (select count(*)::int from public.feedback_unread_ids() as t(id)
   where t.id = '7e000000-0000-4000-8000-000000000222'),
  0, 'F2 (only the reporter''s own message) is never unread');
reset role;

-- C. After the reporter views F1, it is no longer unread.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000221"}';
select lives_ok(
  $$ select public.mark_feedback_viewed('7e000000-0000-4000-8000-000000000221') $$,
  'the reporter marks F1 viewed');
select is(
  (select count(*)::int from public.feedback_unread_ids() as t(id)
   where t.id = '7e000000-0000-4000-8000-000000000221'),
  0, 'F1 is cleared once the reporter has viewed it');
reset role;

-- D. A NEW team reply (created after the view) flips F1 back to unread.
insert into public.feedback_messages (feedback_id, author_kind, author_id, body, created_at)
values ('7e000000-0000-4000-8000-000000000221', 'agent', null, 'อัปเดต: แก้แล้วครับ',
        now() + interval '1 hour');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000221"}';
select is(
  (select count(*)::int from public.feedback_unread_ids() as t(id)
   where t.id = '7e000000-0000-4000-8000-000000000221'),
  1, 'a team reply newer than the last view re-flags F1 as unread');
reset role;

-- E. feedback_unread_ids is caller-scoped: a different user sees none of S's reports.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "50000000-0000-4000-8000-000000000221"}';
select is(
  (select count(*)::int from public.feedback_unread_ids()),
  0, 'unread is scoped to the caller''s own submissions');
-- and a non-owner non-super cannot mark someone else's report viewed.
select throws_ok(
  $$ select public.mark_feedback_viewed('7e000000-0000-4000-8000-000000000221') $$,
  '42501', null, 'a non-owner non-super cannot mark another''s report viewed');
reset role;

-- F. super_admin may mark any report viewed; an unknown id is not-found (22023).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000221"}';
select lives_ok(
  $$ select public.mark_feedback_viewed('7e000000-0000-4000-8000-000000000221') $$,
  'super_admin can mark any report viewed');
select throws_ok(
  $$ select public.mark_feedback_viewed('00000000-0000-4000-8000-000000000000') $$,
  '22023', null, 'marking an unknown report is not-found');
reset role;

-- G. feedback_views is intentionally MUTABLE (not append-only): an UPDATE succeeds
--    (contrast feedback_messages, where UPDATE raises P0001).
select lives_ok(
  $$ update public.feedback_views set last_viewed_at = now()
       where feedback_id = '7e000000-0000-4000-8000-000000000221'
         and user_id = '5a000000-0000-4000-8000-000000000221' $$,
  'feedback_views is mutable (UPDATE allowed)');

select * from finish();
rollback;
