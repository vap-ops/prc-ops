begin;
select plan(28);

-- ============================================================================
-- Spec 250 U1 — revenue documents chain: quotations → client_pos →
-- project_contracts + contract_installments (งวดเบิก) + client_billings.installment_id.
-- MONEY DOMAIN posture: RLS on, ZERO authenticated grant (matches client_billings),
-- reads via admin client behind app gates; writes only via SECURITY DEFINER RPCs
-- gated is_manager() (null-safe, fail-closed). No document blocks the next:
-- every chain link nullable both directions.
--
-- The zero-grant posture means THIS FILE may not read the money tables as
-- authenticated either — ids created through the RPCs are stashed into _fix
-- (a granted temp table) from the superuser context between steps.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111250', 'pm@sp250.local', '{}'::jsonb),
  ('a2222222-2222-2222-2222-222222222250', 'sa@sp250.local', '{}'::jsonb),
  ('a3333333-3333-3333-3333-333333333250', 'proc@sp250.local', '{}'::jsonb);
update public.users set role='project_manager'  where id='a1111111-1111-1111-1111-111111111250';
update public.users set role='site_admin'       where id='a2222222-2222-2222-2222-222222222250';
update public.users set role='procurement'      where id='a3333333-3333-3333-3333-333333333250';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000250', 'SP250A', 'โครงการ 250A'),
  ('ab000000-0000-0000-0000-000000000250', 'SP250B', 'โครงการ 250B');

create temporary table _fix (k text primary key, v uuid) on commit drop;
grant select on _fix to authenticated;

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ---------------------------------------------------------------------------
-- 1–4. MONEY DOMAIN: zero authenticated grant on all four tables.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111250"}';
select throws_ok($$ select count(*) from public.quotations $$, '42501', null,
  'authenticated has no direct grant on quotations');
select throws_ok($$ select count(*) from public.client_pos $$, '42501', null,
  'authenticated has no direct grant on client_pos');
select throws_ok($$ select count(*) from public.project_contracts $$, '42501', null,
  'authenticated has no direct grant on project_contracts');
select throws_ok($$ select count(*) from public.contract_installments $$, '42501', null,
  'authenticated has no direct grant on contract_installments');

-- ---------------------------------------------------------------------------
-- 5–7. create_quotation: PM allowed; unique per project; amount validated.
select lives_ok(
  $$ select public.create_quotation(
       'aa000000-0000-0000-0000-000000000250', 'Q-2026-001', 500000, '2026-07-01',
       null, null) $$,
  'project_manager can create a quotation');
select throws_ok(
  $$ select public.create_quotation(
       'aa000000-0000-0000-0000-000000000250', 'Q-2026-001', 600000, '2026-07-02',
       null, null) $$,
  '23505', null, 'duplicate quotation_no within a project is rejected (23505)');
select throws_ok(
  $$ select public.create_quotation(
       'aa000000-0000-0000-0000-000000000250', 'Q-2026-002', 0, '2026-07-01',
       null, null) $$,
  'P0001', null, 'quotation amount must be > 0');

-- 8. update_quotation moves status draft → sent.
select lives_ok(
  $$ select public.update_quotation(
       (select public.create_quotation('aa000000-0000-0000-0000-000000000250',
         'Q-2026-UPD', 100000, '2026-07-01', null, null)),
       'sent', null, null, null, null, null) $$,
  'update_quotation can flip status to sent');

-- Stash the Q-2026-001 id for the cross-project link tests (superuser context —
-- authenticated has no read on quotations, by design).
reset role;
insert into _fix values ('q1',
  (select id from public.quotations where quotation_no = 'Q-2026-001'));

-- ---------------------------------------------------------------------------
-- 9–10. client PO: create ok; cross-project quotation link rejected.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111250"}';
select lives_ok(
  $$ select public.create_client_po(
       'aa000000-0000-0000-0000-000000000250', 'PO-9001', 450000, '2026-07-02',
       null, null, null) $$,
  'project_manager can record a client PO without a quotation link');
select throws_ok(
  $$ select public.create_client_po(
       'ab000000-0000-0000-0000-000000000250', 'PO-9002', 450000, '2026-07-02',
       (select v from _fix where k = 'q1'), null, null) $$,
  '22023', null, 'a client PO cannot link a quotation from another project (22023)');

-- ---------------------------------------------------------------------------
-- 11–14. contract: upsert creates, re-upsert updates in place (one per project).
select lives_ok(
  $$ select public.upsert_project_contract(
       'aa000000-0000-0000-0000-000000000250', 550000, 5,
       null, null, null, null, null, null, null, null) $$,
  'upsert_project_contract creates the contract');
select lives_ok(
  $$ select public.upsert_project_contract(
       'aa000000-0000-0000-0000-000000000250', 620000, 5,
       null, null, null, null, null, null, null, null) $$,
  're-upsert updates the same contract');
reset role;
select is(
  (select count(*)::int from public.project_contracts
    where project_id = 'aa000000-0000-0000-0000-000000000250'),
  1, 'still exactly ONE contract row for the project after re-upsert');
select is(
  (select contract_value from public.project_contracts
    where project_id = 'aa000000-0000-0000-0000-000000000250'),
  620000::numeric(14,2), 're-upsert updated contract_value');
insert into _fix values ('c1',
  (select id from public.project_contracts
    where project_id = 'aa000000-0000-0000-0000-000000000250'));

-- 15. cross-project quotation link on the contract is rejected.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111250"}';
select throws_ok(
  $$ select public.upsert_project_contract(
       'ab000000-0000-0000-0000-000000000250', 300000, 5,
       (select v from _fix where k = 'q1'),
       null, null, null, null, null, null, null) $$,
  '22023', null, 'contract cannot link a quotation from another project (22023)');

-- ---------------------------------------------------------------------------
-- 16–18. installments: add two, duplicate seq rejected.
select lives_ok(
  $$ select public.add_contract_installment(
       (select v from _fix where k = 'c1'), 1, 'งวดที่ 1 — เซ็นสัญญา', 200000, null) $$,
  'installment seq 1 added');
select lives_ok(
  $$ select public.add_contract_installment(
       (select v from _fix where k = 'c1'), 2, 'งวดที่ 2 — งานโครงสร้าง', 420000, '2026-09-30') $$,
  'installment seq 2 added');
select throws_ok(
  $$ select public.add_contract_installment(
       (select v from _fix where k = 'c1'), 2, 'ซ้ำ', 100000, null) $$,
  '23505', null, 'duplicate installment seq within a contract is rejected (23505)');

reset role;
insert into _fix values
  ('i1', (select id from public.contract_installments
           where contract_id = (select v from _fix where k = 'c1') and seq = 1)),
  ('i2', (select id from public.contract_installments
           where contract_id = (select v from _fix where k = 'c1') and seq = 2));

-- 19. update_contract_installment edits label/amount.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111250"}';
select lives_ok(
  $$ select public.update_contract_installment(
       (select v from _fix where k = 'i1'), 1, 'งวดที่ 1 — มัดจำ', 210000, null) $$,
  'update_contract_installment edits label/amount');

-- ---------------------------------------------------------------------------
-- 20–21. billing ↔ งวด link: legal link works; cross-project rejected.
select lives_ok(
  $$ select public.set_client_billing_installment(
       (select public.create_client_billing('aa000000-0000-0000-0000-000000000250', 210000)),
       (select v from _fix where k = 'i1')) $$,
  'a billing links to a งวด of its own project');
select throws_ok(
  $$ select public.set_client_billing_installment(
       (select public.create_client_billing('ab000000-0000-0000-0000-000000000250', 99000)),
       (select v from _fix where k = 'i2')) $$,
  '22023', null, 'a billing cannot link a งวด from another project (22023)');

-- 22. RESTRICT blocks removing a referenced installment.
select throws_ok(
  $$ select public.remove_contract_installment((select v from _fix where k = 'i1')) $$,
  '23503', null, 'removing a งวด that a billing references is blocked (23503)');

reset role;
insert into _fix values ('b1',
  (select id from public.client_billings
    where project_id = 'aa000000-0000-0000-0000-000000000250'
      and installment_id is not null limit 1));

-- 23–24. unlink, then removal succeeds.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111250"}';
select lives_ok(
  $$ select public.set_client_billing_installment((select v from _fix where k = 'b1'), null) $$,
  'billing unlinks from the งวด (set null)');
select lives_ok(
  $$ select public.remove_contract_installment((select v from _fix where k = 'i1')) $$,
  'unreferenced งวด removes fine');

-- ---------------------------------------------------------------------------
-- 25–27. gates: site_admin and procurement refused; unbound caller fail-closed.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222250"}';
select throws_ok(
  $$ select public.create_quotation('aa000000-0000-0000-0000-000000000250',
       'Q-SA', 1000, '2026-07-01', null, null) $$,
  '42501', null, 'site_admin cannot create a quotation (42501)');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3333333-3333-3333-3333-333333333250"}';
select throws_ok(
  $$ select public.create_client_po('aa000000-0000-0000-0000-000000000250',
       'PO-PROC', 1000, '2026-07-01', null, null, null) $$,
  '42501', null, 'procurement cannot record a client PO (42501)');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.add_contract_installment(
       '00000000-0000-0000-0000-000000000000', 1, 'x', 100, null) $$,
  '42501', null, 'unbound caller fails closed on installment RPC (42501)');
reset role;

-- 28. audit trail: quotation create landed an audit_log row.
select ok(
  exists (select 1 from public.audit_log
    where action = 'quotation_create'
      and target_table = 'quotations'),
  'quotation_create audit row exists');

select * from finish();
rollback;
