begin;
select plan(17);

-- ============================================================================
-- Spec 201 U4 — CC drafts → operator approves (the human-in-the-loop gate).
-- A CC reply is NOT a message yet: it is staged in feedback_message_drafts
-- (mutable, super_admin-only — the reporter must NEVER see an unapproved draft).
-- CC (service_role) stages via draft_feedback_message; the super_admin operator
-- approves via publish_feedback_draft (inserts a real append-only agent message
-- + deletes the draft) or drops it via discard_feedback_draft. Approval is the
-- only path a draft reaches the reporter.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-4000-8000-000000000220', 'sa@fbdr.local', '{}'::jsonb),
  ('59000000-0000-4000-8000-000000000220', 'super@fbdr.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = '5a000000-0000-4000-8000-000000000220';
update public.users set role = 'super_admin' where id = '59000000-0000-4000-8000-000000000220';

insert into public.feedback (id, type, title, body, submitted_by, role_snapshot, status)
values ('7e000000-0000-4000-8000-000000000220', 'bug', 'ปุ่มหาย', 'หาปุ่มไม่เจอ',
        '5a000000-0000-4000-8000-000000000220', 'site_admin', 'open');

-- Two CC-staged drafts (direct insert as the test owner = the service-role path).
insert into public.feedback_message_drafts (id, feedback_id, body) values
  ('d1000000-0000-4000-8000-000000000220', '7e000000-0000-4000-8000-000000000220', 'ขอรูปหน้าจอด้วยครับ'),
  ('d2000000-0000-4000-8000-000000000220', '7e000000-0000-4000-8000-000000000220', 'ลองอัปเดตแอปแล้วแจ้งกลับ');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog + execute lockdown.
select has_table('public', 'feedback_message_drafts', 'feedback_message_drafts exists');
select is(
  has_function_privilege('authenticated', 'public.draft_feedback_message(uuid, text)', 'EXECUTE'),
  false, 'authenticated cannot execute draft_feedback_message (CC/service_role only)');
select is(
  has_function_privilege('service_role', 'public.draft_feedback_message(uuid, text)', 'EXECUTE'),
  true, 'service_role can execute draft_feedback_message');
select is(
  has_function_privilege('authenticated', 'public.publish_feedback_draft(uuid)', 'EXECUTE'),
  true, 'authenticated can execute publish_feedback_draft (super gate is in-body)');
select is(
  has_function_privilege('anon', 'public.publish_feedback_draft(uuid)', 'EXECUTE'),
  false, 'anon cannot execute publish_feedback_draft');

-- B. Drafts are hidden from the reporter, visible to the super_admin.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000220"}';
select is(
  (select count(*)::int from public.feedback_message_drafts
   where feedback_id = '7e000000-0000-4000-8000-000000000220'),
  0, 'the reporter cannot see pending drafts');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000220"}';
select is(
  (select count(*)::int from public.feedback_message_drafts
   where feedback_id = '7e000000-0000-4000-8000-000000000220'),
  2, 'the super_admin sees the pending drafts');
reset role;

-- C. CC (service_role path = owner here) stages another draft via the RPC.
select lives_ok(
  $$ select public.draft_feedback_message('7e000000-0000-4000-8000-000000000220', 'ร่างจาก CC') $$,
  'draft_feedback_message stages a draft');

-- D. the super_admin approves d1 → a real agent message, draft removed.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000220"}';
select lives_ok(
  $$ select public.publish_feedback_draft('d1000000-0000-4000-8000-000000000220') $$,
  'super_admin publishes a draft');
reset role;
select is(
  (select count(*)::int from public.feedback_messages
   where feedback_id = '7e000000-0000-4000-8000-000000000220' and author_kind = 'agent'),
  1, 'the approved draft becomes a published agent message');
select is(
  (select count(*)::int from public.feedback_message_drafts
   where id = 'd1000000-0000-4000-8000-000000000220'),
  0, 'the draft is removed once published');

-- E. the reporter now sees the approved agent reply (and still no drafts).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000220"}';
select is(
  (select count(*)::int from public.feedback_messages
   where feedback_id = '7e000000-0000-4000-8000-000000000220' and author_kind = 'agent'),
  1, 'the reporter sees the approved agent reply');
reset role;

-- F. a non-super cannot publish or discard (42501).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "5a000000-0000-4000-8000-000000000220"}';
select throws_ok(
  $$ select public.publish_feedback_draft('d2000000-0000-4000-8000-000000000220') $$,
  '42501', null, 'a non-super cannot publish a draft');
select throws_ok(
  $$ select public.discard_feedback_draft('d2000000-0000-4000-8000-000000000220') $$,
  '42501', null, 'a non-super cannot discard a draft');
reset role;

-- G. the super_admin discards d2; publishing an unknown draft is not-found (22023).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000220"}';
select lives_ok(
  $$ select public.discard_feedback_draft('d2000000-0000-4000-8000-000000000220') $$,
  'super_admin discards a draft');
select is(
  (select count(*)::int from public.feedback_message_drafts
   where id = 'd2000000-0000-4000-8000-000000000220'),
  0, 'the discarded draft is gone');
select throws_ok(
  $$ select public.publish_feedback_draft('00000000-0000-4000-8000-000000000000') $$,
  '22023', null, 'publishing an unknown draft raises not-found');
reset role;

select * from finish();
rollback;
