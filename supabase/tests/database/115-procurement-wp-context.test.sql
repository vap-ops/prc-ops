-- Spec 171 U1 — procurement gains WP-context reads + PR insert.
--
-- procurement is cross-project (spec 102 / ADR 0056): can_see_project()/
-- can_see_wp() return FALSE for it, so its reach is granted by explicit
-- `current_user_role() = 'procurement'` arms. Migration 20260780000000 added that
-- arm to three WP-context SELECT policies (photo_logs, labor_logs, approvals) and
-- to the purchase_requests INSERT policy, BESIDE the existing can_see_wp arm.
--
-- Qual-text pins (same style as the `like '%can_see_wp%'` pins in files 70/73):
-- each policy must now reference 'procurement' AND still reference can_see_wp, so
-- a future rewrite can neither drop procurement's access nor silently remove the
-- sa/pm/site_admin membership scoping. The behavioural INSERT positive is pinned
-- in file 17 (E.6, lives_ok).

begin;
select plan(8);

-- 1/2. photo_logs SELECT.
select ok(
  (select qual from pg_policies
     where schemaname='public' and tablename='photo_logs'
       and policyname='photo_logs readable by privileged roles') like '%procurement%',
  'photo_logs SELECT admits procurement (spec 171)'
);
select ok(
  (select qual from pg_policies
     where schemaname='public' and tablename='photo_logs'
       and policyname='photo_logs readable by privileged roles') like '%can_see_wp%',
  'photo_logs SELECT keeps the can_see_wp membership gate (ADR 0056)'
);

-- 3/4. labor_logs SELECT (staff policy; bound-contractor self-read is separate).
select ok(
  (select qual from pg_policies
     where schemaname='public' and tablename='labor_logs'
       and policyname='labor logs readable by field and pm') like '%procurement%',
  'labor_logs staff SELECT admits procurement (spec 171)'
);
select ok(
  (select qual from pg_policies
     where schemaname='public' and tablename='labor_logs'
       and policyname='labor logs readable by field and pm') like '%can_see_wp%',
  'labor_logs staff SELECT keeps the can_see_wp membership gate (ADR 0056)'
);

-- 5/6. approvals SELECT.
select ok(
  (select qual from pg_policies
     where schemaname='public' and tablename='approvals'
       and policyname='approvals readable by sa/pm/super') like '%procurement%',
  'approvals SELECT admits procurement (spec 171)'
);
select ok(
  (select qual from pg_policies
     where schemaname='public' and tablename='approvals'
       and policyname='approvals readable by sa/pm/super') like '%can_see_wp%',
  'approvals SELECT keeps the can_see_wp membership gate (ADR 0056)'
);

-- 7/8. purchase_requests INSERT (expression lives in with_check, not qual).
select ok(
  (select with_check from pg_policies
     where schemaname='public' and tablename='purchase_requests'
       and policyname='purchase_requests insert by wp-readers') like '%procurement%',
  'purchase_requests INSERT admits procurement (spec 171)'
);
select ok(
  (select with_check from pg_policies
     where schemaname='public' and tablename='purchase_requests'
       and policyname='purchase_requests insert by wp-readers') like '%can_see_wp%',
  'purchase_requests INSERT keeps the can_see_wp gate for the sa/pm/super arm'
);

select * from finish();
rollback;
