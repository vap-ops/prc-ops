-- Spec 385 U3b — set_equipment_catalog_default_rate: the ทะเบียน's money seam.
--
-- `default_daily_rate` has NO authenticated grant in any direction (the U1
-- wall), so this DEFINER RPC is the ONLY app-reachable write path — the twin of
-- `set_equipment_daily_rate` at the SKU grain. What must hold:
--   * gate = is_back_office (delegated, never a restated role array — the
--     storage-RLS lesson), refusing site_admin with 42501;
--   * validation refuses a negative rate and a missing SKU with P0001;
--   * every change writes the `equipment_rate_change` audit row with
--     target_table = 'equipment_catalog_items' — the 381 item-history reader
--     filters on target_table = 'equipment_items', so catalog events can never
--     leak into a unit's history (verified live before this file was written).

begin;
select plan(11);

-- principals
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000e301','rate-pm@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-00000000e302','rate-sa@t.local','{}'::jsonb);
update public.users set role='procurement_manager' where id='00000000-0000-0000-0000-00000000e301';
update public.users set role='site_admin'          where id='00000000-0000-0000-0000-00000000e302';

-- fixture SKU (RLS bypassed for setup)
insert into public.equipment_categories (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000e303','ทดสอบหมวดเรต','00000000-0000-0000-0000-00000000e301');
insert into public.equipment_catalog_items (id, name, category_id, created_by) values
  ('00000000-0000-0000-0000-00000000e304','เครื่องทดสอบเรต',
   '00000000-0000-0000-0000-00000000e303','00000000-0000-0000-0000-00000000e301');

-- ============================================================================
-- A. Shape + exposure.
-- ============================================================================
select has_function('public', 'set_equipment_catalog_default_rate', array['uuid','numeric'],
  'set_equipment_catalog_default_rate(uuid, numeric) exists');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_equipment_catalog_default_rate'),
  true,
  'SECURITY DEFINER (the column has no authenticated grant — this IS the write path)'
);

-- has_function_privilege resolves PUBLIC through role inheritance (the 363-U2a
-- catalog-view trap).
select is(
  has_function_privilege('anon', 'public.set_equipment_catalog_default_rate(uuid, numeric)', 'EXECUTE'),
  false,
  'anon may NOT execute it'
);
select is(
  has_function_privilege('authenticated', 'public.set_equipment_catalog_default_rate(uuid, numeric)', 'EXECUTE'),
  true,
  'authenticated may execute it (the RPC does its own role gate inside)'
);

-- ============================================================================
-- B. Behaviour through real role switches.
-- ============================================================================
-- allow role switches to write TAP (the _tap_buf grant trap)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-00000000e301"}';

select lives_ok($$
  select public.set_equipment_catalog_default_rate('00000000-0000-0000-0000-00000000e304', 250)
$$, 'procurement_manager (back office) sets the default rate');

select throws_ok($$
  select public.set_equipment_catalog_default_rate('00000000-0000-0000-0000-00000000e304', -1)
$$, 'P0001', null, 'a negative rate is refused');

select throws_ok($$
  select public.set_equipment_catalog_default_rate('00000000-0000-0000-0000-00000000e999', 100)
$$, 'P0001', null, 'an unknown SKU is refused');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-00000000e302"}';

select throws_ok($$
  select public.set_equipment_catalog_default_rate('00000000-0000-0000-0000-00000000e304', 100)
$$, '42501', null, 'site_admin may NOT set a default rate (money stays back-office)');

-- The rls-self-check-coalesce arm: a caller whose sub resolves NO public.users
-- row makes current_user_role() NULL — is_back_office must coalesce that to
-- REFUSED, not let a NULL comparison open the money gate. This is the migration
-- header's hygiene claim, asserted rather than trusted (the helper is shared
-- and has been re-created twice since it was made NULL-safe).
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-00000000e999"}';

select throws_ok($$
  select public.set_equipment_catalog_default_rate('00000000-0000-0000-0000-00000000e304', 100)
$$, '42501', null, 'a roleless caller (no users row → NULL role) is refused, never NULL-slipped');

-- ============================================================================
-- C. The write landed and left its trail — read from the privileged side
-- (default_daily_rate is money-walled from authenticated).
-- ============================================================================
reset role;

select is(
  (select jsonb_build_object(
     'rate', (select default_daily_rate from public.equipment_catalog_items
               where id = '00000000-0000-0000-0000-00000000e304'),
     'audit', (select count(*) from public.audit_log
                where target_table = 'equipment_catalog_items'
                  and target_id = '00000000-0000-0000-0000-00000000e304'
                  and action = 'equipment_rate_change'))),
  '{"rate": 250, "audit": 1}'::jsonb,
  'the rate landed at 250 with exactly one equipment_rate_change audit row on the CATALOG table'
);

-- The payload SHAPE is the grain discriminator (kind) plus the numbers a future
-- reader will parse — a count-only assert would stay green while all of it
-- drifted (review find, 2026-07-31).
select is(
  (select a.payload - 'ts' from public.audit_log a
    where a.target_table = 'equipment_catalog_items'
      and a.target_id = '00000000-0000-0000-0000-00000000e304'
      and a.action = 'equipment_rate_change'
    order by a.created_at desc limit 1),
  '{"kind": "default_rate_change", "old_rate": null, "new_rate": 250}'::jsonb,
  'the audit payload carries kind/old/new exactly (old was NULL — the fixture SKU was unpriced)'
);

select * from finish();
rollback;
