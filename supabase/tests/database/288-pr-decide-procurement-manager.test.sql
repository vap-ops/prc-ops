begin;
select plan(5);

-- Spec 286 — procurement_manager may DECIDE (approve/reject) a requested PR
-- (walks back ADR 0070 item 3). RLS gates WHO decides + the old-state it applies to
-- (requested rows). NOTE: RLS cannot scope the exact transition once the decide and
-- spec-261 cancel policies coexist — Postgres OR-combines their USING (old) and
-- WITH CHECK (new) INDEPENDENTLY, so a raw requested->cancelled / approved->rejected
-- is reachable via the API. That is ACCEPTED (operator decision 2026-07-09): same
-- posture as pm/super (role-only RLS), with the app enforcing the transition (the UI
-- pins .eq(status,...)). So we assert what RLS DOES guarantee: role-gating + decide
-- is scoped to requested rows.

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000286-0000-4000-8000-000000000001', 'pm@pm286.local',   '{}'::jsonb),
  ('a2000286-0000-4000-8000-000000000002', 'proc@pm286.local', '{}'::jsonb),
  ('a3000286-0000-4000-8000-000000000003', 'pmgr@pm286.local', '{}'::jsonb);
update public.users set role = 'project_manager'     where id = 'a1000286-0000-4000-8000-000000000001';
update public.users set role = 'procurement'         where id = 'a2000286-0000-4000-8000-000000000002';
update public.users set role = 'procurement_manager' where id = 'a3000286-0000-4000-8000-000000000003';

insert into public.projects (id, code, name) values
  ('c0000286-0000-4000-8000-000000000001', 'TAP-PM286', 'spec286 fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('e0000286-0000-4000-8000-000000000001',
   'c0000286-0000-4000-8000-000000000001', 'WP-PM286', 'pm286 WP', 'in_progress');
insert into public.purchase_requests
    (id, work_package_id, project_id, item_description, quantity, unit, status, source, requested_by) values
  ('fa000286-0000-4000-8000-000000000001','e0000286-0000-4000-8000-000000000001','c0000286-0000-4000-8000-000000000001','ปูน',10,'ถุง','requested','app','a1000286-0000-4000-8000-000000000001'),
  ('fa000286-0000-4000-8000-000000000002','e0000286-0000-4000-8000-000000000001','c0000286-0000-4000-8000-000000000001','เหล็ก',5,'เส้น','requested','app','a1000286-0000-4000-8000-000000000001'),
  ('fa000286-0000-4000-8000-000000000003','e0000286-0000-4000-8000-000000000001','c0000286-0000-4000-8000-000000000001','ทราย',3,'คิว','requested','app','a1000286-0000-4000-8000-000000000001'),
  -- a non-requested (purchased) PR: procurement_manager's decide policy (USING old.status='requested') must not reach it.
  ('fa000286-0000-4000-8000-000000000004','e0000286-0000-4000-8000-000000000001','c0000286-0000-4000-8000-000000000001','อิฐ',100,'ก้อน','purchased','app','a1000286-0000-4000-8000-000000000001');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3000286-0000-4000-8000-000000000003"}';

with u_ok as (
  update public.purchase_requests
     set status='approved', approved_by='a3000286-0000-4000-8000-000000000003', decided_at=now()
   where id='fa000286-0000-4000-8000-000000000001' and status='requested'
  returning 1)
select is((select count(*)::int from u_ok), 1,
  'procurement_manager CAN approve a requested PR (spec 286)');

with u_rej as (
  update public.purchase_requests
     set status='rejected', approved_by='a3000286-0000-4000-8000-000000000003',
         decided_at=now(), decision_comment='ไม่อนุมัติ (test)'
   where id='fa000286-0000-4000-8000-000000000002' and status='requested'
  returning 1)
select is((select count(*)::int from u_rej), 1,
  'procurement_manager CAN reject a requested PR (spec 286)');

-- decide is scoped to requested rows (USING old.status='requested'): a purchased PR is
-- outside procurement_manager's reach — no USING matches, so 0 rows (clean, not an error).
with u_bad as (
  update public.purchase_requests
     set status='rejected', approved_by='a3000286-0000-4000-8000-000000000003', decided_at=now()
   where id='fa000286-0000-4000-8000-000000000004' and status='purchased'
  returning 1)
select is((select count(*)::int from u_bad), 0,
  'procurement_manager CANNOT decide a non-requested (purchased) PR — decide is scoped to requested rows');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000286-0000-4000-8000-000000000002"}';
with u_proc as (
  update public.purchase_requests
     set status='approved', approved_by='a2000286-0000-4000-8000-000000000002', decided_at=now()
   where id='fa000286-0000-4000-8000-000000000003' and status='requested'
  returning 1)
select is((select count(*)::int from u_proc), 0,
  'plain procurement still CANNOT approve a requested PR');
reset role;

select is(
  (select status::text from public.purchase_requests where id='fa000286-0000-4000-8000-000000000003'),
  'requested', 'the PR plain procurement tried to approve is unchanged');

select * from finish();
rollback;
