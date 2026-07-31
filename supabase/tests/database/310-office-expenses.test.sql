begin;
select plan(39);

-- principals
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1','sa@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a2','acct@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a3','proc@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a4','site@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a5','holder@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a6','tech@t.local','{}'::jsonb);
update public.users set role='super_admin' where id='00000000-0000-0000-0000-0000000000a1';
update public.users set role='accounting'  where id='00000000-0000-0000-0000-0000000000a2';
update public.users set role='procurement' where id='00000000-0000-0000-0000-0000000000a3';
update public.users set role='site_admin'  where id='00000000-0000-0000-0000-0000000000a4';
update public.users set role='procurement' where id='00000000-0000-0000-0000-0000000000a5';
update public.users set role='technician'  where id='00000000-0000-0000-0000-0000000000a6';

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
select has_column('public','office_expense_attachments','purpose','U9: attachments carry a doc purpose (slip/tax-invoice)');

-- allow role switches to write TAP
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- office_expenses is a real table with committed production rows; the finance-role
-- (accounting) asserts below see ALL of them under RLS. Every "where
-- payment_source='company_card'" probe is therefore scoped to the fixture submitter
-- (a3) so it selects THIS test's card expense, never a real committed one.

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
  (select reimburse_to_user_id from public.office_expenses where payment_source='company_card' and submitted_by = '00000000-0000-0000-0000-0000000000a3' limit 1),
  null::uuid, 'no card expense yet (control)');

-- ===== card source resolves holder =====
select lives_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1', 'น้ำมัน', 500.00, '2026-07-12',
    'company_card'::public.payment_source, '00000000-0000-0000-0000-0000000000b1',
    '00000000-0000-0000-0000-0000000000d1')
$$, 'card expense records');

select is(
  (select reimburse_to_user_id from public.office_expenses where payment_source='company_card' and submitted_by = '00000000-0000-0000-0000-0000000000a3' limit 1),
  '00000000-0000-0000-0000-0000000000a5'::uuid,
  'company_card reimburse-target = card holder');

-- ===== card source WITHOUT a card raises P0001 =====
select throws_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1','x',10,'2026-07-12','company_card'::public.payment_source,null,null)
$$, 'P0001', null, 'card source requires a card');

-- ===== U6: site_admin now records (widened); technician still denied =====
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a4"}';
select lives_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1','ค่าเดินทาง',10,'2026-07-12','own_money'::public.payment_source,null,null)
$$, 'site_admin can record office expense (U6 widen)');
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a6"}';
select throws_ok($$
  select public.record_office_expense(
    '00000000-0000-0000-0000-0000000000c1','x',10,'2026-07-12','own_money'::public.payment_source,null,null)
$$, '42501', null, 'technician (not an office role) cannot record');

-- ===== finance marks reimbursed; procurement cannot =====
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
select throws_ok($$
  select public.mark_expense_reimbursed(
    (select id from public.office_expenses where payment_source='company_card' and submitted_by = '00000000-0000-0000-0000-0000000000a3' limit 1))
$$, '42501', null, 'non-finance cannot mark reimbursed');

-- Spec 373 §5: marking now requires a verified spec-345 review (hard pay-gate)
-- — verify the fixture expense first (owner insert; the sealed table has no
-- policies). Intent of this case is unchanged: finance CAN mark.
reset role;
insert into public.money_event_reviews (source_table, source_id, status, verified_at, verified_via, verified_by)
select 'office_expenses', id, 'verified', now(), 'reviewer', '00000000-0000-0000-0000-0000000000a2'
  from public.office_expenses
 where payment_source='company_card' and submitted_by='00000000-0000-0000-0000-0000000000a3'
 limit 1;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
select lives_ok($$
  select public.mark_expense_reimbursed(
    (select id from public.office_expenses where payment_source='company_card' and submitted_by = '00000000-0000-0000-0000-0000000000a3' limit 1))
$$, 'accounting can mark reimbursed (once verified — spec 373 gate)');
select isnt(
  (select reimbursed_at from public.office_expenses where payment_source='company_card' and submitted_by = '00000000-0000-0000-0000-0000000000a3' limit 1),
  null, 'reimbursed_at set');
select throws_ok($$
  select public.mark_expense_reimbursed(
    (select id from public.office_expenses where payment_source='company_card' and submitted_by = '00000000-0000-0000-0000-0000000000a3' limit 1))
$$, 'P0001', null, 'cannot double-mark an already-reimbursed expense');

-- ===== upsert_company_card gated to super_admin =====
select throws_ok($$
  select public.upsert_company_card(null,'X card','00000000-0000-0000-0000-0000000000a5',null)
$$, '42501', null, 'accounting cannot upsert card');
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
select lives_ok($$
  select public.upsert_company_card(null,'X card','00000000-0000-0000-0000-0000000000a5','1234')
$$, 'super_admin can upsert card');

-- ===== U4: office_expense_attachments INSERT policy =====
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
select lives_ok($$
  insert into public.office_expense_attachments (id, office_expense_id, storage_path, created_by)
  values (gen_random_uuid(),
          (select id from public.office_expenses where submitted_by='00000000-0000-0000-0000-0000000000a3' limit 1),
          'p/'||gen_random_uuid(), '00000000-0000-0000-0000-0000000000a3')
$$, 'submitter can attach a receipt to own expense');
select throws_ok($$
  insert into public.office_expense_attachments (id, office_expense_id, storage_path, created_by)
  values (gen_random_uuid(),
          (select id from public.office_expenses where submitted_by='00000000-0000-0000-0000-0000000000a3' limit 1),
          'p/'||gen_random_uuid(), '00000000-0000-0000-0000-0000000000a5')
$$, '42501', null, 'cannot attach with a forged created_by');

-- ===== Feedback 41cd07d9 (mig 075889) — update/delete an office expense =====
-- Gates: submitter-until-reimbursed OR finance (super_admin/accounting);
-- reimbursed rows locked for EVERYONE (P0001); authz refusal (42501) wins over
-- the lock for outsiders. Reimburse target re-derived on edit — own_money maps
-- to the SUBMITTER, never the editor (finance editing must not steal the
-- target). Delete also clears the row's money_event_reviews entries
-- (polymorphic source, no FK) and audits a full snapshot.

-- The own_money ฿250 row recorded above = the editable fixture (un-reimbursed).
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
select lives_ok($$
  select public.update_office_expense(
    (select id from public.office_expenses where payment_source='own_money' and submitted_by='00000000-0000-0000-0000-0000000000a3' and id <> '00000000-0000-0000-0000-0000000000e2' limit 1),
    '00000000-0000-0000-0000-0000000000c1', 'พิมพ์เอกสาร (แก้วันที่)', 150.00, '2026-07-11',
    'own_money'::public.payment_source, '00000000-0000-0000-0000-0000000000b1', null)
$$, '41cd07d9: submitter edits own un-reimbursed expense (amount+date+project)');
select is(
  (select amount from public.office_expenses where payment_source='own_money' and submitted_by='00000000-0000-0000-0000-0000000000a3' and id <> '00000000-0000-0000-0000-0000000000e2' limit 1),
  150.00::numeric, 'amount updated');
select is(
  (select project_id from public.office_expenses where payment_source='own_money' and submitted_by='00000000-0000-0000-0000-0000000000a3' and id <> '00000000-0000-0000-0000-0000000000e2' limit 1),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'project updated');
select is(
  (select reimburse_to_user_id from public.office_expenses where payment_source='own_money' and submitted_by='00000000-0000-0000-0000-0000000000a3' and id <> '00000000-0000-0000-0000-0000000000e2' limit 1),
  '00000000-0000-0000-0000-0000000000a3'::uuid, 'own_money reimburse target stays the submitter');

-- Fixed-id fixture for the outsider + delete legs (an outsider's RLS hides
-- other rows, so an id-subquery under their claims nulls out — the target must
-- be a literal id; the DEFINER fn sees it regardless).
reset role;
insert into public.office_expenses
  (id, category_id, description, amount, expense_date, payment_source, reimburse_to_user_id, submitted_by)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c1',
        'ลงวันที่ผิด จะลบ', 99.00, '2026-07-01', 'own_money',
        '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a3');
insert into public.office_expense_attachments (id, office_expense_id, storage_path, created_by)
values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e2',
        'p/oe-del-test', '00000000-0000-0000-0000-0000000000a3');
insert into public.money_event_reviews (source_table, source_id, project_id, status)
values ('office_expenses', '00000000-0000-0000-0000-0000000000e2', null, 'pending');
set local role authenticated;

-- Outsider (technician, not submitter, not finance) — refused.
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a6"}';
select throws_ok($$
  select public.update_office_expense(
    '00000000-0000-0000-0000-0000000000e2',
    '00000000-0000-0000-0000-0000000000c1', 'x', 1.00, '2026-07-11',
    'own_money'::public.payment_source, null, null)
$$, '42501', null, 'non-submitter non-finance cannot edit');

-- Finance edits anyone's un-reimbursed row; source flip re-derives the target.
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
select lives_ok($$
  select public.update_office_expense(
    (select id from public.office_expenses where payment_source='own_money' and submitted_by='00000000-0000-0000-0000-0000000000a3' and id <> '00000000-0000-0000-0000-0000000000e2' limit 1),
    '00000000-0000-0000-0000-0000000000c1', 'น้ำมัน (บัตร)', 150.00, '2026-07-11',
    'company_card'::public.payment_source, null, '00000000-0000-0000-0000-0000000000d1')
$$, 'finance can edit any un-reimbursed expense (source -> company_card)');
select is(
  (select reimburse_to_user_id from public.office_expenses
    where submitted_by='00000000-0000-0000-0000-0000000000a3' and description='น้ำมัน (บัตร)' limit 1),
  '00000000-0000-0000-0000-0000000000a5'::uuid, 'company_card re-derivation = card holder');
select lives_ok($$
  select public.update_office_expense(
    (select id from public.office_expenses where submitted_by='00000000-0000-0000-0000-0000000000a3' and description='น้ำมัน (บัตร)' limit 1),
    '00000000-0000-0000-0000-0000000000c1', 'พิมพ์เอกสาร (คืนแหล่งเดิม)', 150.00, '2026-07-11',
    'own_money'::public.payment_source, null, null)
$$, 'finance flips the source back to own_money');
select is(
  (select reimburse_to_user_id from public.office_expenses
    where submitted_by='00000000-0000-0000-0000-0000000000a3' and description='พิมพ์เอกสาร (คืนแหล่งเดิม)' limit 1),
  '00000000-0000-0000-0000-0000000000a3'::uuid,
  'own_money re-derivation = the SUBMITTER, never the finance editor');

-- Reimbursed rows are LOCKED for everyone (the card expense above was marked).
select throws_ok($$
  select public.update_office_expense(
    (select id from public.office_expenses where payment_source='company_card' and submitted_by='00000000-0000-0000-0000-0000000000a3' and reimbursed_at is not null limit 1),
    '00000000-0000-0000-0000-0000000000c1', 'x', 1.00, '2026-07-11',
    'company_card'::public.payment_source, null, '00000000-0000-0000-0000-0000000000d1')
$$, 'P0001', null, 'reimbursed row locked for edit (even finance)');
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
select throws_ok($$
  select public.delete_office_expense(
    (select id from public.office_expenses where payment_source='company_card' and submitted_by='00000000-0000-0000-0000-0000000000a3' and reimbursed_at is not null limit 1))
$$, 'P0001', null, 'reimbursed row locked for delete (even the submitter)');

-- Delete: the fixed-id fixture (seeded above) — outsider refused, then the
-- submitter deletes and every satellite row goes with it.
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a6"}';
select throws_ok($$
  select public.delete_office_expense('00000000-0000-0000-0000-0000000000e2')
$$, '42501', null, 'outsider cannot delete');
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
select lives_ok($$
  select public.delete_office_expense('00000000-0000-0000-0000-0000000000e2')
$$, 'submitter deletes own un-reimbursed expense');

reset role;
select is((select count(*)::int from public.office_expenses where id='00000000-0000-0000-0000-0000000000e2'), 0, 'expense row gone');
select is((select count(*)::int from public.office_expense_attachments where office_expense_id='00000000-0000-0000-0000-0000000000e2'), 0, 'attachment rows gone (FK cascade)');
-- Reviews SURVIVE (flags FK them append-only; the queue reader unions from
-- office_expenses so the orphan renders nowhere) — deleting them would 23503
-- on any flagged expense, the exact edit-then-delete sequence this unit serves.
select is((select count(*)::int from public.money_event_reviews where source_table='office_expenses' and source_id='00000000-0000-0000-0000-0000000000e2'), 1, 'review entry survives the delete (append-only flags FK it)');
select is(
  (select count(*)::int from public.audit_log where action='office_expense_delete' and target_id='00000000-0000-0000-0000-0000000000e2'),
  1, 'delete audited with a snapshot');
select ok(
  (select count(*) from public.audit_log a
    where a.action='office_expense_update'
      and a.target_id in (select id from public.office_expenses
                           where submitted_by='00000000-0000-0000-0000-0000000000a3')) >= 1,
  'edits audited (scoped to this fixture submitter — never a global count)');
select ok(
  pg_get_triggerdef((select oid from pg_trigger where tgname='office_expenses_money_review_stale')) ~ 'project_id',
  'money-review stale trigger also watches project_id (and category) changes');

-- ===== anon cannot exec =====
reset role;
set local role anon;
select throws_ok($$ select public.record_office_expense(
  '00000000-0000-0000-0000-0000000000c1','x',10,'2026-07-12','own_money'::public.payment_source,null,null) $$,
  '42501', null, 'anon exec blocked');

select * from finish();
rollback;
