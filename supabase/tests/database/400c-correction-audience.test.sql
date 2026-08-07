begin;
select plan(34);

-- ============================================================================
-- Spec 400 U6c — widen the attendance-CORRECTION audience to the attendance-AUDIT
-- audience. Operator, 2026-08-07: "let's enable them first, we trust the current
-- team. we can limit access in the future."
--
-- U6b shipped the doors into the fix screen and had to withhold them from five
-- roles that READ the grid but that every correction RPC refuses with 42501
-- (accounting 3 users, project_director 3, project_manager 1, hr 0,
-- project_coordinator 0). This unit removes that asymmetry: if you can see the
-- hole, you can fix it.
--
-- ⚠️ THE ALLOWLIST IS THE EASY HALF. Three things had to move together, and each
-- was found by reading the LIVE bodies rather than the plan:
--
--   ① SCOPING. `can_see_project` falls to `else false` for `accounting` and `hr`,
--      so widening the role list ALONE lands them a link and then a 42501 — the
--      affordance-then-refuse defect U3a paid for, re-shipped by the very unit
--      that exists to remove one. The scoping arm now mirrors the READ side's own
--      tiering verbatim (`ATTENDANCE_AUDIT_ALL_PROJECT_ROLES` — the same seven
--      roles `audit_attendance_summary` treats as cross-project), so `project_
--      manager` stays scoped by membership and so does `site_admin`.
--   ② THE ARM SPLIT IN `muster_scan_in`. `v_role = 'procurement'` is not a
--      scoping check — it selects the CORRECTION arm: regular-only (an OT session
--      is x1.5 money), open-days-only behind derive's own advisory key, and the
--      `muster_correction_scan_in` audit row U5's trail reads. Widening the
--      allowlist without extending that predicate would have routed the new roles
--      down the SA COCKPIT arm instead: free to create OT sessions, free to write
--      into a closed day, and INVISIBLE to the correction trail. More power and
--      less accountability than the role it was copying.
--   ③ `close_muster_day` performs `derive_muster_labor_INTERNAL` (verified live),
--      not the public wrapper, so U3a's third gate is already bypassed and no
--      further widening is owed. Had it called the public one, accounting would
--      have died at a third gate.
--
-- ⚖️ hr and project_coordinator have ZERO users today, so this grants them a
-- money-writing capability (closing a day derives wages) that nobody holds. Taken
-- deliberately: ONE rule ("the audit audience may correct") is maintainable, and a
-- subset with two unexplained exclusions is not. Narrowing later is one line.
-- ============================================================================

-- ── Fixture ────────────────────────────────────────────────────────────────
insert into public.projects (id, code, name) values
  ('a1000000-0419-4444-4444-000000000001', 'TAP-419A', 'โครงการเอ'),
  ('a1000000-0419-4444-4444-000000000002', 'TAP-419B', 'โครงการบี');

-- `public.users.id` FKs to `auth.users`, and a trigger on that insert creates the
-- public row as `visitor` — so the role is set by UPDATE afterwards, the same
-- idiom 400b uses.
insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0419-4444-4444-00000000000a', 'acct@s419.local',  '{}'::jsonb),
  ('70000000-0419-4444-4444-00000000000b', 'hr@s419.local',    '{}'::jsonb),
  ('70000000-0419-4444-4444-00000000000c', 'pd@s419.local',    '{}'::jsonb),
  ('70000000-0419-4444-4444-00000000000d', 'pc@s419.local',    '{}'::jsonb),
  ('70000000-0419-4444-4444-00000000000e', 'pm@s419.local',    '{}'::jsonb),
  ('70000000-0419-4444-4444-00000000000f', 'sa@s419.local',    '{}'::jsonb),
  ('70000000-0419-4444-4444-000000000010', 'tech@s419.local',  '{}'::jsonb),
  ('70000000-0419-4444-4444-000000000011', 'super@s419.local', '{}'::jsonb);
update public.users set role = 'accounting'          where id = '70000000-0419-4444-4444-00000000000a';
update public.users set role = 'hr'                  where id = '70000000-0419-4444-4444-00000000000b';
update public.users set role = 'project_director'    where id = '70000000-0419-4444-4444-00000000000c';
update public.users set role = 'project_coordinator' where id = '70000000-0419-4444-4444-00000000000d';
update public.users set role = 'project_manager'     where id = '70000000-0419-4444-4444-00000000000e';
update public.users set role = 'site_admin'          where id = '70000000-0419-4444-4444-00000000000f';
update public.users set role = 'technician'          where id = '70000000-0419-4444-4444-000000000010';
update public.users set role = 'super_admin'         where id = '70000000-0419-4444-4444-000000000011';

-- The PM and the SA are members of project A ONLY. That is what makes the scoping
-- assertions below real: project B is the project they may not touch.
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0419-4444-4444-000000000001', '70000000-0419-4444-4444-00000000000e',
   '70000000-0419-4444-4444-000000000011'),
  ('a1000000-0419-4444-4444-000000000001', '70000000-0419-4444-4444-00000000000f',
   '70000000-0419-4444-4444-000000000011');

insert into public.workers (id, name, created_by, active, project_id) values
  ('e1000000-0419-4444-4444-000000000001', 'ช่างหนึ่ง', '70000000-0419-4444-4444-000000000011',
   true, 'a1000000-0419-4444-4444-000000000001'),
  ('e1000000-0419-4444-4444-000000000002', 'ช่างสอง', '70000000-0419-4444-4444-000000000011',
   true, 'a1000000-0419-4444-4444-000000000001'),
  ('e1000000-0419-4444-4444-000000000003', 'ช่างสาม', '70000000-0419-4444-4444-000000000011',
   true, 'a1000000-0419-4444-4444-000000000002');

-- Project A: an OPEN past day (the correctable one) and a CLOSED past day.
insert into public.muster_teams (id, project_id, work_date, lead_worker_id, kind, created_by) values
  ('71000000-0419-4444-4444-000000000001', 'a1000000-0419-4444-4444-000000000001',
   '2026-07-20', 'e1000000-0419-4444-4444-000000000001', 'crew',
   '70000000-0419-4444-4444-000000000011'),
  ('71000000-0419-4444-4444-000000000002', 'a1000000-0419-4444-4444-000000000001',
   '2026-07-21', 'e1000000-0419-4444-4444-000000000001', 'crew',
   '70000000-0419-4444-4444-000000000011'),
  -- Project B, the one the PM and SA are NOT members of.
  ('71000000-0419-4444-4444-000000000003', 'a1000000-0419-4444-4444-000000000002',
   '2026-07-20', 'e1000000-0419-4444-4444-000000000003', 'crew',
   '70000000-0419-4444-4444-000000000011');

-- One existing session per team, so retime has something to move.
insert into public.muster_attendance
  (team_id, worker_id, work_date, session, in_method, in_at, scanned_by) values
  ('71000000-0419-4444-4444-000000000001', 'e1000000-0419-4444-4444-000000000001',
   '2026-07-20', 'regular', 'qr', '2026-07-20 08:00+07',
   '70000000-0419-4444-4444-000000000011'),
  ('71000000-0419-4444-4444-000000000002', 'e1000000-0419-4444-4444-000000000001',
   '2026-07-21', 'regular', 'qr', '2026-07-21 08:00+07',
   '70000000-0419-4444-4444-000000000011'),
  ('71000000-0419-4444-4444-000000000003', 'e1000000-0419-4444-4444-000000000003',
   '2026-07-20', 'regular', 'qr', '2026-07-20 08:00+07',
   '70000000-0419-4444-4444-000000000011');

-- 2026-07-21 on project A is CLOSED, so the closed-day arm has a real subject.
insert into public.muster_day_closures (project_id, work_date, closed_by) values
  ('a1000000-0419-4444-4444-000000000001', '2026-07-21',
   '70000000-0419-4444-4444-000000000011');

-- ⚠️ The RUNNER creates `_tap_buf` (it rewrites every assertion select into an
-- insert against it), so this file must NOT create it — doing so dies
-- `42P07 relation "_tap_buf" already exists` under `pnpm db:test` while passing
-- fine on a standalone `db query`. Only the GRANTS belong here, and they are
-- required because the assertions below run under `set local role authenticated`.
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. The widened allowlist, driven BEHAVIOURALLY per role. U3a's lesson: a role
--    list read off a body cannot see a gate one layer down, and only a real call
--    reports the SQLSTATE of the layer that actually refused.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000a"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0419-4444-4444-000000000001'::uuid,
      'e1000000-0419-4444-4444-000000000001'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:15+07'::timestamptz, null)$$,
  'accounting may correct a session (the 3-user role U6b had to withhold from)');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000c"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0419-4444-4444-000000000001'::uuid,
      'e1000000-0419-4444-4444-000000000001'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:16+07'::timestamptz, null)$$,
  'project_director may correct a session');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000b"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0419-4444-4444-000000000001'::uuid,
      'e1000000-0419-4444-4444-000000000001'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:17+07'::timestamptz, null)$$,
  'hr may correct a session (0 users today — the grant is deliberate, see header)');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000d"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0419-4444-4444-000000000001'::uuid,
      'e1000000-0419-4444-4444-000000000001'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:18+07'::timestamptz, null)$$,
  'project_coordinator may correct a session');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000e"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0419-4444-4444-000000000001'::uuid,
      'e1000000-0419-4444-4444-000000000001'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:19+07'::timestamptz, null)$$,
  'project_manager may correct a session ON A PROJECT IT IS A MEMBER OF');
reset role;

-- …and the roles nobody widened stay out. A negative per TIER, not a hand-list:
-- technician is field-tier, and it is the role most likely to be handed a wider
-- surface by accident.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-000000000010"}';
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0419-4444-4444-000000000001'::uuid,
      'e1000000-0419-4444-4444-000000000001'::uuid, 'regular'::public.muster_session,
      '2026-07-20 09:00+07'::timestamptz, null)$$,
  '42501', null, 'technician is still refused outright');
reset role;

-- ============================================================================
-- B. SCOPING — the half the plan did not mention, and the half that would have
--    shipped an affordance-then-refuse. The write tiering must mirror the READ's.
-- ============================================================================
-- accounting has NO project membership and can_see_project is `else false` for it,
-- so this call proves the cross-project exemption, not a membership.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000a"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0419-4444-4444-000000000003'::uuid,
      'e1000000-0419-4444-4444-000000000003'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:30+07'::timestamptz, null)$$,
  'accounting is CROSS-PROJECT — it holds no membership on project B at all');
reset role;

-- project_manager is the one audit role the READ scopes by membership. The WRITE
-- must scope it identically, or the two sides disagree about the same person.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000e"}';
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0419-4444-4444-000000000003'::uuid,
      'e1000000-0419-4444-4444-000000000003'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:31+07'::timestamptz, null)$$,
  '42501', null, 'project_manager is REFUSED on a project it is not a member of');
reset role;

-- The regression guard for this whole unit: site_admin is in the correction
-- allowlists for the cockpit and is NOT in the audit set. A scoping rewrite that
-- exempted "everyone but project_manager" would silently make the field role
-- cross-project.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000f"}';
select throws_ok(
  $$select public.muster_scan_in(
      '71000000-0419-4444-4444-000000000003'::uuid,
      'e1000000-0419-4444-4444-000000000002'::uuid, 'manual'::public.muster_method)$$,
  '42501', null, 'site_admin is STILL scoped by membership — not widened by this unit');
reset role;

-- The SAME rewritten scoping arm went into all six functions, so the regression
-- needs more than one subject: `muster_scan_in` above is behavioural, and these two
-- cover the other end of the surface. §E cannot see this class at all — its
-- allowlist oracle only asks whether a role name appears ANYWHERE in the body, and
-- site_admin already appears in four of the allowlists, so moving it into the
-- cross-project list would not change a single expected string.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000f"}';
select throws_ok(
  $$select public.reopen_muster_day(
      'a1000000-0419-4444-4444-000000000002'::uuid, '2026-07-20'::date, 'TAP')$$,
  '42501', 'reopen_muster_day: not a member of this project',
  'site_admin is still scoped on reopen_muster_day too — not just on scan_in');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000e"}';
select throws_ok(
  $$select public.close_muster_day(
      'a1000000-0419-4444-4444-000000000002'::uuid, '2026-07-20'::date)$$,
  '42501', 'close_muster_day: not a member of this project',
  'project_manager is still scoped on close_muster_day — membership, as the READ scopes it');
reset role;

-- ============================================================================
-- C. THE ARM SPLIT. A newly-granted role must land on the CORRECTION arm, not the
--    SA cockpit arm: bounded to regular, refused on a closed day, and AUDITED.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000a"}';
select throws_ok(
  $$select public.muster_scan_in(
      '71000000-0419-4444-4444-000000000001'::uuid,
      'e1000000-0419-4444-4444-000000000002'::uuid, 'manual'::public.muster_method,
      'ot'::public.muster_session)$$,
  -- ⚠️ The MESSAGE is asserted, not just the SQLSTATE. Without the arm extension
  -- accounting falls through to the COCKPIT arm and hits "no regular session on
  -- this team today" — which is ALSO P0001, so a code-only assertion would have
  -- passed against the exact defect this case is named for.
  'P0001', 'muster_scan_in: a correction may only record a regular session',
  'accounting takes the CORRECTION arm: an OT session (x1.5 money) is refused');
select throws_ok(
  $$select public.muster_scan_in(
      '71000000-0419-4444-4444-000000000002'::uuid,
      'e1000000-0419-4444-4444-000000000002'::uuid, 'manual'::public.muster_method)$$,
  'P0001', null,
  'accounting takes the CORRECTION arm: a CLOSED day is refused');
select lives_ok(
  $$select public.muster_scan_in(
      '71000000-0419-4444-4444-000000000001'::uuid,
      'e1000000-0419-4444-4444-000000000002'::uuid, 'manual'::public.muster_method)$$,
  'accounting may add a missing person to an OPEN day');
reset role;

-- …and the add was ATTRIBUTED as a correction, which is what U5's trail reads.
-- Without extending the arm predicate this row would not exist and the edit would
-- be invisible to the only surface that reports after-the-fact changes.
select is(
  (select count(*)::int from public.audit_log
    where action = 'crew_change'
      and payload->>'kind' = 'muster_correction_scan_in'
      and payload->>'worker_id' = 'e1000000-0419-4444-4444-000000000002'
      and actor_role = 'accounting'),
  1, 'the accounting add wrote a muster_correction_scan_in audit row');

-- The SA cockpit arm is UNCHANGED — the deliberate asymmetry, restated as a test
-- so a later "simplify the predicate" cannot quietly bound the live scanner.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000f"}';
select lives_ok(
  $$select public.muster_scan_in(
      '71000000-0419-4444-4444-000000000002'::uuid,
      'e1000000-0419-4444-4444-000000000002'::uuid, 'manual'::public.muster_method)$$,
  'site_admin may still scan into a CLOSED day — the cockpit arm is untouched');
reset role;

select is(
  (select count(*)::int from public.audit_log
    where action = 'crew_change'
      and payload->>'kind' = 'muster_correction_scan_in'
      and actor_role = 'site_admin'),
  0, 'a site_admin cockpit scan is NOT labelled a correction');

-- ============================================================================
-- D. The rest of the correction surface takes the same audience. Each is driven
--    as `accounting`, the role that needed BOTH the allowlist and the scoping.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0419-4444-4444-00000000000a"}';
select lives_ok(
  $$select public.list_muster_teams_for_day(
      'a1000000-0419-4444-4444-000000000001'::uuid, '2026-07-20'::date)$$,
  'accounting may read the day''s teams (the add form''s picker)');
-- ⚠️ The signature is (worker, DATE, session) — NOT (team, worker). Read off the
-- live definition after this call failed: muster_undo_scan keys on the worker-day,
-- because a worker has at most one session per (date, kind) whatever team it is on.
select lives_ok(
  $$select public.muster_undo_scan(
      'e1000000-0419-4444-4444-000000000002'::uuid,
      '2026-07-20'::date, 'regular'::public.muster_session)$$,
  'accounting may delete a session it added');
select lives_ok(
  $$select public.reopen_muster_day(
      'a1000000-0419-4444-4444-000000000001'::uuid, '2026-07-21'::date, 'TAP U6c')$$,
  'accounting may reopen a closed day');
select lives_ok(
  $$select public.close_muster_day(
      'a1000000-0419-4444-4444-000000000001'::uuid, '2026-07-21'::date)$$,
  'accounting may re-close it — and so may book the wages (the money step)');
reset role;

-- close_muster_day performs derive_muster_labor_INTERNAL, so there is no third
-- gate to widen. Pinned, because the public wrapper's own allowlist still excludes
-- accounting: if a later edit re-pointed close at the wrapper, the call above
-- would start failing at a layer nobody widened.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'close_muster_day'
      and pg_get_functiondef(p.oid) ~ 'perform public\.derive_muster_labor_internal'),
  1, 'close_muster_day still calls the INTERNAL derive, so no third gate applies');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'close_muster_day'
      and pg_get_functiondef(p.oid) ~ 'perform public\.derive_muster_labor\('),
  0, '…and does NOT call the public wrapper, whose gate excludes accounting');

-- ============================================================================
-- E. The allowlists as SETS, over the exhaustive role domain. The behavioural
--    cases above prove the arms that matter; these prove nothing ELSE crept in —
--    a hand-written "these must not" list cannot see a role added to the enum.
-- ============================================================================
create function pg_temp._tap_allowed(fn text) returns text language sql stable as $fn$
  select string_agg(r::text, ',' order by r::text)
  from unnest(enum_range(null::public.user_role)) r
  where pg_get_functiondef(('public.' || fn)::regproc) ~ ('''' || r::text || '''')
$fn$;

-- muster_correct_session / list_muster_teams_for_day: EXACTLY the audit set.
select is(pg_temp._tap_allowed('muster_correct_session'),
  'accounting,hr,procurement,procurement_manager,project_coordinator,project_director,project_manager,super_admin',
  'muster_correct_session names exactly the 8 ATTENDANCE_AUDIT_ROLES');
select is(pg_temp._tap_allowed('list_muster_teams_for_day'),
  'accounting,hr,procurement,procurement_manager,project_coordinator,project_director,project_manager,super_admin',
  'list_muster_teams_for_day names exactly the same 8');

-- The four that also carry the cockpit keep site_admin, and ONLY site_admin extra.
select is(pg_temp._tap_allowed('reopen_muster_day'),
  'accounting,hr,procurement,procurement_manager,project_coordinator,project_director,project_manager,site_admin,super_admin',
  'reopen_muster_day = the 8 + site_admin (the cockpit role)');
select is(pg_temp._tap_allowed('close_muster_day'),
  'accounting,hr,procurement,procurement_manager,project_coordinator,project_director,project_manager,site_admin,super_admin',
  'close_muster_day = the 8 + site_admin');
select is(pg_temp._tap_allowed('muster_undo_scan'),
  'accounting,hr,procurement,procurement_manager,project_coordinator,project_director,project_manager,site_admin,super_admin',
  'muster_undo_scan = the 8 + site_admin');
select is(pg_temp._tap_allowed('muster_scan_in'),
  'accounting,hr,procurement,procurement_manager,project_coordinator,project_director,project_manager,site_admin,super_admin',
  'muster_scan_in = the 8 + site_admin');

-- ⚠️ site_owner, auditor, visitor, technician and the rest are absent from every
-- one of the six sets above BY CONSTRUCTION of those equalities — that is what
-- makes them exact-set assertions rather than "contains" ones.

-- ============================================================================
-- F. Posture. These are pre-existing SECURITY DEFINER functions being replaced,
--    so the grants must survive the replace — a `create or replace` that dropped
--    and recreated would silently restore the default anon EXECUTE.
-- ============================================================================
select ok(
  has_function_privilege('authenticated',
    'public.muster_correct_session(uuid,uuid,muster_session,timestamptz,timestamptz)', 'EXECUTE'),
  'authenticated may still execute muster_correct_session');
select ok(
  not has_function_privilege('anon',
    'public.muster_correct_session(uuid,uuid,muster_session,timestamptz,timestamptz)', 'EXECUTE'),
  'anon still may NOT (the default grant stays revoked through the replace)');
select ok(
  not has_function_privilege('anon', 'public.close_muster_day(uuid,date)', 'EXECUTE'),
  'anon still may not execute close_muster_day');
select ok(
  not has_function_privilege('anon', 'public.muster_scan_in(uuid,uuid,muster_method,muster_session)',
    'EXECUTE'),
  'anon still may not execute muster_scan_in');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('muster_correct_session','muster_scan_in','muster_undo_scan',
                        'reopen_muster_day','close_muster_day','list_muster_teams_for_day')
      and p.prosecdef),
  6, 'all six stay SECURITY DEFINER');

select * from finish();
rollback;
