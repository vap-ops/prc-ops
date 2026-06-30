begin;
select plan(6);

-- ============================================================================
-- Spec 234 follow-up (broken-link stopgap, mig 039000) — grant_client_access
-- relaxed: a PD/super may grant a VISITOR (flips them to client, no token —
-- the manual equivalent of the broken claim link) OR an existing client. Staff
-- and contractor targets stay ineligible (no demotion / no silent flip).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000244', 'pd@v.local',  '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000244', 'vis@v.local', '{}'::jsonb),
  ('f0000000-0000-4000-8000-000000000244', 'con@v.local', '{}'::jsonb);
update public.users set role = 'project_director' where id = 'a0000000-0000-4000-8000-000000000244';
update public.users set role = 'contractor'        where id = 'f0000000-0000-4000-8000-000000000244';
-- d… stays visitor (a logged-in person with no role — the would-be client).

insert into public.projects (id, code, name, status) values
  ('11110000-0000-4000-8000-000000000244', 'PRC-244-A', 'Proj A', 'active');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a0000000-0000-4000-8000-000000000244"}';
select lives_ok(
  $$ select public.grant_client_access('d0000000-0000-4000-8000-000000000244', '11110000-0000-4000-8000-000000000244', '2027-12-31'::timestamptz) $$,
  'PD grants a visitor → becomes a client viewer (no token)');
select throws_ok(
  $$ select public.grant_client_access('f0000000-0000-4000-8000-000000000244', '11110000-0000-4000-8000-000000000244', '2027-12-31'::timestamptz) $$,
  'P0001', null, 'grant refuses a contractor target (only visitor/client eligible)');
reset role;

select is(
  (select role from public.users where id = 'd0000000-0000-4000-8000-000000000244'),
  'client'::public.user_role, 'the granted visitor is flipped to client');
select isnt(
  (select id from public.client_portal_access
     where user_id = 'd0000000-0000-4000-8000-000000000244' and project_id = '11110000-0000-4000-8000-000000000244'),
  null, 'an access binding was created for the new client');
select is(
  (select count(*) from public.audit_log
     where action = 'role_change' and target_id = 'd0000000-0000-4000-8000-000000000244'
       and payload->>'via' = 'manual_grant' and payload->>'to' = 'client'),
  1::bigint, 'the manual-grant flip wrote a role_change audit row');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "d0000000-0000-4000-8000-000000000244"}';
select is((select count(*) from public.projects)::bigint, 1::bigint,
  'the new client sees the granted project');
reset role;

select * from finish();
rollback;
