begin;
select plan(21);

-- ============================================================================
-- Spec 130 U1 / ADR 0051 — external partner identity + binding.
-- Pins: catalog/RLS; create_contractor_invite role gate (pm/super only);
-- claim_contractor_invite flow (visitor-only, single-use, unexpired, no
-- rebind) and its effects (binding row, role flip to contractor, invite marked
-- claimed, role_change audit); current_user_contractor_id() helper.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110130', 'pm@portal.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220130', 'sa@portal.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330130', 'v1@portal.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440130', 'v2@portal.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110130';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220130';
-- v1, v2 stay visitor.

insert into public.contractors (id, name, created_by) values
  ('dd000001-0000-4000-8000-000000000130', 'DC One',
   '11111111-1111-1111-1111-111111110130');

-- Invites seeded directly (owner) so the claim tests have known tokens; the
-- create RPC is exercised separately below.
insert into public.contractor_invites (contractor_id, token, created_by, expires_at) values
  ('dd000001-0000-4000-8000-000000000130', 'tokvalidaaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111110130', now() + interval '14 days'),
  ('dd000001-0000-4000-8000-000000000130', 'tokexpiredbbbbbbbbbb',
   '11111111-1111-1111-1111-111111110130', now() - interval '1 day'),
  ('dd000001-0000-4000-8000-000000000130', 'tokotherccccccccccc',
   '11111111-1111-1111-1111-111111110130', now() + interval '14 days');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_table('public', 'contractor_users', 'contractor_users exists');
select has_table('public', 'contractor_invites', 'contractor_invites exists');
select col_is_pk('public', 'contractor_users', 'user_id', 'contractor_users PK is user_id (one binding per user)');
select ok((select relrowsecurity from pg_class where oid = 'public.contractor_users'::regclass),
  'RLS enabled on contractor_users');
select ok((select relrowsecurity from pg_class where oid = 'public.contractor_invites'::regclass),
  'RLS enabled on contractor_invites');

-- ============================================================================
-- B. create_contractor_invite — pm/super only.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220130"}';
select throws_ok(
  $$ select public.create_contractor_invite('dd000001-0000-4000-8000-000000000130') $$,
  '42501', null, 'create_contractor_invite refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330130"}';
select throws_ok(
  $$ select public.create_contractor_invite('dd000001-0000-4000-8000-000000000130') $$,
  '42501', null, 'create_contractor_invite refuses visitor');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110130"}';
select isnt(
  (select public.create_contractor_invite('dd000001-0000-4000-8000-000000000130')),
  null, 'project_manager issues an invite token');
select throws_ok(
  $$ select public.create_contractor_invite('dd000099-0000-4000-8000-000000000099') $$,
  'P0001', null, 'create_contractor_invite refuses an unknown contractor');

-- ============================================================================
-- C. Helper returns NULL for an unbound user.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330130"}';
select is(
  (select public.current_user_contractor_id()),
  null, 'current_user_contractor_id is NULL before binding');

-- ============================================================================
-- D. claim_contractor_invite — guards + effects.
-- ============================================================================
-- v1 (visitor): bad/expired tokens refused (visitor gate passed, token checks fail).
select throws_ok(
  $$ select public.claim_contractor_invite('nope-not-a-token') $$,
  'P0001', null, 'claim refuses an invalid token');
select throws_ok(
  $$ select public.claim_contractor_invite('tokexpiredbbbbbbbbbb') $$,
  'P0001', null, 'claim refuses an expired token');
-- v1 claims the valid token → bound to DC One (single call also asserts the return).
select is(
  (select public.claim_contractor_invite('tokvalidaaaaaaaaaaaa')),
  'dd000001-0000-4000-8000-000000000130'::uuid, 'visitor claims → returns the contractor id');

reset role;
select is(
  (select contractor_id from public.contractor_users where user_id = '33333333-3333-3333-3333-333333330130'),
  'dd000001-0000-4000-8000-000000000130'::uuid, 'binding row created for v1 → DC One');
select is(
  (select role from public.users where id = '33333333-3333-3333-3333-333333330130'),
  'contractor'::public.user_role, 'v1 role flipped visitor → contractor');
select is(
  (select claimed_by from public.contractor_invites where token = 'tokvalidaaaaaaaaaaaa'),
  '33333333-3333-3333-3333-333333330130'::uuid, 'invite marked claimed by v1');
select is(
  (select count(*) from public.audit_log
    where action = 'role_change' and target_id = '33333333-3333-3333-3333-333333330130'
      and payload->>'to' = 'contractor'),
  1::bigint, 'claim wrote a role_change audit row');

-- v1 is now a contractor: helper resolves, and it cannot claim again (rebind).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330130"}';
select is(
  (select public.current_user_contractor_id()),
  'dd000001-0000-4000-8000-000000000130'::uuid, 'helper resolves the bound contractor');
select throws_ok(
  $$ select public.claim_contractor_invite('tokotherccccccccccc') $$,
  '42501', null, 'a bound contractor cannot claim again (visitor-only gate)');

-- v2 (visitor): the already-used token is refused.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440130"}';
select throws_ok(
  $$ select public.claim_contractor_invite('tokvalidaaaaaaaaaaaa') $$,
  'P0001', null, 'a single-use token cannot be claimed twice');

-- site_admin cannot claim (visitor-only gate protects staff accounts).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220130"}';
select throws_ok(
  $$ select public.claim_contractor_invite('tokotherccccccccccc') $$,
  '42501', null, 'a staff account cannot be converted by claiming');

select * from finish();
rollback;
