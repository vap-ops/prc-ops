begin;
select plan(25);

-- ============================================================================
-- Spec 254 — client access tier (basic/full, extends spec 233/234 ADR 0067).
-- Pins: client_access_tier enum + tier columns default 'basic'; a full-tier
-- client sees ALL-status photos (defect phase STILL excluded, spec 248) while
-- basic stays complete-only (regression); a full-tier client reads its
-- project's categories (net-new arm), basic does not; create_client_invite's
-- new p_tier defaults 'basic' (old 2-arg call sites keep working) and PD/super
-- gate is unchanged; claim_client_invite propagates invite.tier onto BOTH the
-- fresh-grant insert AND the re-entrant on-conflict-update path (spec 234 D5).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000254', 'pd@tier.local',      '{}'::jsonb),
  ('b0000000-0000-4000-8000-000000000254', 'pm@tier.local',      '{}'::jsonb),
  ('d0000000-0000-4000-8000-000000000254', 'basic@tier.local',   '{}'::jsonb),
  ('e0000000-0000-4000-8000-000000000254', 'full@tier.local',    '{}'::jsonb),
  ('f0000000-0000-4000-8000-000000000254', 'revoked@tier.local', '{}'::jsonb),
  ('c0000000-0000-4000-8000-000000000254', 'visitor@tier.local', '{}'::jsonb);
update public.users set role = 'project_director' where id = 'a0000000-0000-4000-8000-000000000254';
update public.users set role = 'project_manager'  where id = 'b0000000-0000-4000-8000-000000000254';
update public.users set role = 'client'           where id = 'd0000000-0000-4000-8000-000000000254';
update public.users set role = 'client'           where id = 'e0000000-0000-4000-8000-000000000254';
update public.users set role = 'client'           where id = 'f0000000-0000-4000-8000-000000000254';
-- visitor (c…) stays visitor.

-- B and C are throwaway, WP-less projects used ONLY by the section-E
-- create_client_invite tests below — each gets exactly one invite, so the
-- lookup needs no ORDER BY (created_at is frozen to txn-start time for every
-- statement in this test, per Postgres now() semantics — ordering by it
-- across rows inserted in the same transaction is NOT reliable).
insert into public.projects (id, code, name, status) values
  ('11110000-0000-4000-8000-000000000254', 'PRC-254-A', 'Tier Proj A', 'active'),
  ('33330000-0000-4000-8000-000000000254', 'PRC-254-B', 'Tier Proj B (2-arg default test)', 'active'),
  ('44440000-0000-4000-8000-000000000254', 'PRC-254-C', 'Tier Proj C (3-arg explicit test)', 'active');

insert into public.project_categories (id, project_id, code, name, sort_order, created_by) values
  ('22220000-0000-4000-8000-000000000254', '11110000-0000-4000-8000-000000000254', '01', 'งานโครงสร้าง', 1, 'a0000000-0000-4000-8000-000000000254');

insert into public.work_packages (id, project_id, code, name, status, priority) values
  ('aa110000-0000-4000-8000-000000000254', '11110000-0000-4000-8000-000000000254', 'WP-1', 'Complete WP',    'complete',    'normal'),
  ('aa120000-0000-4000-8000-000000000254', '11110000-0000-4000-8000-000000000254', 'WP-2', 'In-progress WP', 'in_progress', 'urgent');

-- storage_path required for a live (non-tombstone) photo_logs row.
insert into public.photo_logs (id, work_package_id, phase, storage_path, uploaded_by) values
  ('cc110000-0000-4000-8000-000000000254', 'aa110000-0000-4000-8000-000000000254', 'after',  'projects/254/complete.jpg', 'b0000000-0000-4000-8000-000000000254'),
  ('cc120000-0000-4000-8000-000000000254', 'aa120000-0000-4000-8000-000000000254', 'during', 'projects/254/progress.jpg', 'b0000000-0000-4000-8000-000000000254'),
  ('cc130000-0000-4000-8000-000000000254', 'aa110000-0000-4000-8000-000000000254', 'defect', 'projects/254/defect.jpg',   'b0000000-0000-4000-8000-000000000254');

-- basic (live, tier default 'basic'); full (live, tier 'full');
-- revoked (revoked despite tier 'full' — revoke must still win).
insert into public.client_portal_access (user_id, project_id, granted_by, expires_at, tier, revoked_at, revoked_by) values
  ('d0000000-0000-4000-8000-000000000254', '11110000-0000-4000-8000-000000000254', 'a0000000-0000-4000-8000-000000000254', now() + interval '30 days', 'basic', null, null),
  ('e0000000-0000-4000-8000-000000000254', '11110000-0000-4000-8000-000000000254', 'a0000000-0000-4000-8000-000000000254', now() + interval '30 days', 'full',  null, null),
  ('f0000000-0000-4000-8000-000000000254', '11110000-0000-4000-8000-000000000254', 'a0000000-0000-4000-8000-000000000254', now() + interval '30 days', 'full',  now(), 'a0000000-0000-4000-8000-000000000254');

-- Two invites for c (visitor): first claim = fresh insert (tier full); second
-- claim = the re-entrant on-conflict path, tier basic — must overwrite.
insert into public.client_invites (token_hash, project_id, access_expires_at, created_by, created_at, tier) values
  (encode(extensions.digest('tokfirstclaimfullaaaaa', 'sha256'), 'hex'), '11110000-0000-4000-8000-000000000254', '2027-06-30 00:00:00+00', 'a0000000-0000-4000-8000-000000000254', now(), 'full'),
  (encode(extensions.digest('tokreclaimbasicbbbbbbb', 'sha256'), 'hex'), '11110000-0000-4000-8000-000000000254', '2027-06-30 00:00:00+00', 'a0000000-0000-4000-8000-000000000254', now(), 'basic');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_type('public', 'client_access_tier', 'client_access_tier enum exists');
select enum_has_labels('public', 'client_access_tier', ARRAY['basic', 'full'], 'tier has exactly basic/full');

-- ============================================================================
-- B. client_has_full_access.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "d0000000-0000-4000-8000-000000000254"}';
select ok(public.client_has_full_access('11110000-0000-4000-8000-000000000254') = false,
  'basic-tier live access -> client_has_full_access false');
set local "request.jwt.claims" = '{"sub": "e0000000-0000-4000-8000-000000000254"}';
select ok(public.client_has_full_access('11110000-0000-4000-8000-000000000254'),
  'full-tier live access -> client_has_full_access true');
set local "request.jwt.claims" = '{"sub": "f0000000-0000-4000-8000-000000000254"}';
select ok(public.client_has_full_access('11110000-0000-4000-8000-000000000254') = false,
  'revoked full-tier access -> client_has_full_access false (revoke wins)');
reset role;

-- ============================================================================
-- C. photo_logs RLS — basic stays complete-only; full sees all statuses;
-- defect phase excluded for BOTH tiers (spec 248, untouched).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "d0000000-0000-4000-8000-000000000254"}';
select is((select count(*) from public.photo_logs)::bigint, 1::bigint,
  'basic-tier client sees only the complete-WP photo (regression)');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "e0000000-0000-4000-8000-000000000254"}';
select is((select count(*) from public.photo_logs)::bigint, 2::bigint,
  'full-tier client sees both non-defect photos (complete + in-progress WPs)');
select is(
  (select count(*) from public.photo_logs where phase = 'defect')::bigint, 0::bigint,
  'full-tier client still cannot see the defect-phase photo');
reset role;

-- ============================================================================
-- D. project_categories RLS — net-new client arm, full-tier only.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "d0000000-0000-4000-8000-000000000254"}';
select is((select count(*) from public.project_categories)::bigint, 0::bigint,
  'basic-tier client cannot read project_categories');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "e0000000-0000-4000-8000-000000000254"}';
select is((select count(*) from public.project_categories)::bigint, 1::bigint,
  'full-tier client reads the project''s category');
select is((select name from public.project_categories), 'งานโครงสร้าง',
  'full-tier client reads the correct category name');
reset role;

-- ============================================================================
-- E. create_client_invite — p_tier defaults 'basic' (old 2-arg calls keep
-- working); PD/super gate unchanged; explicit p_tier='full' is stored.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b0000000-0000-4000-8000-000000000254"}';
select throws_ok(
  $$ select public.create_client_invite('11110000-0000-4000-8000-000000000254', now() + interval '30 days') $$,
  '42501', null, 'create_client_invite (2-arg) still refuses project_manager');

set local "request.jwt.claims" = '{"sub": "a0000000-0000-4000-8000-000000000254"}';
select lives_ok(
  $$ select public.create_client_invite('33330000-0000-4000-8000-000000000254', now() + interval '30 days') $$,
  'PD issues an invite with the old 2-arg call (p_tier omitted)');
select is(
  (select tier from public.client_invites where project_id = '33330000-0000-4000-8000-000000000254'),
  'basic'::public.client_access_tier, 'the 2-arg invite defaults tier to basic');

select lives_ok(
  $$ select public.create_client_invite('44440000-0000-4000-8000-000000000254', now() + interval '30 days', 'full') $$,
  'PD issues a full-tier invite (3-arg)');
select is(
  (select tier from public.client_invites where project_id = '44440000-0000-4000-8000-000000000254'),
  'full'::public.client_access_tier, 'the 3-arg invite stores tier=full');
reset role;

-- ============================================================================
-- F. claim_client_invite — fresh-grant insert inherits invite.tier; the
-- re-entrant on-conflict path (spec 234 D5) OVERWRITES tier, not just skips.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c0000000-0000-4000-8000-000000000254"}';
select lives_ok(
  $$ select public.claim_client_invite('tokfirstclaimfullaaaaa') $$,
  'visitor claims the first (full-tier) invite token — fresh insert');
reset role;
select is(
  (select tier from public.client_portal_access
     where user_id = 'c0000000-0000-4000-8000-000000000254' and project_id = '11110000-0000-4000-8000-000000000254'),
  'full'::public.client_access_tier, 'fresh-grant access row inherits tier=full from the invite');

set local role authenticated;
-- c is now role 'client' (flipped on the first claim) — the client branch of
-- the visitor/client gate, re-claiming for the SAME project triggers the
-- on-conflict UPDATE path (unique (user_id, project_id)).
set local "request.jwt.claims" = '{"sub": "c0000000-0000-4000-8000-000000000254"}';
select lives_ok(
  $$ select public.claim_client_invite('tokreclaimbasicbbbbbbb') $$,
  'the already-client g re-claims a second (basic-tier) invite for the same project');
reset role;
select is(
  (select tier from public.client_portal_access
     where user_id = 'c0000000-0000-4000-8000-000000000254' and project_id = '11110000-0000-4000-8000-000000000254'),
  'basic'::public.client_access_tier, 're-entrant claim OVERWRITES tier full -> basic (not stuck)');

-- ============================================================================
-- G. set_client_access_tier — PD/super only; upgrades an existing binding
-- without a re-invite (D2); refuses an unknown/revoked access id.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b0000000-0000-4000-8000-000000000254"}';
select throws_ok(
  $$ select public.set_client_access_tier(
       (select id from public.client_portal_access
          where user_id = 'd0000000-0000-4000-8000-000000000254' and project_id = '11110000-0000-4000-8000-000000000254'),
       'full') $$,
  '42501', null, 'set_client_access_tier refuses project_manager');

set local "request.jwt.claims" = '{"sub": "a0000000-0000-4000-8000-000000000254"}';
select lives_ok(
  $$ select public.set_client_access_tier(
       (select id from public.client_portal_access
          where user_id = 'd0000000-0000-4000-8000-000000000254' and project_id = '11110000-0000-4000-8000-000000000254'),
       'full') $$,
  'PD upgrades the basic binding to full, no re-invite');
select throws_ok(
  $$ select public.set_client_access_tier(
       (select id from public.client_portal_access
          where user_id = 'f0000000-0000-4000-8000-000000000254' and project_id = '11110000-0000-4000-8000-000000000254'),
       'full') $$,
  'P0001', null, 'set_client_access_tier refuses an already-revoked binding');
reset role;
select is(
  (select tier from public.client_portal_access
     where user_id = 'd0000000-0000-4000-8000-000000000254' and project_id = '11110000-0000-4000-8000-000000000254'),
  'full'::public.client_access_tier, 'the upgraded binding now reads tier=full');
select is(
  (select count(*) from public.audit_log
     where action = 'other' and payload->>'event' = 'client_access_tier_changed'
       and target_id = (select id from public.client_portal_access
                           where user_id = 'd0000000-0000-4000-8000-000000000254' and project_id = '11110000-0000-4000-8000-000000000254'))::bigint,
  1::bigint, 'the tier change wrote an audit row');

select * from finish();
rollback;
