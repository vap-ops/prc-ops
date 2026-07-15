begin;
select plan(28);

-- ============================================================================
-- Spec 314 U1 / ADR 0082 — firm-wide level-standard labor rates + WHT compute.
--
-- worker_level_rates: one row per worker_level, PM-maintained, rate seeded NULL,
-- wht_basis per level (senior/mid before_wht, junior/apprentice after_wht).
-- labor_wht_config: firm WHT %, singleton, seeded 3.00.
-- level_gross_rate(level): entered_rate grossed-up (before_wht → as-is; after_wht
-- → entered / (1 - pct/100); NULL rate → NULL). Money columns (entered_rate,
-- wht_pct) get ZERO authenticated grant. Writes = PM/super DEFINER-only.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0314-0314-0314-700000000314', 'pmgr@s314.local',    '{}'::jsonb),
  ('75000000-0314-0314-0314-750000000314', 'super@s314.local',   '{}'::jsonb),
  ('71000000-0314-0314-0314-710000000314', 'visitor@s314.local', '{}'::jsonb);
update public.users set role = 'procurement_manager' where id = '70000000-0314-0314-0314-700000000314';
update public.users set role = 'super_admin'          where id = '75000000-0314-0314-0314-750000000314';
-- 71… stays the signup default (visitor) — the non-money actor.

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- Normalize to SEED state inside this rollback txn (2026-07-15): worker_level_rates
-- + labor_wht_config carry PM-filled LIVE values in prod (the operator sets real
-- rates via /settings/labor-rates), so the fresh-seed assertions below (unset-rate
-- grosses to NULL, firm WHT 3%) must run against seed state, not live data. These
-- writes are undone on ROLLBACK — live rows are untouched. The seed-NULL invariant
-- itself is proven hermetically via col_hasnt_default (below), not by live rows.
-- [[prc-ops-guard-trip-map]] live-data-red class.
update public.worker_level_rates set entered_rate = null;
update public.labor_wht_config    set wht_pct = 3.00 where id = true;

-- ============================================================================
-- A. Seed + schema (owner).
-- ============================================================================
select has_table('public'::name, 'worker_level_rates'::name, 'worker_level_rates table exists');
select has_table('public'::name, 'labor_wht_config'::name, 'labor_wht_config table exists');
select is(
  (select count(*)::int from public.worker_level_rates),
  (select count(*)::int from unnest(enum_range(null::public.worker_level))),
  'one seeded row per worker_level value (tracks the enum, not a hardcoded 4)');
select is(
  (select wht_basis::text from public.worker_level_rates where level = 'senior'),
  'before_wht', 'senior seeds before_wht (gross)');
select is(
  (select wht_basis::text from public.worker_level_rates where level = 'junior'),
  'after_wht', 'junior seeds after_wht (net)');
-- Seed-NULL invariant, hermetic: the column carries NO default, so a seeded
-- level row starts NULL and the PM must fill it — never a hardcoded rate (ADR
-- 0082). Asserted on the schema, not on (now PM-filled) live rows.
select col_hasnt_default('public'::name, 'worker_level_rates'::name, 'entered_rate'::name,
  'entered_rate has no column default — a seeded level starts NULL (PM fills, never hardcoded)');
select is(
  (select count(*)::int from public.labor_wht_config),
  1, 'labor_wht_config is a singleton (1 row)');
select is(
  (select wht_pct from public.labor_wht_config where id = true),
  3.00, 'firm WHT % seeds 3.00');

-- ============================================================================
-- B. level_gross_rate math (owner; direct updates set the state).
-- ============================================================================
select ok(
  public.level_gross_rate('senior') is null,
  'an unset rate grosses to NULL');

update public.worker_level_rates set entered_rate = 1000, wht_basis = 'before_wht' where level = 'senior';
select is(
  public.level_gross_rate('senior'),
  1000.00, 'before_wht: gross = entered (WHT % irrelevant)');

update public.worker_level_rates set entered_rate = 970, wht_basis = 'after_wht' where level = 'junior';
select is(
  public.level_gross_rate('junior'),
  1000.00, 'after_wht @3%: gross = 970 / 0.97 = 1000.00');

update public.labor_wht_config set wht_pct = null where id = true;
select is(
  public.level_gross_rate('junior'),
  970.00, 'after_wht with NULL firm % → 0% gross-up → gross = entered');

-- ============================================================================
-- C. Write gates + validation (authenticated + jwt; reset role after).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "71000000-0314-0314-0314-710000000314"}';
select throws_ok(
  $$ select public.set_level_rate('senior'::public.worker_level, 1, 'before_wht'::public.wht_basis) $$,
  '42501', null, 'a visitor cannot set a level rate');
select throws_ok(
  $$ select public.set_labor_wht_pct(1) $$,
  '42501', null, 'a visitor cannot set the firm WHT %');

-- a sub with NO public.users row → current_user_role() is null → the gate's null branch
-- (must NOT open — the RLS self-check coalesce trap, memory rls-self-check-coalesce).
set local "request.jwt.claims" = '{"sub": "79999999-0314-0314-0314-790000000314"}';
select throws_ok(
  $$ select public.set_level_rate('senior'::public.worker_level, 1, 'before_wht'::public.wht_basis) $$,
  '42501', null, 'a null-role session (no users row) cannot set a level rate');

set local "request.jwt.claims" = '{"sub": "70000000-0314-0314-0314-700000000314"}';
select throws_ok(
  $$ select public.set_level_rate('mid'::public.worker_level, -5, 'after_wht'::public.wht_basis) $$,
  'P0001', null, 'a negative rate is refused');
select throws_ok(
  $$ select public.set_labor_wht_pct(120) $$,
  'P0001', null, 'WHT % >= 100 is refused');
select throws_ok(
  $$ select public.set_labor_wht_pct(-1) $$,
  'P0001', null, 'WHT % < 0 is refused');

-- ============================================================================
-- D. Successful writes (pm/super) verified as owner.
-- ============================================================================
select lives_ok(
  $$ select public.set_level_rate('mid'::public.worker_level, 800, 'after_wht'::public.wht_basis) $$,
  'procurement_manager sets the mid rate');
set local "request.jwt.claims" = '{"sub": "75000000-0314-0314-0314-750000000314"}';
select lives_ok(
  $$ select public.set_labor_wht_pct(5.00) $$,
  'super_admin sets the firm WHT %');
reset role;

select is(
  (select entered_rate from public.worker_level_rates where level = 'mid'),
  800.00, 'set_level_rate persisted the mid rate');
select ok(
  exists(select 1 from public.audit_log
          where target_table = 'worker_level_rates' and payload->>'op' = 'set_level_rate'),
  'set_level_rate wrote an audit_log row');
select is(
  (select wht_pct from public.labor_wht_config where id = true),
  5.00, 'set_labor_wht_pct persisted the firm %');
select ok(
  exists(select 1 from public.audit_log
          where target_table = 'labor_wht_config' and payload->>'op' = 'set_labor_wht_pct'),
  'set_labor_wht_pct wrote an audit_log row');
select is(
  (select count(*)::int from public.labor_wht_config),
  1, 'labor_wht_config stays a singleton after a write');

-- ============================================================================
-- E. Zero-grant: authenticated cannot read the money columns (42501).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0314-0314-0314-700000000314"}';
select throws_ok(
  $$ select entered_rate from public.worker_level_rates limit 1 $$,
  '42501', null, 'authenticated cannot read worker_level_rates.entered_rate (money)');
select throws_ok(
  $$ select wht_pct from public.labor_wht_config limit 1 $$,
  '42501', null, 'authenticated cannot read labor_wht_config.wht_pct (money)');
select is(
  (select wht_basis::text from public.worker_level_rates where level = 'senior'),
  'before_wht', 'authenticated CAN read the non-money columns (level/basis)');
reset role;

select * from finish();
rollback;
