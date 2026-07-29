-- Spec 373 §5 — the hard validate-before-pay gate (operator decision 2026-07-29):
-- mark_expense_reimbursed REFUSES unless the expense's spec-345 review is
-- 'verified'. Message pinned on every refusal so P0001 here is never confused
-- with the pre-existing already-reimbursed guard. The verified case is the
-- POSITIVE CONTROL — without it, "refuses" is equally consistent with the RPC
-- being broken outright.

begin;
select plan(6);

-- principals
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1','paygate-acct@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000f2','paygate-sub@t.local','{}'::jsonb);
update public.users set role='accounting' where id='00000000-0000-0000-0000-0000000000f1';
update public.users set role='procurement' where id='00000000-0000-0000-0000-0000000000f2';

-- fixture expenses (owner-inserted; RLS bypassed for setup)
insert into public.office_expense_categories (id, label_th, sort) values
  ('00000000-0000-0000-0000-0000000000f3','ทดสอบเกตจ่าย',990);
insert into public.office_expenses
  (id, category_id, description, amount, expense_date, payment_source, submitted_by, reimburse_to_user_id) values
  ('00000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-0000000000f3',
   'gate: no review row', 100, '2026-07-01', 'own_money', '00000000-0000-0000-0000-0000000000f2',
   '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-0000000000f5','00000000-0000-0000-0000-0000000000f3',
   'gate: pending review', 100, '2026-07-01', 'own_money', '00000000-0000-0000-0000-0000000000f2',
   '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-0000000000f6','00000000-0000-0000-0000-0000000000f3',
   'gate: flagged review', 100, '2026-07-01', 'own_money', '00000000-0000-0000-0000-0000000000f2',
   '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-0000000000f7','00000000-0000-0000-0000-0000000000f3',
   'gate: verified review', 100, '2026-07-01', 'own_money', '00000000-0000-0000-0000-0000000000f2',
   '00000000-0000-0000-0000-0000000000f2');

-- review rows (owner-inserted; money_event_reviews is sealed — no policies)
-- verified rows must carry attribution (money_event_reviews_verified_attrib)
insert into public.money_event_reviews (source_table, source_id, status, verified_at, verified_via, verified_by) values
  ('office_expenses','00000000-0000-0000-0000-0000000000f5','pending', null, null, null),
  ('office_expenses','00000000-0000-0000-0000-0000000000f6','flagged', null, null, null),
  ('office_expenses','00000000-0000-0000-0000-0000000000f7','verified', now(), 'reviewer',
   '00000000-0000-0000-0000-0000000000f1');

-- allow role switches to write TAP
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f1"}';

-- absent review row = not verified
select throws_ok($$
  select public.mark_expense_reimbursed('00000000-0000-0000-0000-0000000000f4')
$$, 'P0001', 'mark_expense_reimbursed: expense not verified',
  'no review row at all -> refused (absent = unverified)');

-- pending refuses
select throws_ok($$
  select public.mark_expense_reimbursed('00000000-0000-0000-0000-0000000000f5')
$$, 'P0001', 'mark_expense_reimbursed: expense not verified',
  'pending review -> refused');

-- flagged refuses
select throws_ok($$
  select public.mark_expense_reimbursed('00000000-0000-0000-0000-0000000000f6')
$$, 'P0001', 'mark_expense_reimbursed: expense not verified',
  'flagged review -> refused');

-- POSITIVE CONTROL: verified opens the gate (else every refusal above is
-- equally consistent with a broken RPC)
select lives_ok($$
  select public.mark_expense_reimbursed('00000000-0000-0000-0000-0000000000f7')
$$, 'verified review -> mark succeeds');
select isnt(
  (select reimbursed_at from public.office_expenses
    where id='00000000-0000-0000-0000-0000000000f7'),
  null, 'reimbursed_at set on the verified expense');

-- and no other fixture expense was touched
select is(
  (select count(*)::int from public.office_expenses
    where id in ('00000000-0000-0000-0000-0000000000f4','00000000-0000-0000-0000-0000000000f5',
                 '00000000-0000-0000-0000-0000000000f6')
      and reimbursed_at is not null),
  0, 'refused expenses stay unpaid');

select * from finish();
rollback;
