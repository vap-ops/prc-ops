begin;
select plan(34);

-- ============================================================================
-- Spec 233 / ADR 0067 — temporary scoped read-only client progress portal.
-- Pins: client_portal_access + client_invites catalog/RLS; client_has_live_access
-- (live / revoked / expired); dedicated client read arms scope projects /
-- work_packages / complete-WP photos / completed reports to the one live project
-- and NOTHING else (no money table has a client arm); create/revoke gated to
-- project_director + super_admin (NOT pm); claim visitor-only, single-use,
-- ≤14-day, with role flip + access row + audit. Token hashing mirrors
-- create_contractor_invite (SHA-256 of cleartext; mig 20260813024000).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000233', 'pd@client.local',  '{}'::jsonb),
  ('b0000000-0000-4000-8000-000000000233', 'pm@client.local',  '{}'::jsonb),
  ('c0000000-0000-4000-8000-000000000233', 'sup@client.local', '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000233', 'cli@client.local', '{}'::jsonb),
  ('e0000000-0000-4000-8000-000000000233', 'vc@client.local',  '{}'::jsonb),
  ('f0000000-0000-4000-8000-000000000233', 'v2@client.local',  '{}'::jsonb);
update public.users set role = 'project_director' where id = 'a0000000-0000-4000-8000-000000000233';
update public.users set role = 'project_manager'  where id = 'b0000000-0000-4000-8000-000000000233';
update public.users set role = 'super_admin'       where id = 'c0000000-0000-4000-8000-000000000233';
update public.users set role = 'client'            where id = 'd0000000-0000-4000-8000-000000000233';
-- vc (e…) + v2 (f…) stay visitor.

insert into public.projects (id, code, name, status) values
  ('11110000-0000-4000-8000-000000000233', 'PRC-233-A', 'Client Proj A (live)',    'active'),
  ('22220000-0000-4000-8000-000000000233', 'PRC-233-B', 'Client Proj B (revoked)', 'active'),
  ('33330000-0000-4000-8000-000000000233', 'PRC-233-C', 'Client Proj C (expired)', 'active'),
  ('44440000-0000-4000-8000-000000000233', 'PRC-233-D', 'Client Proj D (none)',    'active');

insert into public.work_packages (id, project_id, code, name, status, priority) values
  ('aa110000-0000-4000-8000-000000000233', '11110000-0000-4000-8000-000000000233', 'WP-A1', 'A complete', 'complete',    'normal'),
  ('aa120000-0000-4000-8000-000000000233', '11110000-0000-4000-8000-000000000233', 'WP-A2', 'A progress', 'in_progress', 'normal'),
  ('bb110000-0000-4000-8000-000000000233', '22220000-0000-4000-8000-000000000233', 'WP-B1', 'B complete', 'complete',    'normal');

-- storage_path required for a live (non-tombstone) photo_logs row (ADR 0015
-- well-formedness CHECK: path xor superseded_by).
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('cc110000-0000-4000-8000-000000000233', 'aa110000-0000-4000-8000-000000000233', 'after',  'projects/233/a-complete.jpg', 'b0000000-0000-4000-8000-000000000233'),
  ('cc120000-0000-4000-8000-000000000233', 'aa120000-0000-4000-8000-000000000233', 'during', 'projects/233/a-progress.jpg', 'b0000000-0000-4000-8000-000000000233'),
  ('cc130000-0000-4000-8000-000000000233', 'bb110000-0000-4000-8000-000000000233', 'after',  'projects/233/b-complete.jpg', 'b0000000-0000-4000-8000-000000000233');

insert into public.reports (id, project_id, status, requested_by, params) values
  ('dd110000-0000-4000-8000-000000000233', '11110000-0000-4000-8000-000000000233', 'complete',   'b0000000-0000-4000-8000-000000000233', '{}'::jsonb),
  ('dd120000-0000-4000-8000-000000000233', '11110000-0000-4000-8000-000000000233', 'processing', 'b0000000-0000-4000-8000-000000000233', '{}'::jsonb),
  ('dd130000-0000-4000-8000-000000000233', '22220000-0000-4000-8000-000000000233', 'complete',   'b0000000-0000-4000-8000-000000000233', '{}'::jsonb);

-- clientDir bindings: live (A), revoked (B), expired (C). None for D.
insert into public.client_portal_access (user_id, project_id, granted_by, expires_at, revoked_at, revoked_by) values
  ('d0000000-0000-4000-8000-000000000233', '11110000-0000-4000-8000-000000000233', 'a0000000-0000-4000-8000-000000000233', now() + interval '30 days', null, null),
  ('d0000000-0000-4000-8000-000000000233', '22220000-0000-4000-8000-000000000233', 'a0000000-0000-4000-8000-000000000233', now() + interval '30 days', now(), 'a0000000-0000-4000-8000-000000000233'),
  ('d0000000-0000-4000-8000-000000000233', '33330000-0000-4000-8000-000000000233', 'a0000000-0000-4000-8000-000000000233', now() - interval '1 day',   null, null);

-- Invites (token_hash = SHA-256 of cleartext, like the contractor harness).
insert into public.client_invites (token_hash, project_id, access_expires_at, created_by, created_at, claimed_by, claimed_at) values
  (encode(extensions.digest('tokclientvalidaaaaaaaa', 'sha256'), 'hex'), '11110000-0000-4000-8000-000000000233', '2027-06-30 00:00:00+00', 'a0000000-0000-4000-8000-000000000233', now(),                    null,                                       null),
  (encode(extensions.digest('tokclientexpiredbbbbbb', 'sha256'), 'hex'), '11110000-0000-4000-8000-000000000233', '2027-06-30 00:00:00+00', 'a0000000-0000-4000-8000-000000000233', now() - interval '15 days', null,                                       null),
  (encode(extensions.digest('tokclientusedccccccccc', 'sha256'), 'hex'), '11110000-0000-4000-8000-000000000233', '2027-06-30 00:00:00+00', 'a0000000-0000-4000-8000-000000000233', now(),                    'f0000000-0000-4000-8000-000000000233', now());

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + RLS posture.
-- ============================================================================
select has_table('public', 'client_portal_access', 'client_portal_access exists');
select has_table('public', 'client_invites', 'client_invites exists');
select ok((select relrowsecurity from pg_class where oid = 'public.client_portal_access'::regclass),
  'RLS enabled on client_portal_access');
select ok((select relrowsecurity from pg_class where oid = 'public.client_invites'::regclass),
  'RLS enabled on client_invites');

-- ============================================================================
-- B. Privileges — anon blocked; direct writes blocked (RPC-only).
-- ============================================================================
select ok(has_table_privilege('anon', 'public.client_portal_access', 'SELECT') = false,
  'anon cannot SELECT client_portal_access');
select ok(has_table_privilege('anon', 'public.client_invites', 'SELECT') = false,
  'anon cannot SELECT client_invites');
select ok(has_table_privilege('authenticated', 'public.client_invites', 'INSERT') = false,
  'authenticated cannot INSERT client_invites directly (writes go through the RPC)');

-- ============================================================================
-- C. Money no-leak — client read arms exist ONLY on the four read surfaces;
-- no money table carries a client arm.
-- ============================================================================
select is(
  (select count(distinct tablename) from pg_policies
    where schemaname = 'public'
      and tablename in ('projects', 'work_packages', 'photo_logs', 'reports')
      and qual ilike '%''client''%'),
  4::bigint, 'all four read surfaces carry a dedicated client read arm');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'wp_labor_costs' and qual ilike '%''client''%'),
  0::bigint, 'no client read arm on the wp_labor_costs money table');

-- ============================================================================
-- D. client_has_live_access — live / revoked / expired (as clientDir).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "d0000000-0000-4000-8000-000000000233"}';
select ok(public.client_has_live_access('11110000-0000-4000-8000-000000000233'),
  'live access → true (A)');
select ok(public.client_has_live_access('22220000-0000-4000-8000-000000000233') = false,
  'revoked access → false (B)');
select ok(public.client_has_live_access('33330000-0000-4000-8000-000000000233') = false,
  'expired access → false (C)');

-- ============================================================================
-- E. RLS visibility — clientDir sees ONLY the one live project's safe rows.
-- ============================================================================
select is((select count(*) from public.projects)::bigint, 1::bigint,
  'client sees exactly one project (the live one)');
select is((select id from public.projects), '11110000-0000-4000-8000-000000000233'::uuid,
  'the one visible project is the live project A');
select is((select count(*) from public.work_packages)::bigint, 2::bigint,
  'client sees only project A work packages (2)');
select is((select count(*) from public.photo_logs)::bigint, 1::bigint,
  'client sees only the complete-WP photo in project A (1)');
select is((select count(*) from public.reports)::bigint, 1::bigint,
  'client sees only the completed report in project A (1)');
reset role;

-- ============================================================================
-- F. create_client_invite — PD/super only, NOT pm.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b0000000-0000-4000-8000-000000000233"}';
select throws_ok(
  $$ select public.create_client_invite('11110000-0000-4000-8000-000000000233', now() + interval '30 days') $$,
  '42501', null, 'create_client_invite refuses project_manager');
set local "request.jwt.claims" = '{"sub": "a0000000-0000-4000-8000-000000000233"}';
select isnt(
  (select public.create_client_invite('11110000-0000-4000-8000-000000000233', now() + interval '30 days')),
  null, 'project_director issues a client invite token');
select throws_ok(
  $$ select public.create_client_invite('99990000-0000-4000-8000-000000000099', now() + interval '30 days') $$,
  'P0001', null, 'create_client_invite refuses an unknown project');

-- ============================================================================
-- G. claim_client_invite — visitor-only, single-use, unexpired.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "b0000000-0000-4000-8000-000000000233"}';
select throws_ok(
  $$ select public.claim_client_invite('tokclientvalidaaaaaaaa') $$,
  '42501', null, 'a staff (pm) account cannot claim (visitor-only gate)');
set local "request.jwt.claims" = '{"sub": "f0000000-0000-4000-8000-000000000233"}';
select throws_ok(
  $$ select public.claim_client_invite('nope-not-a-token') $$,
  'P0001', null, 'claim refuses an invalid token');
select throws_ok(
  $$ select public.claim_client_invite('tokclientexpiredbbbbbb') $$,
  'P0001', null, 'claim refuses a >14-day-old token');
select throws_ok(
  $$ select public.claim_client_invite('tokclientusedccccccccc') $$,
  'P0001', null, 'claim refuses an already-used token');

-- vc (visitor) claims the valid token.
set local "request.jwt.claims" = '{"sub": "e0000000-0000-4000-8000-000000000233"}';
select lives_ok(
  $$ select public.claim_client_invite('tokclientvalidaaaaaaaa') $$,
  'a visitor claims the valid token');
reset role;

-- ============================================================================
-- H. claim effects.
-- ============================================================================
select is(
  (select role from public.users where id = 'e0000000-0000-4000-8000-000000000233'),
  'client'::public.user_role, 'claim flipped vc role visitor → client');
select is(
  (select expires_at from public.client_portal_access
     where user_id = 'e0000000-0000-4000-8000-000000000233' and project_id = '11110000-0000-4000-8000-000000000233'),
  '2027-06-30 00:00:00+00'::timestamptz, 'access row stamped with the invite access_expires_at');
select is(
  (select granted_by from public.client_portal_access
     where user_id = 'e0000000-0000-4000-8000-000000000233' and project_id = '11110000-0000-4000-8000-000000000233'),
  'a0000000-0000-4000-8000-000000000233'::uuid, 'access granted_by = the invite creator (PD)');
select is(
  (select claimed_by from public.client_invites
     where token_hash = encode(extensions.digest('tokclientvalidaaaaaaaa', 'sha256'), 'hex')),
  'e0000000-0000-4000-8000-000000000233'::uuid, 'invite marked claimed by vc');
select is(
  (select count(*) from public.audit_log
     where action = 'role_change' and target_id = 'e0000000-0000-4000-8000-000000000233'
       and payload->>'to' = 'client'),
  1::bigint, 'claim wrote a role_change audit row');

-- ============================================================================
-- I. revoke_client_access — PD/super only; stamps revoked_at/by.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b0000000-0000-4000-8000-000000000233"}';
select throws_ok(
  $$ select public.revoke_client_access(
       (select id from public.client_portal_access
          where user_id = 'e0000000-0000-4000-8000-000000000233' and project_id = '11110000-0000-4000-8000-000000000233')) $$,
  '42501', null, 'revoke_client_access refuses project_manager');
set local "request.jwt.claims" = '{"sub": "a0000000-0000-4000-8000-000000000233"}';
select lives_ok(
  $$ select public.revoke_client_access(
       (select id from public.client_portal_access
          where user_id = 'e0000000-0000-4000-8000-000000000233' and project_id = '11110000-0000-4000-8000-000000000233')) $$,
  'project_director revokes the access');
reset role;
select isnt(
  (select revoked_at from public.client_portal_access
     where user_id = 'e0000000-0000-4000-8000-000000000233' and project_id = '11110000-0000-4000-8000-000000000233'),
  null, 'revoked_at stamped');
select is(
  (select revoked_by from public.client_portal_access
     where user_id = 'e0000000-0000-4000-8000-000000000233' and project_id = '11110000-0000-4000-8000-000000000233'),
  'a0000000-0000-4000-8000-000000000233'::uuid, 'revoked_by = the revoking PD');

select * from finish();
rollback;
