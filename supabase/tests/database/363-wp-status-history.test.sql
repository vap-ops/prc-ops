-- Spec 363 U2a — wp_status_history: the ประวัติ timeline's status rows.
--
-- WHY A DEFINER RPC AND NOT A POLICY WIDEN (spec 363 §4.1):
-- audit_log has two SELECT policies. The privileged arm (super_admin,
-- project_director, accounting, project_manager) returns everything; the
-- SITE-STAFF arm (site_admin, procurement, procurement_manager) is an EVENT
-- ALLOWLIST restricted to wp_reopened_for_defect + wp_evidence_resubmitted.
-- `wp_status_transition` — 552 rows in the last 30 days, still being written —
-- is NOT on it, so a site_admin cannot read the backbone of the very tab the
-- unit exists for.
--
-- Adding the event to that allowlist would be WRONG: the site-staff arm has NO
-- project scoping, so it would expose every project's status history to every
-- site admin. The RPC scopes per call instead, and RLS is untouched.

begin;
select plan(22);

-- ---------------------------------------------------------------- fixtures
create temp table t_ids (k text primary key, v uuid not null);

insert into t_ids (k, v)
values
  ('proj_a', gen_random_uuid()),
  ('proj_b', gen_random_uuid()),
  ('wp_a', gen_random_uuid()),
  ('wp_b', gen_random_uuid()),
  ('sa_member', gen_random_uuid()),
  ('sa_outsider', gen_random_uuid()),
  ('visitor', gen_random_uuid()),
  ('super', gen_random_uuid()),
  ('proc', gen_random_uuid()),
  ('pmgr', gen_random_uuid());

-- Helper so the asserts never inline a subselect the acting role cannot read
-- (the spec-330 existence-oracle trap: an unreadable id resolves NULL and the
-- assertion then measures the LOOKUP, not the gate).
create or replace function pg_temp.id(text) returns uuid language sql stable as
$$ select v from t_ids where k = $1 $$;

-- projects.code and project_members.added_by are NOT NULL with no default.
insert into public.projects (id, code, name, status)
values (pg_temp.id('proj_a'), 'U2A-A', 'U2A project A', 'active'),
       (pg_temp.id('proj_b'), 'U2A-B', 'U2A project B', 'active');

insert into public.work_packages (id, project_id, code, name, status)
values (pg_temp.id('wp_a'), pg_temp.id('proj_a'), 'U2A-01', 'งาน A', 'in_progress'),
       (pg_temp.id('wp_b'), pg_temp.id('proj_b'), 'U2A-02', 'งาน B', 'in_progress');

insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, aud, role)
select v, k || '.u2a@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'
  from t_ids where k in ('sa_member', 'sa_outsider', 'visitor', 'super', 'proc', 'pmgr');

update public.users set role = 'site_admin' where id = pg_temp.id('sa_member');
update public.users set role = 'site_admin' where id = pg_temp.id('sa_outsider');
update public.users set role = 'visitor'    where id = pg_temp.id('visitor');
update public.users set role = 'super_admin' where id = pg_temp.id('super');
update public.users set role = 'procurement' where id = pg_temp.id('proc');
update public.users set role = 'procurement_manager' where id = pg_temp.id('pmgr');

-- Only sa_member is on project A.
insert into public.project_members (project_id, user_id, added_by)
values (pg_temp.id('proj_a'), pg_temp.id('sa_member'), pg_temp.id('super'));

-- Two transitions on wp_a, one on wp_b (the cross-project control).
insert into public.audit_log (actor_id, action, target_table, target_id, payload)
values
  (pg_temp.id('sa_member'), 'update', 'work_packages', pg_temp.id('wp_a'),
   '{"event":"wp_status_transition","from_status":"not_started","to_status":"in_progress","is_group":false,"rework_round":0}'::jsonb),
  (pg_temp.id('sa_member'), 'update', 'work_packages', pg_temp.id('wp_a'),
   '{"event":"wp_status_transition","from_status":"in_progress","to_status":"pending_approval","is_group":false,"rework_round":0}'::jsonb),
  (pg_temp.id('super'), 'update', 'work_packages', pg_temp.id('wp_b'),
   '{"event":"wp_status_transition","from_status":"not_started","to_status":"in_progress","is_group":false,"rework_round":0}'::jsonb),
  -- A non-transition event on the same WP: the RPC must not return it.
  (pg_temp.id('sa_member'), 'update', 'work_packages', pg_temp.id('wp_a'),
   '{"event":"wp_deleted"}'::jsonb),
  -- An ALLOWLISTED event: the positive control for the direct-read assert below.
  (pg_temp.id('sa_member'), 'update', 'work_packages', pg_temp.id('wp_a'),
   '{"event":"wp_evidence_resubmitted"}'::jsonb);

-- ---------------------------------------------------------------- existence
select has_function('public', 'wp_status_history', array['uuid'],
  'wp_status_history(uuid) exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wp_status_history'),
  true, 'it is SECURITY DEFINER — the whole point is reading past the allowlist');
select is(
  (select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wp_status_history'),
  's', 'it is STABLE (a read)');
select is(
  (select array_to_string(proconfig, ',') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wp_status_history'),
  'search_path=public', 'search_path is pinned — a DEFINER without it is hijackable');

-- ------------------------------------------------------- grants: no anon/public
-- information_schema.role_routine_grants has NO PUBLIC arm (that lives in
-- routine_privileges) and filters to enabled_roles, so counting it reads 0
-- whether or not PUBLIC holds EXECUTE — it could not fail on the exact
-- default-grant hazard the migration's revoke exists to kill.
-- has_function_privilege resolves PUBLIC through role inheritance.
select is(has_function_privilege('anon', 'public.wp_status_history(uuid)', 'EXECUTE'),
  false, 'anon cannot execute it');
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_name = 'wp_status_history' and grantee = 'authenticated'),
  1, 'executable by authenticated (the gate is inside the body)');

-- ------------------------------------------------------------ the member path
-- The runner rewrites each assertion into `insert into _tap_buf(line) select …`,
-- so once we drop to `authenticated` the assertions themselves need rights on
-- that collector or every one of them 42501s (the documented _tap_buf
-- role-switch trap, same fix as 06-users-rls).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage on sequence _tap_buf_ord_seq to authenticated;
-- Same reason for the id helper's backing table: pg_temp.id() is read by the
-- asserts themselves, so `authenticated` must be able to SELECT it.
grant select on t_ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.id('sa_member'), 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.wp_status_history(pg_temp.id('wp_a'))),
  2, 'a project-member site_admin reads BOTH transitions');
select is(
  (select count(*)::int from public.wp_status_history(pg_temp.id('wp_a'))
    where to_status = 'pending_approval'),
  1, 'the to_status comes through');
-- No ORDER BY in the assert: re-imposing one would make the RPC's own ordering
-- untestable (dropping it from the body would stay green).
select is(
  (select array_agg(from_status) from public.wp_status_history(pg_temp.id('wp_a'))),
  array['not_started', 'in_progress'],
  'from_status comes through, and the RPC returns them oldest-first');
select is(
  (select count(*)::int from public.wp_status_history(pg_temp.id('wp_a'))
    where actor_id = pg_temp.id('sa_member')),
  2, 'the actor comes through so the rail can name who moved it');
select is(
  (select count(*)::int from public.wp_status_history(pg_temp.id('wp_a'))
    where to_status is null or from_status is null),
  0, 'the wp_deleted row is NOT returned — this reads transitions only');

-- ⚠️ THE REGRESSION THIS UNIT EXISTS FOR: prove the SAME caller cannot read the
-- rows directly, i.e. the RPC is the only route and the policy was NOT widened.
select is(
  (select count(*)::int from public.audit_log
    where target_id = pg_temp.id('wp_a')
      and payload->>'event' = 'wp_status_transition'),
  0, 'the site-staff allowlist still HIDES wp_status_transition from a direct read');

-- POSITIVE CONTROL. The 0 above is on its own equally consistent with "the
-- allowlist is intact", "the site-staff SELECT policy was dropped" and "the
-- policy denies everything" — it cannot prove the allowlist is what hides it.
-- An ALLOWED event read by the SAME caller must come back, or the pair proves
-- nothing.
select is(
  (select count(*)::int from public.audit_log
    where target_id = pg_temp.id('wp_a')
      and payload->>'event' = 'wp_evidence_resubmitted'),
  1, '…and the SAME caller DOES read an allowlisted event — so the allowlist is live');

-- --------------------------------------------------------- the non-member path
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.id('sa_outsider'), 'role', 'authenticated')::text, true);

select throws_ok(
  format('select * from public.wp_status_history(%L::uuid)', pg_temp.id('wp_a')),
  '42501',
  null,
  'a site_admin who is not a member of the project is refused');

-- A permitted ROLE on another project must not read across.
select throws_ok(
  format('select * from public.wp_status_history(%L::uuid)', pg_temp.id('wp_b')),
  '42501',
  null,
  'and is refused on the other project too — role alone is never enough');

-- ------------------------------------------------------------- the role gate
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.id('visitor'), 'role', 'authenticated')::text, true);

select throws_ok(
  format('select * from public.wp_status_history(%L::uuid)', pg_temp.id('wp_a')),
  '42501',
  null,
  'a visitor is refused on role, before project membership is considered');

-- NULL role: `null not in (...)` is NULL, which PL/pgSQL treats as not-true, so
-- an unhardened gate silently OPENS for an unbound caller.
select set_config('request.jwt.claims',
  json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);

select throws_ok(
  format('select * from public.wp_status_history(%L::uuid)', pg_temp.id('wp_a')),
  '42501',
  null,
  'a caller with NO users row is refused (the NULL-role coalesce trap)');

-- ⚠️ PLAIN `procurement` IS EXCLUDED ON PURPOSE. It is in WP_DETAIL_ROLES, but
-- can_see_project() falls to `else false` for it — it is a company-wide
-- PR-raising role with no project scoping — so admitting it to the allowlist
-- would create an arm that can never pass. Pinned so the exclusion is a
-- decision on record, not a confusing runtime refusal.
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.id('proc'), 'role', 'authenticated')::text, true);

select throws_ok(
  format('select * from public.wp_status_history(%L::uuid)', pg_temp.id('wp_a')),
  '42501',
  null,
  'plain procurement is refused — can_see_project is structurally false for it');

select is(
  (select public.can_see_project(pg_temp.id('proj_a'))),
  false, '…and that is WHY: can_see_project says false for procurement');

-- procurement_manager is the WIDEST arm admitted here: can_see_project returns
-- true for her unconditionally (spec 348), so this RPC hands her every project's
-- status history. Untested, that breadth is invisible.
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.id('pmgr'), 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.wp_status_history(pg_temp.id('wp_b'))),
  1, 'procurement_manager reads a project she is not a member of (see-all, by design)');

-- --------------------------------------------------------- the privileged path
select set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.id('super'), 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.wp_status_history(pg_temp.id('wp_b'))),
  1, 'super_admin reads a project it is not a member of');
select is(
  (select count(*)::int from public.wp_status_history(pg_temp.id('wp_a'))),
  2, 'and reads project A as well');

reset role;
select * from finish();
rollback;
