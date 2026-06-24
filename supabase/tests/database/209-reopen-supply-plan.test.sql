begin;
select plan(10);

-- ============================================================================
-- Spec 194 — super_admin override: reopen an approved/submitted (frozen) supply
-- plan back to editable (draft), stamping overridden_by / overridden_at so the
-- plan is permanently labeled "ปรับแก้โดย [name]". super_admin only — it bypasses
-- the normal lifecycle (the PM submits, PD/super approves), so it is the operator
-- escape hatch, audited by the stamp.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('59000000-0000-4000-8000-000000000209', 'super@sp.local', '{}'::jsonb),
  ('11000000-0000-4000-8000-000000000209', 'pm@sp.local', '{}'::jsonb);
update public.users set role = 'super_admin'     where id = '59000000-0000-4000-8000-000000000209';
update public.users set role = 'project_manager' where id = '11000000-0000-4000-8000-000000000209';

insert into public.projects (id, code, name, project_lead_id) values
  ('a9000000-0000-4000-8000-000000000209', 'PRC-SP209', 'โครงการ209', null);
-- An APPROVED (frozen) plan.
insert into public.supply_plans (id, project_id, status, approved_by, approved_at) values
  ('b9000000-0000-4000-8000-000000000209', 'a9000000-0000-4000-8000-000000000209',
   'approved', '11000000-0000-4000-8000-000000000209', now());

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog — the override stamp columns.
select has_column('public', 'supply_plans', 'overridden_by', 'supply_plans has overridden_by');
select has_column('public', 'supply_plans', 'overridden_at', 'supply_plans has overridden_at');

-- B. Only super_admin may reopen.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11000000-0000-4000-8000-000000000209"}';
select throws_ok(
  $$ select public.reopen_supply_plan('b9000000-0000-4000-8000-000000000209') $$,
  '42501', null, 'a project_manager cannot reopen (super only)');

set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000209"}';
select lives_ok(
  $$ select public.reopen_supply_plan('b9000000-0000-4000-8000-000000000209') $$,
  'super_admin reopens the approved plan');

reset role;
select is(
  (select status from public.supply_plans where id = 'b9000000-0000-4000-8000-000000000209'),
  'draft'::public.supply_plan_status, 'reopened → draft (editable again)');
select is(
  (select overridden_by from public.supply_plans where id = 'b9000000-0000-4000-8000-000000000209'),
  '59000000-0000-4000-8000-000000000209'::uuid, 'overridden_by = the super_admin');
select is(
  (select approved_by from public.supply_plans where id = 'b9000000-0000-4000-8000-000000000209'),
  null, 'the prior approval is cleared on reopen');

-- C. A draft plan can't be reopened (only a locked one).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "59000000-0000-4000-8000-000000000209"}';
select throws_ok(
  $$ select public.reopen_supply_plan('b9000000-0000-4000-8000-000000000209') $$,
  '22023', null, 'a draft plan cannot be reopened');

reset role;

-- D. Execute lockdown.
select is(has_function_privilege('anon', 'public.reopen_supply_plan(uuid)', 'EXECUTE'),
  false, 'anon cannot execute reopen_supply_plan');
select is(has_function_privilege('authenticated', 'public.reopen_supply_plan(uuid)', 'EXECUTE'),
  true, 'authenticated can execute reopen_supply_plan');

select * from finish();
rollback;
