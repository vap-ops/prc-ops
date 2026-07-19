begin;
select plan(21);

-- ============================================================================
-- Spec 330 U3a — the spec-328 §2.4 contractor money wall, enforced in the DB.
--
-- WHY: a contractor-tied worker (workers.contractor_id not null) is pay-exempt
-- — the firm pays them, PRC never does. Until U3a the wall was THREE UI query
-- filters and nothing in Postgres (tests/unit/contractor-money-wall.test.ts
-- says so). Spec 330 U2 opened the FIRST write path into crew_members, and the
-- /sa/plan DRAFT reads crews + crew_members UNFILTERED (only the manual picker
-- is filtered) → planned crew → set_daily_plan_item_crew → mark-present →
-- log_labor_day → labor_logs → payroll + the wp_labor_costs DC column. So one
-- crew row becomes real baht PRC does not owe, plus a DC double-count against
-- a WP whose contract price already includes that labour.
--
-- TWO LAYERS, both asserted here:
--   L1 function arms (friendly 22023) on every writer — add / move /
--      create_crew / set_crew_lead / reassign_crew_lead;
--   L2 TRIGGERS on crew_members, crews, workers — writer-agnostic, so a
--      future RPC or a direct write cannot reopen the wall.
-- Message text is PINNED on the lead asserts: without it, "cannot be made
-- lead" passes off set_crew_lead's unrelated membership guard and stays green
-- with the wall entirely absent (caught in review of the first draft).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0331-0331-0331-700000000331', 'pm@s331.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '70000000-0331-0331-0331-700000000331';

insert into public.projects (id, code, name) values
  ('a1000000-0331-0331-0331-a10000000331', 'TAP-331A', 'โครงการทดสอบกำแพงเงิน');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0331-0331-0331-a10000000331', '70000000-0331-0331-0331-700000000331',
   '70000000-0331-0331-0331-700000000331');

insert into public.contractors (id, name, created_by) values
  ('f1000000-0331-0331-0331-f10000000331', 'ทีมผู้รับเหมาทดสอบ',
   '70000000-0331-0331-0331-700000000331');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, project_id, contractor_id, created_by) values
  ('e1000000-0331-0331-0331-e10000000331', 'ช่างบริษัท', 'daily', 'temporary', 400, true,
   'a1000000-0331-0331-0331-a10000000331', null, '70000000-0331-0331-0331-700000000331'),
  ('e2000000-0331-0331-0331-e20000000331', 'ช่างผู้รับเหมา', 'daily', 'temporary', 0, true,
   'a1000000-0331-0331-0331-a10000000331', 'f1000000-0331-0331-0331-f10000000331',
   '70000000-0331-0331-0331-700000000331'),
  ('e3000000-0331-0331-0331-e30000000331', 'ช่างบริษัทสอง', 'daily', 'temporary', 400, true,
   'a1000000-0331-0331-0331-a10000000331', null, '70000000-0331-0331-0331-700000000331');

insert into public.crews (id, project_id, name, kind, active, created_by) values
  ('c1000000-0331-0331-0331-c10000000331', 'a1000000-0331-0331-0331-a10000000331',
   'ทีมหนึ่ง', 'dc', true, '70000000-0331-0331-0331-700000000331'),
  ('c2000000-0331-0331-0331-c20000000331', 'a1000000-0331-0331-0331-a10000000331',
   'ทีมสอง', 'dc', true, '70000000-0331-0331-0331-700000000331');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. LAYER 2 — the triggers exist and are the writer-agnostic backstop.
-- ============================================================================
select has_trigger('public', 'crew_members', 'crew_members_money_wall',
  'crew_members carries the money-wall trigger');
select has_trigger('public', 'crews', 'crews_lead_money_wall',
  'crews carries the lead money-wall trigger');
select has_trigger('public', 'workers', 'workers_firm_tie_money_wall',
  'workers carries the firm-tie money-wall trigger');

-- A direct write (no RPC) must be refused — this is what makes the wall true
-- for approve_crew_registration, admin-client writes, and any future RPC.
select throws_ok(
  $$ insert into public.crew_members (crew_id, worker_id, added_by)
     values ('c1000000-0331-0331-0331-c10000000331',
             'e2000000-0331-0331-0331-e20000000331',
             '70000000-0331-0331-0331-700000000331') $$,
  '22023', 'contractor-tied worker is pay-exempt and cannot join a crew',
  'a DIRECT crew_members insert for a contractor-tied worker is refused');
select throws_ok(
  $$ update public.crews set lead_worker_id = 'e2000000-0331-0331-0331-e20000000331'
      where id = 'c1000000-0331-0331-0331-c10000000331' $$,
  '22023', 'contractor-tied worker is pay-exempt and cannot lead a crew',
  'a DIRECT crews lead update to a contractor-tied worker is refused');

-- ============================================================================
-- B. LAYER 1 — add_worker_to_crew / move_worker_between_crews.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0331-0331-0331-700000000331"}';

select throws_ok(
  $$ select public.add_worker_to_crew('c1000000-0331-0331-0331-c10000000331',
       'e2000000-0331-0331-0331-e20000000331') $$,
  '22023', 'contractor-tied worker is pay-exempt and cannot join a crew',
  'add_worker_to_crew refuses a contractor-tied worker (money wall)');

select ok(
  (select public.add_worker_to_crew('c1000000-0331-0331-0331-c10000000331',
     'e1000000-0331-0331-0331-e10000000331')) is not null,
  'a company (non-contractor) worker still joins normally');
select ok(
  (select public.add_worker_to_crew('c1000000-0331-0331-0331-c10000000331',
     'e3000000-0331-0331-0331-e30000000331')) is not null,
  'a second company worker joins normally');
reset role;

select is(
  (select count(*)::int from public.crew_members cm
     join public.workers w on w.id = cm.worker_id
    where cm.crew_id in ('c1000000-0331-0331-0331-c10000000331',
                         'c2000000-0331-0331-0331-c20000000331')
      and cm.removed_at is null),
  2, 'the two company workers are the ONLY active members of the seeded crews');

-- ============================================================================
-- C. LAYER 1 — set_crew_lead + reassign_crew_lead. The lead assert must fire
--    on the CONTRACTOR arm, so it runs while e2 has NO membership at all:
--    with the wall absent this would pass off the membership guard instead
--    (the first draft's false green — message text is pinned to prevent it).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0331-0331-0331-700000000331"}';

select throws_ok(
  $$ select public.set_crew_lead('c1000000-0331-0331-0331-c10000000331',
       'e2000000-0331-0331-0331-e20000000331') $$,
  '22023', 'contractor-tied worker is pay-exempt and cannot lead a crew',
  'set_crew_lead refuses a contractor-tied worker ON THE WALL, not on membership');

select throws_ok(
  $$ select public.reassign_crew_lead('c1000000-0331-0331-0331-c10000000331',
       'e2000000-0331-0331-0331-e20000000331') $$,
  '22023', 'contractor-tied worker is pay-exempt and cannot lead a crew',
  'reassign_crew_lead (spec 279, the OTHER lead writer) refuses one too');

-- The membership guard still works for a NON-contractor non-member.
select ok(
  (select public.set_crew_lead('c1000000-0331-0331-0331-c10000000331',
     'e1000000-0331-0331-0331-e10000000331')) is not null,
  'a company worker who IS a member becomes lead normally');

-- ============================================================================
-- D. LAYER 1 — create_crew's lead arm (its lead feeds the /sa/plan draft via
--    tomorrow-draft crewByWorker, so a lead-only crew is its own pay path).
-- ============================================================================
select throws_ok(
  $$ select public.create_crew('a1000000-0331-0331-0331-a10000000331', 'ทีมผี',
       'e2000000-0331-0331-0331-e20000000331') $$,
  '22023', 'contractor-tied worker is pay-exempt and cannot lead a crew',
  'create_crew refuses a contractor-tied lead');
select ok(
  (select public.create_crew('a1000000-0331-0331-0331-a10000000331', 'ทีมสาม',
     'e3000000-0331-0331-0331-e30000000331')) is not null,
  'create_crew still accepts a company-worker lead');
select ok(
  (select public.create_crew('a1000000-0331-0331-0331-a10000000331', 'ทีมสี่')) is not null,
  'create_crew still accepts a lead-less crew');

-- ============================================================================
-- E. LAYER 2 — the REVERSE direction: tying a sitting crew member/lead to a
--    firm would flip a costed worker pay-exempt under the crew graph.
-- ============================================================================
reset role;
select throws_ok(
  $$ update public.workers set contractor_id = 'f1000000-0331-0331-0331-f10000000331'
      where id = 'e3000000-0331-0331-0331-e30000000331' $$,
  '22023', 'worker is in a crew — remove them from the crew before tying them to a firm',
  'tying an active crew MEMBER to a firm is refused');
select throws_ok(
  $$ update public.workers set contractor_id = 'f1000000-0331-0331-0331-f10000000331'
      where id = 'e1000000-0331-0331-0331-e10000000331' $$,
  '22023', null,
  'tying a crew LEAD to a firm is refused');

-- ============================================================================
-- F. Removal is NEVER walled — a pre-wall row must not be trapped. This is
--    asserted at the SOURCE, not behaviourally: with both layers live a
--    contractor-tied membership can no longer be constructed in-transaction
--    at all (the API role is neither superuser nor table owner, so the
--    trigger cannot be bypassed) — which is the property we want. What must
--    stay true is that the escape hatch EXISTS if such a row ever appears.
-- ============================================================================
select ok(
  pg_get_functiondef('public.remove_worker_from_crew(uuid,uuid)'::regprocedure)
    not like '%contractor%',
  'remove_worker_from_crew carries NO contractor guard (removal never trapped)');
select ok(
  pg_get_functiondef('public.crew_member_not_contractor()'::regprocedure)
    like '%new.removed_at is null%',
  'the crew_members trigger fires only on ACTIVE rows, so closing one always passes');

-- ============================================================================
-- G. The invariant, scoped to this fixture's project (never a bare count over
--    the shared table — the repeat offender class in this repo).
-- ============================================================================
select is(
  (select count(*)::int from public.crews c
     join public.workers w on w.id = c.lead_worker_id
    where c.project_id = 'a1000000-0331-0331-0331-a10000000331'
      and w.contractor_id is not null),
  0, 'no seeded crew is LED by a contractor-tied worker');
select is(
  (select count(*)::int from public.crew_members cm
     join public.workers w on w.id = cm.worker_id
     join public.crews c on c.id = cm.crew_id
    where c.project_id = 'a1000000-0331-0331-0331-a10000000331'
      and cm.removed_at is null and w.contractor_id is not null),
  0, 'NO active contractor-tied membership exists in the seeded project');

select * from finish();
rollback;
