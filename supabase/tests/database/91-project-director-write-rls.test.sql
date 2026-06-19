begin;
select plan(4);

-- ============================================================================
-- Spec 152 U3 / ADR 0058 — project_director table write (+ master read) RLS.
--
-- Some core PM actions are direct-table writes gated by RLS, not RPCs — most
-- importantly APPROVING a work package (an insert into approvals). U3 adds
-- project_director to every RLS policy whose role list names project_manager.
-- Proven two ways:
--   1. Completeness (catalog): no policy field that names project_manager is
--      left without project_director.
--   2. Behaviour: a project_director (see-all, NOT a member) inserts an approval
--      and updates a work_package directly; a visitor is still denied.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1a1a1a1-0152-0152-0152-a1a1a1a1a1a1', 'director@pd3-test.local', '{}'::jsonb),
  ('a2a2a2a2-0152-0152-0152-a2a2a2a2a2a2', 'visitor@pd3-test.local',  '{}'::jsonb);

update public.users set role='project_director' where id='a1a1a1a1-0152-0152-0152-a1a1a1a1a1a1';
-- 'a2a2…' stays visitor.

-- Project + WP the director is NOT a member of (see-all is the point).
insert into public.projects (id, code, name, project_lead_id) values
  ('a3a3a3a3-0152-0152-0152-a3a3a3a3a3a3', 'PRC-PD3', 'โครงการยู3', null);
insert into public.work_packages (id, project_id, code, name) values
  ('a4a4a4a4-0152-0152-0152-a4a4a4a4a4a4',
   'a3a3a3a3-0152-0152-0152-a3a3a3a3a3a3', 'WP-U3', 'งานยู3');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- 1. Completeness — every policy field naming project_manager also names
--    project_director.
-- ============================================================================
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and ( (coalesce(qual,'')       ilike '%''project_manager''%'
             and coalesce(qual,'')       not ilike '%''project_director''%')
         or (coalesce(with_check,'') ilike '%''project_manager''%'
             and coalesce(with_check,'') not ilike '%''project_director''%') )),
  0,
  'no RLS policy names project_manager without project_director');

set local role authenticated;

-- ============================================================================
-- 2-3. project_director writes directly (see-all, not a member).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "a1a1a1a1-0152-0152-0152-a1a1a1a1a1a1"}';

select lives_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('a4a4a4a4-0152-0152-0152-a4a4a4a4a4a4',
             'approved'::public.approval_decision, 'ok',
             'a1a1a1a1-0152-0152-0152-a1a1a1a1a1a1') $$,
  'director may insert an approval (RLS admits director + see-all)');

select lives_ok(
  $$ update public.work_packages set notes = 'ตรวจแล้ว'
       where id = 'a4a4a4a4-0152-0152-0152-a4a4a4a4a4a4' $$,
  'director may update a work_package directly (RLS write admits director)');

-- ============================================================================
-- 4. Negative control — a visitor is still denied (policy did not fall open).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "a2a2a2a2-0152-0152-0152-a2a2a2a2a2a2"}';

select throws_ok(
  $$ insert into public.approvals (work_package_id, decision, comment, decided_by)
     values ('a4a4a4a4-0152-0152-0152-a4a4a4a4a4a4',
             'approved'::public.approval_decision, 'no',
             'a2a2a2a2-0152-0152-0152-a2a2a2a2a2a2') $$,
  '42501',
  null,
  'visitor is still denied inserting an approval');

reset role;

select * from finish();
rollback;
