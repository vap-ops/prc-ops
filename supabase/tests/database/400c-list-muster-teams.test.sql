begin;
select plan(22);

-- ============================================================================
-- Spec 400 U3c, schema half — the READ that the add-person picker needs.
--
-- U3a widened muster_scan_in to `procurement` and U4 gave the correction a real
-- in_at, so the WRITE is complete. The picker still cannot be built, because the
-- write takes `p_team` and there is no way for four of the five procurement
-- people to learn a team id:
--
--   muster_teams RLS = `can_see_project(project_id)` (read live, one policy)
--   can_see_project  = `else false` for `procurement`
--   ⇒ a team picker on the session client is EMPTY for plain procurement.
--
-- ⭐ THE SEAM IS CHOSEN BY PRECEDENT, NOT BY TASTE. procurement already reads
-- every project's attendance through audit_attendance_summary / _detail —
-- SECURITY DEFINER RPCs — so a definer listing RPC is the seam this exact
-- audience already uses for this exact data. The two alternatives were weighed
-- and rejected: an admin-client (service-role) read moves a real authorization
-- decision out of the database into TS, and widening muster_teams' RLS would
-- widen it for every existing reader that joins the table (spec 400 U2's lesson:
-- a join inherits the WIDER of the two gates).
--
-- Gate and scope are TWO role lists, exactly as in muster_correct_session:
--   gate  = {super_admin, procurement_manager, procurement}   (the correction audience)
--   scope = can_see_project, EXCEPT procurement, which is cross-project
-- site_admin is deliberately absent: she reads muster_teams through RLS already
-- and has no surface here.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0402-0402-0402-000000000009', 'super@s402.local', '{}'::jsonb),
  ('70000000-0402-0402-0402-00000000000c', 'proc@s402.local',  '{}'::jsonb),
  ('70000000-0402-0402-0402-00000000000d', 'sa@s402.local',    '{}'::jsonb),
  ('70000000-0402-0402-0402-00000000000e', 'pmgr@s402.local',  '{}'::jsonb),
  ('70000000-0402-0402-0402-0000000000fe', 'probe@s402.local', '{}'::jsonb);
update public.users set role = 'super_admin'         where id = '70000000-0402-0402-0402-000000000009';
update public.users set role = 'procurement'         where id = '70000000-0402-0402-0402-00000000000c';
update public.users set role = 'site_admin'          where id = '70000000-0402-0402-0402-00000000000d';
update public.users set role = 'procurement_manager' where id = '70000000-0402-0402-0402-00000000000e';

insert into public.projects (id, code, name) values
  ('a1000000-0402-0402-0402-000000000001', 'TAP-402A', 'โครงการเอ');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by)
select id, name, 'daily', 'temporary', 400, true, '70000000-0402-0402-0402-000000000009'
  from (values
    ('e1000000-0402-0402-0402-000000000001'::uuid, 'หัวหน้า หนึ่ง'),
    ('e1000000-0402-0402-0402-000000000002'::uuid, 'หัวหน้า สอง'),
    ('e1000000-0402-0402-0402-000000000003'::uuid, 'ลูกทีม สาม'),
    ('e1000000-0402-0402-0402-000000000004'::uuid, 'ลูกทีม สี่')
  ) as w(id, name);

-- TWO teams on 07-20 and ONE on 07-19. The two-team day is the case that makes a
-- picker necessary rather than an auto-pick: live, a project-day carries 1 team
-- on 7 days and 2–5 on 10, so "if there is only one, skip the picker" would cover
-- 41% and strand the rest.
insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('71000000-0402-0402-0402-000000000010', 'a1000000-0402-0402-0402-000000000001', '2026-07-20',
   'e1000000-0402-0402-0402-000000000001', '70000000-0402-0402-0402-000000000009'),
  ('71000000-0402-0402-0402-000000000011', 'a1000000-0402-0402-0402-000000000001', '2026-07-20',
   'e1000000-0402-0402-0402-000000000002', '70000000-0402-0402-0402-000000000009'),
  ('71000000-0402-0402-0402-000000000012', 'a1000000-0402-0402-0402-000000000001', '2026-07-19',
   'e1000000-0402-0402-0402-000000000001', '70000000-0402-0402-0402-000000000009');

-- An OFFICE team, on its own date so it perturbs no count above. It has NO lead
-- (`muster_teams_crew_has_lead` binds `kind='crew'` only), which is what makes it
-- the LEFT-join fixture: an INNER join would drop it from the picker silently —
-- the exact defect spec 397 U4 fixed inside muster_scan_in, where an inner join
-- turned "they are in the office team" into "somewhere elsewhere". Zero office
-- teams exist in production today, so without this fixture the join could be
-- narrowed with every assertion green.
insert into public.muster_teams (id, project_id, work_date, lead_worker_id, kind, created_by) values
  ('71000000-0402-0402-0402-000000000013', 'a1000000-0402-0402-0402-000000000001', '2026-07-18',
   null, 'office', '70000000-0402-0402-0402-000000000009');

-- Team 10 carries two people, team 11 none. The headcount is what tells a
-- corrector WHICH team to add the missing person to — a picker of two unlabelled
-- uuids is not a choice, it is a coin flip.
insert into public.muster_attendance
  (team_id, worker_id, work_date, session, in_at, in_method, scanned_by)
values
  ('71000000-0402-0402-0402-000000000010', 'e1000000-0402-0402-0402-000000000003',
   '2026-07-20', 'regular', '2026-07-20 08:00+07', 'qr',
   '70000000-0402-0402-0402-000000000009'),
  ('71000000-0402-0402-0402-000000000010', 'e1000000-0402-0402-0402-000000000004',
   '2026-07-20', 'regular', '2026-07-20 08:05+07', 'qr',
   '70000000-0402-0402-0402-000000000009');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Shape and grants. A function is born PUBLIC here — the revoke is the
--    posture, not the absence of a grant.
-- ============================================================================
select has_function('public', 'list_muster_teams_for_day', array['uuid', 'date'],
  'list_muster_teams_for_day(project, date) exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_muster_teams_for_day'),
  true, 'list_muster_teams_for_day is SECURITY DEFINER');
select ok(
  has_function_privilege('authenticated', 'public.list_muster_teams_for_day(uuid,date)', 'EXECUTE'),
  'authenticated may execute list_muster_teams_for_day');
select ok(
  not has_function_privilege('anon', 'public.list_muster_teams_for_day(uuid,date)', 'EXECUTE'),
  'anon may NOT execute list_muster_teams_for_day (default grants revoked)');

-- ============================================================================
-- B. THE POINT OF THE UNIT — plain `procurement` gets rows where the session
--    client gets none. The pair is the assertion: the RLS read must still be
--    empty for that role, or the RPC is not what fixed it.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0402-0402-0402-00000000000c"}';
select is(
  (select count(*)::int from public.muster_teams
    where project_id = 'a1000000-0402-0402-0402-000000000001' and work_date = '2026-07-20'),
  0,
  'CONTROL: procurement reading muster_teams directly still sees NOTHING (can_see_project)');
select is(
  (select count(*)::int from public.list_muster_teams_for_day(
     'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)),
  2,
  'procurement gets both of the day''s teams through the RPC');
select is(
  (select count(*)::int from public.list_muster_teams_for_day(
     'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-19'::date)),
  1,
  'the listing is scoped to the DATE asked for, not the project');
reset role;

-- ============================================================================
-- C. What the picker needs on each row. A list of uuids is not a choice.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0402-0402-0402-00000000000c"}';
select is(
  (select lead_name from public.list_muster_teams_for_day(
     'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)
    where team_id = '71000000-0402-0402-0402-000000000010'),
  'หัวหน้า หนึ่ง',
  'each row names its lead — the label a corrector actually recognises');
select is(
  (select headcount from public.list_muster_teams_for_day(
     'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)
    where team_id = '71000000-0402-0402-0402-000000000010'),
  2,
  'each row carries its headcount, so a two-team day is a choice and not a coin flip');
select is(
  (select headcount from public.list_muster_teams_for_day(
     'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)
    where team_id = '71000000-0402-0402-0402-000000000011'),
  0,
  'an EMPTY team still lists, with headcount 0 — it is a legitimate target');
select is(
  (select kind::text from public.list_muster_teams_for_day(
     'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)
    where team_id = '71000000-0402-0402-0402-000000000010'),
  'crew',
  'each row carries its kind — an office team is a different thing to add someone to');
-- THE LEFT-JOIN PIN. An office team has no lead, so an INNER join to workers
-- would drop it from the picker with every other assertion in this file green.
select is(
  (select count(*)::int from public.list_muster_teams_for_day(
     'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-18'::date)),
  1,
  'a LEAD-LESS office team still lists — LEFT join, not INNER (spec 397 U4''s defect)');
select is(
  (select lead_name from public.list_muster_teams_for_day(
     'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-18'::date)),
  null,
  'and it reports a null lead_name rather than being filtered out');
reset role;

-- ============================================================================
-- D. The gate, driven behaviourally over the role domain. Same audience as
--    muster_correct_session, and site_admin is deliberately outside it.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0402-0402-0402-000000000009"}';
select lives_ok(
  $$select * from public.list_muster_teams_for_day(
      'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)$$,
  'super_admin may list');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0402-0402-0402-00000000000e"}';
select lives_ok(
  $$select * from public.list_muster_teams_for_day(
      'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)$$,
  'procurement_manager may list');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0402-0402-0402-00000000000d"}';
select throws_ok(
  $$select * from public.list_muster_teams_for_day(
      'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', 'list_muster_teams_for_day: role not permitted',
  'site_admin may NOT list here — she reads muster_teams through RLS and has no surface');
reset role;

update public.users set role = 'accounting' where id = '70000000-0402-0402-0402-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0402-0402-0402-0000000000fe"}';
select throws_ok(
  $$select * from public.list_muster_teams_for_day(
      'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', 'list_muster_teams_for_day: role not permitted',
  'accounting is in ATTENDANCE_AUDIT_ROLES and may READ the report — but not this');
reset role;

update public.users set role = 'technician' where id = '70000000-0402-0402-0402-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0402-0402-0402-0000000000fe"}';
select throws_ok(
  $$select * from public.list_muster_teams_for_day(
      'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', 'list_muster_teams_for_day: role not permitted',
  'technician may NOT list');
reset role;

-- The rls-self-check-coalesce trap: `null not in (...)` is NULL, which an IF
-- treats as not-true, so an unbound caller falls THROUGH a naive gate.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0402-0402-0402-000000000000"}';
select throws_ok(
  $$select * from public.list_muster_teams_for_day(
      'a1000000-0402-0402-0402-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', 'list_muster_teams_for_day: role not permitted',
  'an unbound caller (null role) is DENIED — the gate does not fall open');
reset role;

-- ============================================================================
-- E. SCOPE is a SECOND role list, and U3a's lesson is that widening the gate
--    silently widens nothing else: procurement is cross-project by design, and
--    a role that is NOT must still be scoped. procurement_manager passes
--    can_see_project unconditionally (arm 1), so the positive control here is
--    that the cross-project arm is procurement-SPECIFIC rather than a blanket
--    "the gate already decided it".
-- ============================================================================
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_muster_teams_for_day'
      and pg_get_functiondef(p.oid) like '%can_see_project%'),
  1,
  'the body still consults can_see_project — the gate is not the whole story');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_muster_teams_for_day'
      and pg_get_functiondef(p.oid) like '%<> ''procurement''%'),
  1,
  'and the cross-project arm is procurement-specific, not a blanket bypass');

-- A project the caller cannot see returns a REFUSAL, not an empty list: an empty
-- list would read as "that day had no teams", which is a different fact and the
-- one a corrector would act on.
insert into public.projects (id, code, name) values
  ('a2000000-0402-0402-0402-000000000002', 'TAP-402B', 'โครงการบี');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0402-0402-0402-00000000000e"}';
select lives_ok(
  $$select * from public.list_muster_teams_for_day(
      'a2000000-0402-0402-0402-000000000002'::uuid, '2026-07-20'::date)$$,
  'procurement_manager sees every project (can_see_project arm 1) — positive control');
reset role;

select * from finish();
rollback;
