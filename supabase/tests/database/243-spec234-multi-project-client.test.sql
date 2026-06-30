begin;
select plan(15);

-- ============================================================================
-- Spec 234 / ADR 0067 — multi-project client access. Pins: grant_client_access
-- (PD/super only; target must be an existing client; ON CONFLICT un-revokes;
-- unknown project rejected) and the re-entrant claim_client_invite (a visitor
-- flips role + binds; an existing client just adds a project, no flip; staff
-- still locked out). A client granted A + claiming B sees BOTH projects via the
-- per-project RLS arms (no new arm — spec 233 migration 035000).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000234', 'pd@m.local',  '{}'::jsonb),
  ('b0000000-0000-4000-8000-000000000234', 'pm@m.local',  '{}'::jsonb),
  ('c0000000-0000-4000-8000-000000000234', 'sa@m.local',  '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000234', 'cli@m.local', '{}'::jsonb),
  ('e0000000-0000-4000-8000-000000000234', 'v1@m.local',  '{}'::jsonb),
  ('f0000000-0000-4000-8000-000000000234', 'v2@m.local',  '{}'::jsonb);
update public.users set role = 'project_director' where id = 'a0000000-0000-4000-8000-000000000234';
update public.users set role = 'project_manager'  where id = 'b0000000-0000-4000-8000-000000000234';
update public.users set role = 'site_admin'        where id = 'c0000000-0000-4000-8000-000000000234';
update public.users set role = 'client'            where id = 'd0000000-0000-4000-8000-000000000234';
-- v1, v2 stay visitor.

insert into public.projects (id, code, name, status) values
  ('11110000-0000-4000-8000-000000000234', 'PRC-234-A', 'Proj A', 'active'),
  ('22220000-0000-4000-8000-000000000234', 'PRC-234-B', 'Proj B', 'active');

-- cli already has a REVOKED binding to A — the PD grant below is a re-grant
-- and must un-revoke it (ON CONFLICT DO UPDATE).
insert into public.client_portal_access (user_id, project_id, granted_by, expires_at, revoked_at, revoked_by) values
  ('d0000000-0000-4000-8000-000000000234', '11110000-0000-4000-8000-000000000234',
   'a0000000-0000-4000-8000-000000000234', '2027-12-31 00:00:00+00', now(), 'a0000000-0000-4000-8000-000000000234');

-- Invites: A's token + B's token (SHA-256 of cleartext).
insert into public.client_invites (token_hash, project_id, access_expires_at, created_by, created_at) values
  (encode(extensions.digest('tok234aaaaaaaaaaaaaa', 'sha256'), 'hex'), '11110000-0000-4000-8000-000000000234', '2027-12-31 00:00:00+00', 'a0000000-0000-4000-8000-000000000234', now()),
  (encode(extensions.digest('tok234bbbbbbbbbbbbbb', 'sha256'), 'hex'), '22220000-0000-4000-8000-000000000234', '2027-12-31 00:00:00+00', 'a0000000-0000-4000-8000-000000000234', now());

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. grant_client_access — PD/super only, existing-client target.
-- ============================================================================
select has_function('public', 'grant_client_access', array['uuid', 'uuid', 'timestamptz'],
  'grant_client_access(uuid,uuid,timestamptz) exists');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b0000000-0000-4000-8000-000000000234"}';
select throws_ok(
  $$ select public.grant_client_access('d0000000-0000-4000-8000-000000000234', '11110000-0000-4000-8000-000000000234', '2027-12-31'::timestamptz) $$,
  '42501', null, 'grant_client_access refuses project_manager');

set local "request.jwt.claims" = '{"sub": "a0000000-0000-4000-8000-000000000234"}';
select lives_ok(
  $$ select public.grant_client_access('d0000000-0000-4000-8000-000000000234', '11110000-0000-4000-8000-000000000234', '2027-12-31'::timestamptz) $$,
  'project_director grants an existing client (re-grant on A)');
-- Spec 234 follow-up (mig 039000): grant now accepts a visitor (flips them) OR a
-- client; only STAFF/contractor are ineligible. site_admin (c…) is staff → P0001.
select throws_ok(
  $$ select public.grant_client_access('c0000000-0000-4000-8000-000000000234', '11110000-0000-4000-8000-000000000234', '2027-12-31'::timestamptz) $$,
  'P0001', null, 'grant_client_access refuses a STAFF target (only visitor/client eligible)');
select throws_ok(
  $$ select public.grant_client_access('d0000000-0000-4000-8000-000000000234', '99990000-0000-4000-8000-000000000099', '2027-12-31'::timestamptz) $$,
  'P0001', null, 'grant_client_access refuses an unknown project');
reset role;

select is(
  (select revoked_at from public.client_portal_access
     where user_id = 'd0000000-0000-4000-8000-000000000234' and project_id = '11110000-0000-4000-8000-000000000234'),
  null::timestamptz, 're-grant un-revoked the existing binding');

-- ============================================================================
-- B. claim_client_invite — re-entrant (visitor OR client), staff locked out.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c0000000-0000-4000-8000-000000000234"}';
select throws_ok(
  $$ select public.claim_client_invite('tok234bbbbbbbbbbbbbb') $$,
  '42501', null, 'a site_admin still cannot claim (staff locked out)');

set local "request.jwt.claims" = '{"sub": "d0000000-0000-4000-8000-000000000234"}';
select lives_ok(
  $$ select public.claim_client_invite('tok234bbbbbbbbbbbbbb') $$,
  'an existing client claims a second project (B)');

set local "request.jwt.claims" = '{"sub": "e0000000-0000-4000-8000-000000000234"}';
select lives_ok(
  $$ select public.claim_client_invite('tok234aaaaaaaaaaaaaa') $$,
  'a visitor claims (first bind, A)');
reset role;

select isnt(
  (select id from public.client_portal_access
     where user_id = 'd0000000-0000-4000-8000-000000000234' and project_id = '22220000-0000-4000-8000-000000000234'),
  null, 'client claim added the second-project binding (cli + B)');
select is(
  (select role from public.users where id = 'd0000000-0000-4000-8000-000000000234'),
  'client'::public.user_role, 'an already-client caller is NOT re-flipped');
select is(
  (select count(*) from public.audit_log
     where action = 'other' and payload->>'project_id' = '22220000-0000-4000-8000-000000000234'
       and payload->>'event' = 'client_access_granted' and payload->>'via' = 'client_invite'),
  1::bigint, 'client claim wrote a client_access_granted audit row');
select is(
  (select role from public.users where id = 'e0000000-0000-4000-8000-000000000234'),
  'client'::public.user_role, 'a visitor claim still flips role visitor -> client');
select is(
  (select count(*) from public.audit_log
     where action = 'role_change' and target_id = 'e0000000-0000-4000-8000-000000000234'
       and payload->>'to' = 'client'),
  1::bigint, 'a visitor claim still wrote a role_change audit row');

-- ============================================================================
-- C. multi-project visibility — cli (A re-granted + B claimed) sees BOTH.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "d0000000-0000-4000-8000-000000000234"}';
select is((select count(*) from public.projects)::bigint, 2::bigint,
  'a client with two live grants sees both projects');
reset role;

select * from finish();
rollback;
