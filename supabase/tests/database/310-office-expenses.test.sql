begin;
select plan(16);

-- principals
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1','sa@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a2','acct@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a3','proc@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a4','site@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a5','holder@t.local','{}'::jsonb);
update public.users set role='super_admin' where id='00000000-0000-0000-0000-0000000000a1';
update public.users set role='accounting'  where id='00000000-0000-0000-0000-0000000000a2';
update public.users set role='procurement' where id='00000000-0000-0000-0000-0000000000a3';
update public.users set role='site_admin'  where id='00000000-0000-0000-0000-0000000000a4';
update public.users set role='procurement' where id='00000000-0000-0000-0000-0000000000a5';

-- fixtures created as table owner (bypass RLS for setup)
insert into public.projects (id, name, code) values
  ('00000000-0000-0000-0000-0000000000b1','Test Project','TP1') on conflict do nothing;
insert into public.office_expense_categories (id, label_th, sort) values
  ('00000000-0000-0000-0000-0000000000c1','ทดสอบ',10);
insert into public.company_cards (id, label, holder_user_id, created_by) values
  ('00000000-0000-0000-0000-0000000000d1','PD Visa','00000000-0000-0000-0000-0000000000a5',
   '00000000-0000-0000-0000-0000000000a1');

select has_table('public','company_cards','company_cards exists');
select has_table('public','office_expenses','office_expenses exists');
select has_table('public','office_expense_attachments','attachments table exists');

-- allow role switches to write TAP
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ===== procurement records an own_money expense -> reimburse = caller =====
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
select lives_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1', 'พิมพ์เอกสาร', 250.00, '2026-07-12',
    'own_money'::public.payment_source, null, null)
$$, 'procurement can record own_money expense');

-- control: no card expense yet
select is(
  (select reimburse_to_user_id from public.office_expenses where payment_source='company_card' limit 1),
  null::uuid, 'no card expense yet (control)');

-- ===== card source resolves holder =====
select lives_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1', 'น้ำมัน', 500.00, '2026-07-12',
    'company_card'::public.payment_source, '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000d1')
$$, 'card expense records');

select is(
  (select reimburse_to_user_id from public.office_expenses where payment_source='company_card' limit 1),
  '00000000-0000-0000-0000-0000000000a5'::uuid,
  'company_card reimburse-target = card holder');

-- ===== card source WITHOUT a card raises P0001 =====
select throws_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1','x',10,'2026-07-12','company_card'::public.payment_source,null,null)
$$, 'P0001', null, 'card source requires a card');

-- ===== site_admin denied (42501) =====
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a4"}';
select throws_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1','x',10,'2026-07-12','own_money'::public.payment_source,null,null)
$$, '42501', null, 'site_admin cannot record office expense');

-- ===== finance marks reimbursed; procurement cannot =====
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
select throws_ok($$
  select public.mark_expense_reimbursed(
    (select id from public.office_expenses where payment_source='company_card' limit 1))
$$, '42501', null, 'non-finance cannot mark reimbursed');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
select lives_ok($$
  select public.mark_expense_reimbursed(
    (select id from public.office_expenses where payment_source='company_card' limit 1))
$$, 'accounting can mark reimbursed');
select isnt(
  (select reimbursed_at from public.office_expenses where payment_source='company_card' limit 1),
  null, 'reimbursed_at set');
select throws_ok($$
  select public.mark_expense_reimbursed(
    (select id from public.office_expenses where payment_source='company_card' limit 1))
$$, 'P0001', null, 'cannot double-mark an already-reimbursed expense');

-- ===== upsert_company_card gated to super_admin =====
select throws_ok($$
  select public.upsert_company_card(null,'X card','00000000-0000-0000-0000-0000000000a5',null)
$$, '42501', null, 'accounting cannot upsert card');
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
select lives_ok($$
  select public.upsert_company_card(null,'X card','00000000-0000-0000-0000-0000000000a5','1234')
$$, 'super_admin can upsert card');

-- ===== anon cannot exec =====
reset role;
set local role anon;
select throws_ok($$ select public.record_office_expense(
  '00000000-0000-0000-0000-0000000000c1','x',10,'2026-07-12','own_money'::public.payment_source,null,null) $$,
  '42501', null, 'anon exec blocked');

select * from finish();
rollback;
