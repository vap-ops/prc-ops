begin;
select plan(34);

-- ============================================================================
-- Spec 306 U5a — muster → labor_logs money derive (enum-only minimal engine).
--   derive_muster_labor(project, date): for each PRESENT regular muster session
--   on a CLOSED day, one labor_logs row per LEAF (งานย่อย) WP of the team, even
--   split via the day_fraction enum (1 WP → full, 2 WPs → half).
--   DEFERRED (skipped, no rows, close-day never breaks): a team on a GROUP (งาน)
--   WP — labor cannot bind to a group (wp_reject_group_binding) — or on 3+ WPs.
--   * Cost gate: no cost_confirmed_at OR day_rate ≤ 0 → NO rows (held worker).
--   * Snapshots: day_rate / name / pay_type / wht (config singleton) / LEVEL.
--   * source_muster_id = the attendance row → idempotent re-derive (supersede
--     only when it changed; never double-post). Defers to a manual log row.
--   * close_muster_day calls it inline. Not-closed day → nothing.
-- P1 = FLAT project (leaf WPs); P2 = GROUPED (a group WP + a leaf child).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0d06-0d06-0d06-700000000d06', 'sa@d306.local',    '{}'::jsonb),
  ('75000000-0d06-0d06-0d06-750000000d06', 'super@d306.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = '70000000-0d06-0d06-0d06-700000000d06';
update public.users set role = 'super_admin' where id = '75000000-0d06-0d06-0d06-750000000d06';

insert into public.projects (id, code, name) values
  ('a1000000-0d06-0d06-0d06-a10000000d06', 'TAP-D6A', 'โครงการ flat'),
  ('a2000000-0d06-0d06-0d06-a20000000d06', 'TAP-D6B', 'โครงการ grouped');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0d06-0d06-0d06-a10000000d06', '70000000-0d06-0d06-0d06-700000000d06', '75000000-0d06-0d06-0d06-750000000d06'),
  ('a2000000-0d06-0d06-0d06-a20000000d06', '70000000-0d06-0d06-0d06-700000000d06', '75000000-0d06-0d06-0d06-750000000d06');

-- Members A/B confirmed-with-rate; C unconfirmed; D rate 0; E confirmed (0-WP);
-- F/G confirmed (P2 group / leaf). L1..L3 distinct leads (unique per proj/date/lead).
insert into public.workers (id, name, pay_type, employment_type, day_rate, level, active, cost_confirmed_at, cost_confirmed_by, created_by) values
  ('e1000000-0d06-0d06-0d06-e10000000d06', 'ช่างเอ', 'daily', 'temporary', 500, 'senior', true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06'),
  ('e2000000-0d06-0d06-0d06-e20000000d06', 'ช่างบี', 'daily', 'temporary', 400, 'mid',    true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06'),
  ('e3000000-0d06-0d06-0d06-e30000000d06', 'ช่างซี', 'daily', 'temporary', 500, 'junior', true, null, null, '75000000-0d06-0d06-0d06-750000000d06'),
  ('e4000000-0d06-0d06-0d06-e40000000d06', 'ช่างดี', 'daily', 'temporary', 0,   'junior', true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06'),
  ('e5000000-0d06-0d06-0d06-e50000000d06', 'ช่างอี', 'daily', 'temporary', 500, 'senior', true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06'),
  ('e6000000-0d06-0d06-0d06-e60000000d06', 'ช่างเอฟ', 'daily', 'temporary', 500, 'senior', true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06'),
  ('e7000000-0d06-0d06-0d06-e70000000d06', 'ช่างจี', 'daily', 'temporary', 500, 'senior', true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06'),
  ('e9000000-0d06-0d06-0d06-e90000000d06', 'หัวหน้าหนึ่ง', 'daily', 'temporary', 500, 'senior', true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06'),
  ('ea000000-0d06-0d06-0d06-ea0000000d06', 'หัวหน้าสอง', 'daily', 'temporary', 500, 'senior', true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06'),
  ('eb000000-0d06-0d06-0d06-eb0000000d06', 'หัวหน้าสาม', 'daily', 'temporary', 500, 'senior', true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06');

-- P1 FLAT — leaf WPs (no group in the project → top-level leaves are allowed and
-- labor binds directly).
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('91000000-0d06-0d06-0d06-910000000d06', 'a1000000-0d06-0d06-0d06-a10000000d06', 'WP-D1', 'งานหนึ่ง', false),
  ('92000000-0d06-0d06-0d06-920000000d06', 'a1000000-0d06-0d06-0d06-a10000000d06', 'WP-D2', 'งานสอง', false),
  ('93000000-0d06-0d06-0d06-930000000d06', 'a1000000-0d06-0d06-0d06-a10000000d06', 'WP-D3', 'งานสาม', false);
-- P2 GROUPED — a group (งาน) WP + a leaf (งานย่อย) child under it.
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('95000000-0d06-0d06-0d06-950000000d06', 'a2000000-0d06-0d06-0d06-a20000000d06', 'WP-G', 'งานกลุ่ม', true);
insert into public.work_packages (id, project_id, code, name, parent_id) values
  ('96000000-0d06-0d06-0d06-960000000d06', 'a2000000-0d06-0d06-0d06-a20000000d06', 'WP-GS', 'งานย่อยในกลุ่ม', '95000000-0d06-0d06-0d06-950000000d06');

-- Teams. P1 today: c1=1WP(L1), c2=2WP(L2), c0=0WP(L3). Past 3-WP: c3(L1). Future
-- close-trigger: cf(L1). P2 today: cg=group(L1), cgs=leaf(L2). Leads reused across
-- projects/dates are fine (uniqueness is per project+date+lead).
insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('c1000000-0d06-0d06-0d06-c10000000d06', 'a1000000-0d06-0d06-0d06-a10000000d06', current_date, 'e9000000-0d06-0d06-0d06-e90000000d06', '70000000-0d06-0d06-0d06-700000000d06'),
  ('c2000000-0d06-0d06-0d06-c20000000d06', 'a1000000-0d06-0d06-0d06-a10000000d06', current_date, 'ea000000-0d06-0d06-0d06-ea0000000d06', '70000000-0d06-0d06-0d06-700000000d06'),
  ('c0000000-0d06-0d06-0d06-c00000000d06', 'a1000000-0d06-0d06-0d06-a10000000d06', current_date, 'eb000000-0d06-0d06-0d06-eb0000000d06', '70000000-0d06-0d06-0d06-700000000d06'),
  ('c3000000-0d06-0d06-0d06-c30000000d06', 'a1000000-0d06-0d06-0d06-a10000000d06', '2026-01-06', 'e9000000-0d06-0d06-0d06-e90000000d06', '70000000-0d06-0d06-0d06-700000000d06'),
  ('c6000000-0d06-0d06-0d06-c60000000d06', 'a2000000-0d06-0d06-0d06-a20000000d06', current_date, 'e9000000-0d06-0d06-0d06-e90000000d06', '70000000-0d06-0d06-0d06-700000000d06'),
  ('c5000000-0d06-0d06-0d06-c50000000d06', 'a2000000-0d06-0d06-0d06-a20000000d06', current_date, 'ea000000-0d06-0d06-0d06-ea0000000d06', '70000000-0d06-0d06-0d06-700000000d06');

insert into public.muster_team_wps (team_id, work_package_id) values
  ('c1000000-0d06-0d06-0d06-c10000000d06', '91000000-0d06-0d06-0d06-910000000d06'),
  ('c2000000-0d06-0d06-0d06-c20000000d06', '91000000-0d06-0d06-0d06-910000000d06'),
  ('c2000000-0d06-0d06-0d06-c20000000d06', '92000000-0d06-0d06-0d06-920000000d06'),
  ('c3000000-0d06-0d06-0d06-c30000000d06', '91000000-0d06-0d06-0d06-910000000d06'),
  ('c3000000-0d06-0d06-0d06-c30000000d06', '92000000-0d06-0d06-0d06-920000000d06'),
  ('c3000000-0d06-0d06-0d06-c30000000d06', '93000000-0d06-0d06-0d06-930000000d06'),
  ('c5000000-0d06-0d06-0d06-c50000000d06', '96000000-0d06-0d06-0d06-960000000d06');   -- leaf child
insert into public.muster_team_wps (team_id, work_package_id) values
  ('c6000000-0d06-0d06-0d06-c60000000d06', '95000000-0d06-0d06-0d06-950000000d06');   -- group WP

insert into public.muster_attendance (id, team_id, worker_id, work_date, session, in_at, in_method, scanned_by) values
  ('d1000000-0d06-0d06-0d06-d10000000d06', 'c1000000-0d06-0d06-0d06-c10000000d06', 'e1000000-0d06-0d06-0d06-e10000000d06', current_date, 'regular', now(), 'manual', '70000000-0d06-0d06-0d06-700000000d06'),
  ('d2000000-0d06-0d06-0d06-d20000000d06', 'c2000000-0d06-0d06-0d06-c20000000d06', 'e2000000-0d06-0d06-0d06-e20000000d06', current_date, 'regular', now(), 'manual', '70000000-0d06-0d06-0d06-700000000d06'),
  ('d3000000-0d06-0d06-0d06-d30000000d06', 'c2000000-0d06-0d06-0d06-c20000000d06', 'e3000000-0d06-0d06-0d06-e30000000d06', current_date, 'regular', now(), 'manual', '70000000-0d06-0d06-0d06-700000000d06'),
  ('d4000000-0d06-0d06-0d06-d40000000d06', 'c2000000-0d06-0d06-0d06-c20000000d06', 'e4000000-0d06-0d06-0d06-e40000000d06', current_date, 'regular', now(), 'manual', '70000000-0d06-0d06-0d06-700000000d06'),
  ('d0000000-0d06-0d06-0d06-d00000000d06', 'c0000000-0d06-0d06-0d06-c00000000d06', 'e5000000-0d06-0d06-0d06-e50000000d06', current_date, 'regular', now(), 'manual', '70000000-0d06-0d06-0d06-700000000d06'),
  ('d5000000-0d06-0d06-0d06-d50000000d06', 'c3000000-0d06-0d06-0d06-c30000000d06', 'e1000000-0d06-0d06-0d06-e10000000d06', '2026-01-06', 'regular', now(), 'manual', '70000000-0d06-0d06-0d06-700000000d06'),
  ('d6000000-0d06-0d06-0d06-d60000000d06', 'c6000000-0d06-0d06-0d06-c60000000d06', 'e6000000-0d06-0d06-0d06-e60000000d06', current_date, 'regular', now(), 'manual', '70000000-0d06-0d06-0d06-700000000d06'),
  ('d7000000-0d06-0d06-0d06-d70000000d06', 'c5000000-0d06-0d06-0d06-c50000000d06', 'e7000000-0d06-0d06-0d06-e70000000d06', current_date, 'regular', now(), 'manual', '70000000-0d06-0d06-0d06-700000000d06');

insert into public.muster_day_closures (project_id, work_date, closed_by) values
  ('a1000000-0d06-0d06-0d06-a10000000d06', current_date, '70000000-0d06-0d06-0d06-700000000d06'),
  ('a1000000-0d06-0d06-0d06-a10000000d06', '2026-01-06', '70000000-0d06-0d06-0d06-700000000d06'),
  ('a2000000-0d06-0d06-0d06-a20000000d06', current_date, '70000000-0d06-0d06-0d06-700000000d06');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Structure + grants.
-- ============================================================================
select has_column('public'::name, 'labor_logs'::name, 'level_snapshot'::name, 'labor_logs has level_snapshot');
select has_column('public'::name, 'labor_logs'::name, 'source_muster_id'::name, 'labor_logs has source_muster_id');
select ok(not has_function_privilege('anon', 'public.derive_muster_labor(uuid,date)', 'execute'),
  'anon cannot execute derive_muster_labor');
select ok(has_function_privilege('authenticated', 'public.derive_muster_labor(uuid,date)', 'execute'),
  'authenticated can execute derive_muster_labor');

-- ============================================================================
-- B. Derive P1's closed day (member SA).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select lives_ok(
  $$ select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', current_date) $$,
  'the derive runs for P1''s closed day');
reset role;

select is((select count(*)::int from public.labor_logs
    where worker_id = 'e1000000-0d06-0d06-0d06-e10000000d06' and work_date = current_date),
  1, 'confirmed worker on a 1-WP team gets exactly one labor row');
select ok((select day_fraction = 'full' and day_rate_snapshot = 500 and level_snapshot = 'senior'
      and pay_type_snapshot = 'daily' and wht_pct_snapshot = 3.00 and self_logged = false
      and worker_name_snapshot = 'ช่างเอ' and work_package_id = '91000000-0d06-0d06-0d06-910000000d06'
     from public.labor_logs
    where worker_id = 'e1000000-0d06-0d06-0d06-e10000000d06' and work_date = current_date),
  'the row carries full-day + rate/level/wht/name/pay_type snapshots, not self-logged');
select is((select source_muster_id from public.labor_logs
    where worker_id = 'e1000000-0d06-0d06-0d06-e10000000d06' and work_date = current_date),
  'd1000000-0d06-0d06-0d06-d10000000d06', 'source_muster_id points at the attendance row');

select is((select count(*)::int from public.labor_logs
    where worker_id = 'e2000000-0d06-0d06-0d06-e20000000d06' and work_date = current_date),
  2, 'confirmed worker on a 2-WP team gets two rows (one per WP)');
select ok((select bool_and(day_fraction = 'half') from public.labor_logs
    where worker_id = 'e2000000-0d06-0d06-0d06-e20000000d06' and work_date = current_date),
  'each of the two rows is a half day (even split 1/2)');
select is((select array_agg(work_package_id order by work_package_id) from public.labor_logs
    where worker_id = 'e2000000-0d06-0d06-0d06-e20000000d06' and work_date = current_date),
  array['91000000-0d06-0d06-0d06-910000000d06','92000000-0d06-0d06-0d06-920000000d06']::uuid[],
  'the two rows anchor on the team''s two WPs');

select is((select count(*)::int from public.labor_logs where worker_id = 'e3000000-0d06-0d06-0d06-e30000000d06'),
  0, 'an unconfirmed worker produces NO labor rows (held)');
select is((select count(*)::int from public.labor_logs where worker_id = 'e4000000-0d06-0d06-0d06-e40000000d06'),
  0, 'a day_rate=0 worker produces NO labor rows');
select is((select count(*)::int from public.labor_logs where worker_id = 'e5000000-0d06-0d06-0d06-e50000000d06'),
  0, 'a worker on a team with NO announced WP produces NO rows');

-- ============================================================================
-- C. 3+ WP SKIP + idempotent + supersede-on-change.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select lives_ok(
  $$ select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', '2026-01-06') $$,
  'the derive runs for the 3-WP day without error');
reset role;
select is((select count(*)::int from public.labor_logs
    where worker_id = 'e1000000-0d06-0d06-0d06-e10000000d06' and work_date = '2026-01-06'),
  0, 'a worker on a 3-WP team is SKIPPED (needs the deferred man-day split)');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', current_date);
reset role;
select is((select count(*)::int from public.labor_logs where work_date = current_date
    and worker_id in ('e1000000-0d06-0d06-0d06-e10000000d06','e2000000-0d06-0d06-0d06-e20000000d06')),
  3, 're-running the derive creates NO duplicate rows (A:1 + B:2 = 3, unchanged)');

update public.workers set day_rate = 600 where id = 'e1000000-0d06-0d06-0d06-e10000000d06';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', current_date);
reset role;
select is((select day_rate_snapshot from public.labor_logs ll
    where ll.worker_id = 'e1000000-0d06-0d06-0d06-e10000000d06' and ll.work_date = current_date
      and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  600::numeric, 're-derive after a rate change supersedes to a fresh row at the new rate');
select is((select count(*)::int from public.labor_logs ll
    where ll.worker_id = 'e1000000-0d06-0d06-0d06-e10000000d06' and ll.work_date = current_date
      and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  1, 'still exactly ONE current row for A after the supersede (old one retired)');
select is((select correction_reason from public.labor_logs ll
    where ll.worker_id = 'e1000000-0d06-0d06-0d06-e10000000d06' and ll.work_date = current_date
      and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  'muster_rederive', 'the superseding row records the muster_rederive reason');

-- ============================================================================
-- D. Manual log_labor_day defer — the derive never double-logs a human row.
-- ============================================================================
insert into public.labor_logs (work_package_id, worker_id, work_date, day_fraction, day_rate_snapshot, worker_name_snapshot, pay_type_snapshot, wht_pct_snapshot, entered_by, self_logged, superseded_by, correction_reason)
  select ll.work_package_id, ll.worker_id, ll.work_date, 'full', 400, 'ช่างบี', 'daily', 3.00, '70000000-0d06-0d06-0d06-700000000d06', false, ll.id, 'manual_fix'
    from public.labor_logs ll
   where ll.worker_id = 'e2000000-0d06-0d06-0d06-e20000000d06' and ll.work_package_id = '91000000-0d06-0d06-0d06-910000000d06'
     and ll.work_date = current_date and ll.source_muster_id is not null
     and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', current_date);
reset role;
select is((select count(*)::int from public.labor_logs ll
    where ll.worker_id = 'e2000000-0d06-0d06-0d06-e20000000d06'
      and ll.work_package_id = '91000000-0d06-0d06-0d06-910000000d06' and ll.work_date = current_date
      and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  1, 'derive defers to a manual row for (wp, worker, date) — one current row, no dup');
select is((select source_muster_id from public.labor_logs ll
    where ll.worker_id = 'e2000000-0d06-0d06-0d06-e20000000d06'
      and ll.work_package_id = '91000000-0d06-0d06-0d06-910000000d06' and ll.work_date = current_date
      and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  null::uuid, 'the surviving current row is the MANUAL one (source_muster_id null)');

-- ============================================================================
-- E. No-closure derives nothing; close_muster_day triggers the derive.
-- ============================================================================
insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('cf000000-0d06-0d06-0d06-cf0000000d06', 'a1000000-0d06-0d06-0d06-a10000000d06', current_date + 1, 'e9000000-0d06-0d06-0d06-e90000000d06', '70000000-0d06-0d06-0d06-700000000d06');
insert into public.muster_team_wps (team_id, work_package_id) values
  ('cf000000-0d06-0d06-0d06-cf0000000d06', '92000000-0d06-0d06-0d06-920000000d06');
insert into public.muster_attendance (id, team_id, worker_id, work_date, session, in_at, in_method, scanned_by) values
  ('df000000-0d06-0d06-0d06-df0000000d06', 'cf000000-0d06-0d06-0d06-cf0000000d06', 'e1000000-0d06-0d06-0d06-e10000000d06', current_date + 1, 'regular', now(), 'manual', '70000000-0d06-0d06-0d06-700000000d06');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', current_date + 1);
reset role;
select is((select count(*)::int from public.labor_logs where work_date = current_date + 1),
  0, 'an UN-closed day derives nothing (closure is the precondition)');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select lives_ok(
  $$ select public.close_muster_day('a1000000-0d06-0d06-0d06-a10000000d06', current_date + 1) $$,
  'close_muster_day closes the future day');
reset role;
select is((select count(*)::int from public.labor_logs
    where work_date = current_date + 1 and worker_id = 'e1000000-0d06-0d06-0d06-e10000000d06'),
  1, 'close_muster_day triggered the derive inline (one row on the 1-WP team)');

-- ============================================================================
-- G. GROUP-WP skip (P2): a team on a group WP produces NO rows; a team on a LEAF
-- child DOES produce a row (proves leaf binding works inside a grouped project).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select lives_ok(
  $$ select public.derive_muster_labor('a2000000-0d06-0d06-0d06-a20000000d06', current_date) $$,
  'the derive runs for the grouped project without error (no group-binding crash)');
reset role;
select is((select count(*)::int from public.labor_logs where worker_id = 'e6000000-0d06-0d06-0d06-e60000000d06'),
  0, 'a team announced on a GROUP (งาน) WP is SKIPPED — labor cannot bind to a group');
select is((select count(*)::int from public.labor_logs
    where worker_id = 'e7000000-0d06-0d06-0d06-e70000000d06' and work_package_id = '96000000-0d06-0d06-0d06-960000000d06'),
  1, 'a team on a LEAF child WP DOES derive labor (leaf binding works under a group)');

-- ============================================================================
-- H. RETRACT — a re-derive tombstones rows whose basis vanished (no over-count).
-- Worker H on a fresh 2-WP team (today, already closed).
-- ============================================================================
insert into public.workers (id, name, pay_type, employment_type, day_rate, level, active, cost_confirmed_at, cost_confirmed_by, created_by) values
  ('e8000000-0d06-0d06-0d06-e80000000d06', 'ช่างเอช', 'daily', 'temporary', 500, 'senior', true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06'),
  ('ec000000-0d06-0d06-0d06-ec0000000d06', 'หัวหน้าสี่', 'daily', 'temporary', 500, 'senior', true, now(), '75000000-0d06-0d06-0d06-750000000d06', '75000000-0d06-0d06-0d06-750000000d06');
insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('c7000000-0d06-0d06-0d06-c70000000d06', 'a1000000-0d06-0d06-0d06-a10000000d06', current_date, 'ec000000-0d06-0d06-0d06-ec0000000d06', '70000000-0d06-0d06-0d06-700000000d06');
insert into public.muster_team_wps (team_id, work_package_id) values
  ('c7000000-0d06-0d06-0d06-c70000000d06', '91000000-0d06-0d06-0d06-910000000d06'),
  ('c7000000-0d06-0d06-0d06-c70000000d06', '92000000-0d06-0d06-0d06-920000000d06');
insert into public.muster_attendance (id, team_id, worker_id, work_date, session, in_at, in_method, scanned_by) values
  ('d8000000-0d06-0d06-0d06-d80000000d06', 'c7000000-0d06-0d06-0d06-c70000000d06', 'e8000000-0d06-0d06-0d06-e80000000d06', current_date, 'regular', now(), 'manual', '70000000-0d06-0d06-0d06-700000000d06');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', current_date);
reset role;
select is((select count(*)::int from public.labor_logs ll
    where ll.worker_id = 'e8000000-0d06-0d06-0d06-e80000000d06' and ll.work_date = current_date
      and ll.day_fraction is not null and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  2, 'H starts with two current rows on a 2-WP team');

-- Drop WP-D2 from H's team → re-derive → the WP-D2 row is RETRACTED (tombstoned);
-- H's current real rows = ONE (WP-D1, now full), never 1.5-worth of rows.
delete from public.muster_team_wps where team_id = 'c7000000-0d06-0d06-0d06-c70000000d06' and work_package_id = '92000000-0d06-0d06-0d06-920000000d06';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', current_date);
reset role;
select is((select count(*)::int from public.labor_logs ll
    where ll.worker_id = 'e8000000-0d06-0d06-0d06-e80000000d06' and ll.work_date = current_date
      and ll.day_fraction is not null and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  1, 'shrinking the team RETRACTS the dropped WP''s row — one current row, no over-count');
select is((select day_fraction::text from public.labor_logs ll
    where ll.worker_id = 'e8000000-0d06-0d06-0d06-e80000000d06' and ll.work_date = current_date
      and ll.day_fraction is not null and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  'full', 'the surviving row re-split to a full day (1 WP)');

-- Un-confirm H → re-derive → ALL H's derived rows retracted (held again).
update public.workers set cost_confirmed_at = null where id = 'e8000000-0d06-0d06-0d06-e80000000d06';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', current_date);
reset role;
select is((select count(*)::int from public.labor_logs ll
    where ll.worker_id = 'e8000000-0d06-0d06-0d06-e80000000d06' and ll.work_date = current_date
      and ll.day_fraction is not null and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  0, 'un-confirming a worker RETRACTS their derived rows (held)');

-- A wht-config change re-snapshots on re-derive (money — withholding tax).
update public.labor_wht_config set wht_pct = 5.00 where id = true;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0d06-0d06-0d06-700000000d06"}';
select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', current_date);
reset role;
select is((select wht_pct_snapshot from public.labor_logs ll
    where ll.worker_id = 'e1000000-0d06-0d06-0d06-e10000000d06' and ll.work_date = current_date
      and ll.day_fraction is not null and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)),
  5.00::numeric, 'a wht_pct change re-snapshots the row on re-derive (money)');

-- ============================================================================
-- F. Role gate — a visitor cannot derive.
-- ============================================================================
insert into auth.users (id, email) values ('72000000-0d06-0d06-0d06-720000000d06', 'vis@d306.local');
update public.users set role = 'visitor' where id = '72000000-0d06-0d06-0d06-720000000d06';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "72000000-0d06-0d06-0d06-720000000d06"}';
select throws_ok(
  $$ select public.derive_muster_labor('a1000000-0d06-0d06-0d06-a10000000d06', current_date) $$,
  '42501', null, 'a visitor cannot run the money derive (role gate)');
reset role;

select * from finish();
rollback;
