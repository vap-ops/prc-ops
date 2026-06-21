begin;
select plan(19);

-- ============================================================================
-- Spec 130 U2 / ADR 0051 — row-level RLS for the external contractor tier.
-- The core isolation proof: a bound contractor sees ONLY their own
-- contractor / crew / DC labor days / payments; never another contractor's;
-- internal role-level access (site_admin) is unchanged; the dc_payments money
-- posture (zero authenticated grant) is preserved — a DC reads their own money
-- through get_my_dc_payments(), not the raw table.
--
-- Spec 170 U3 (ADR 0062): dc_payments is now keyed on worker_id. The portal
-- binding is still via the contractor until U4, so get_my_dc_payments() bridges
-- worker → contractor (own payments = payments of workers bound to my
-- contractor).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000138', 'ua@portal.local', '{}'::jsonb),
  ('b1000000-0000-4000-8000-000000000138', 'ub@portal.local', '{}'::jsonb),
  ('51000000-0000-4000-8000-000000000138', 'sa@portal.local', '{}'::jsonb);
update public.users set role = 'site_admin' where id = '51000000-0000-4000-8000-000000000138';

-- Two contractors, each with a worker, a DC labor day, and a payment.
insert into public.contractors (id, name, created_by) values
  ('aa000000-0000-4000-8000-000000000138', 'Contractor A', '51000000-0000-4000-8000-000000000138'),
  ('bb000000-0000-4000-8000-000000000138', 'Contractor B', '51000000-0000-4000-8000-000000000138');

-- Bind uA→A, uB→B and flip them to the contractor role (mirrors a claimed invite).
insert into public.contractor_users (user_id, contractor_id) values
  ('a1000000-0000-4000-8000-000000000138', 'aa000000-0000-4000-8000-000000000138'),
  ('b1000000-0000-4000-8000-000000000138', 'bb000000-0000-4000-8000-000000000138');
update public.users set role = 'contractor'
  where id in ('a1000000-0000-4000-8000-000000000138', 'b1000000-0000-4000-8000-000000000138');

insert into public.workers (id, name, worker_type, contractor_id, user_id, day_rate, active, created_by) values
  ('a2000000-0000-4000-8000-000000000138', 'Worker A', 'dc', 'aa000000-0000-4000-8000-000000000138', null, 400.00, true, '51000000-0000-4000-8000-000000000138'),
  ('b2000000-0000-4000-8000-000000000138', 'Worker B', 'dc', 'bb000000-0000-4000-8000-000000000138', null, 450.00, true, '51000000-0000-4000-8000-000000000138');

insert into public.projects (id, code, name) values
  ('c0000000-0000-4000-8000-000000000138', 'TAP-PORTAL', 'Portal RLS fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('e0000000-0000-4000-8000-000000000138', 'c0000000-0000-4000-8000-000000000138', 'WP-P-1', 'WP', 'in_progress');

insert into public.labor_logs (id, work_package_id, worker_id, work_date, day_fraction,
    day_rate_snapshot, worker_name_snapshot, worker_type_snapshot, contractor_id_snapshot, entered_by) values
  ('fa000000-0000-4000-8000-000000000138', 'e0000000-0000-4000-8000-000000000138', 'a2000000-0000-4000-8000-000000000138',
   date '2026-06-05', 'full', 400.00, 'Worker A', 'dc', 'aa000000-0000-4000-8000-000000000138', '51000000-0000-4000-8000-000000000138'),
  ('fb000000-0000-4000-8000-000000000138', 'e0000000-0000-4000-8000-000000000138', 'b2000000-0000-4000-8000-000000000138',
   date '2026-06-05', 'full', 450.00, 'Worker B', 'dc', 'bb000000-0000-4000-8000-000000000138', '51000000-0000-4000-8000-000000000138');

insert into public.dc_payments (worker_id, period_from, period_to, computed_amount, computed_days,
    paid_amount, paid_at, method, paid_by) values
  ('a2000000-0000-4000-8000-000000000138', '2026-06-01', '2026-06-30', 400.00, 1.0, 400.00, '2026-06-30', 'bank_transfer', '51000000-0000-4000-8000-000000000138'),
  ('b2000000-0000-4000-8000-000000000138', '2026-06-01', '2026-06-30', 450.00, 1.0, 450.00, '2026-06-30', 'cash', '51000000-0000-4000-8000-000000000138');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Contractor A (uA) — own rows only.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000138"}';

select is((select public.current_user_contractor_id()),
  'aa000000-0000-4000-8000-000000000138'::uuid, 'uA helper resolves to Contractor A');
select is((select count(*) from public.contractors),
  1::bigint, 'uA sees exactly one contractor row');
select is((select id from public.contractors),
  'aa000000-0000-4000-8000-000000000138'::uuid, 'uA sees Contractor A, not B');
select is((select count(*) from public.workers),
  1::bigint, 'uA sees only their own crew');
select is((select id from public.workers),
  'a2000000-0000-4000-8000-000000000138'::uuid, 'uA crew is Worker A');
select throws_ok(
  $$ select day_rate from public.workers limit 1 $$,
  '42501', null, 'uA cannot read workers.day_rate (money column grant)');
select is((select count(*) from public.labor_logs),
  1::bigint, 'uA sees only their own DC labor days');
select throws_ok(
  $$ select day_rate_snapshot from public.labor_logs limit 1 $$,
  '42501', null, 'uA cannot read labor_logs.day_rate_snapshot (money column grant)');
select throws_ok(
  $$ select paid_amount from public.dc_payments limit 1 $$,
  '42501', null, 'dc_payments stays zero-grant — uA cannot read it directly');
select is((select count(*) from public.get_my_dc_payments()),
  1::bigint, 'uA reads their own payment via the definer reader');
select is((select worker_id from public.get_my_dc_payments() limit 1),
  'a2000000-0000-4000-8000-000000000138'::uuid, 'the payment uA reads is Worker A''s (bound to Contractor A)');
select is((select paid_amount from public.get_my_dc_payments() limit 1),
  400.00, 'uA sees their own amount (400)');

-- ============================================================================
-- B. Contractor B (uB) — isolation: never sees A.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "b1000000-0000-4000-8000-000000000138"}';
select is((select id from public.contractors),
  'bb000000-0000-4000-8000-000000000138'::uuid, 'uB sees only Contractor B');
select is((select count(*) from public.workers
            where contractor_id = 'aa000000-0000-4000-8000-000000000138'),
  0::bigint, 'uB cannot see Contractor A''s crew');
select is((select count(*) from public.labor_logs
            where contractor_id_snapshot = 'aa000000-0000-4000-8000-000000000138'),
  0::bigint, 'uB cannot see Contractor A''s labor days');
select is((select worker_id from public.get_my_dc_payments() limit 1),
  'b2000000-0000-4000-8000-000000000138'::uuid, 'uB reads only their own payment (Worker B)');

-- ============================================================================
-- C. site_admin — internal role-level access is unchanged; no contractor money.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "51000000-0000-4000-8000-000000000138"}';
select is((select count(*) from public.contractors
            where id in ('aa000000-0000-4000-8000-000000000138', 'bb000000-0000-4000-8000-000000000138')),
  2::bigint, 'site_admin still sees every contractor (role-level intact)');
select is((select count(*) from public.workers
            where contractor_id in ('aa000000-0000-4000-8000-000000000138', 'bb000000-0000-4000-8000-000000000138')),
  2::bigint, 'site_admin still sees every crew (role-level intact)');
select is((select count(*) from public.get_my_dc_payments()),
  0::bigint, 'site_admin has no contractor binding → reads zero payments');

reset role;
select * from finish();
rollback;
