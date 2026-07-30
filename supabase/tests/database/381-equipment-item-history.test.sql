-- Spec 381 U1 — per-item equipment history: the audit trigger that finally makes
-- item edits traceable, and the DEFINER RPC that lets the people who own the
-- equipment actually read the trail.
--
-- The two live findings this file exists to pin (both checked 2026-07-30, both
-- would have shipped as runtime failures otherwise):
--
--   1. `authenticated` holds SELECT-ONLY on audit_log — no INSERT grant, no INSERT
--      policy. A trigger runs as the invoking user, so an ordinary trigger writing
--      audit_log would raise 42501 and ABORT THE USER'S EDIT. Hence SECURITY
--      DEFINER, asserted in section A.
--   2. audit_log SELECT admits only super_admin/PD/accounting/PM (plus a two-event
--      wp-rework arm for site_admin/procurement/procurement_manager). So
--      procurement — who curates the registry — cannot read one equipment audit
--      row directly. Hence the DEFINER read RPC, and hence section D asserts a
--      procurement caller really does get rows back.
--
-- Section E is the money wall (ADR 0055 decision 6) in the NEGATIVE direction:
-- rate events are OMITTED, not redacted, for a non-money caller — a visible
-- "rate changed" line still discloses that the asset is priced.

begin;
select plan(14);

-- principals
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000e101','hist-proc@t.local','{}'::jsonb),
  ('00000000-0000-0000-0000-00000000e102','hist-sa@t.local','{}'::jsonb);
update public.users set role='procurement'  where id='00000000-0000-0000-0000-00000000e101';
update public.users set role='site_admin'   where id='00000000-0000-0000-0000-00000000e102';

-- fixture registry (RLS bypassed for setup)
insert into public.equipment_categories (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000e103','ทดสอบประวัติ','00000000-0000-0000-0000-00000000e101');
insert into public.equipment_owners (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000e104','ทดสอบเจ้าของประวัติ','00000000-0000-0000-0000-00000000e101');
insert into public.equipment_items
  (id, name, category_id, owner_id, tracking, status, created_by) values
  ('00000000-0000-0000-0000-00000000e105','สว่านทดสอบ',
   '00000000-0000-0000-0000-00000000e103','00000000-0000-0000-0000-00000000e104',
   'unit','available','00000000-0000-0000-0000-00000000e101');

-- ============================================================================
-- A. The writer exists and can actually write.
-- ============================================================================
select has_function('public', 'equipment_item_audit', 'the audit trigger function exists');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'equipment_item_audit'),
  true,
  'equipment_item_audit is SECURITY DEFINER (authenticated has no INSERT on audit_log)'
);

select is(
  (select count(*)::int from pg_trigger
    where tgrelid = 'public.equipment_items'::regclass
      and tgname = 'equipment_items_audit_update'
      and not tgisinternal),
  1,
  'the AFTER UPDATE trigger is installed on equipment_items'
);

select ok(
  (select 'equipment_item_updated' = any (enum_range(null::public.audit_action)::text[])),
  'audit_action gained equipment_item_updated'
);

-- ============================================================================
-- B. The reader exists, is definer, and is not open to the world.
-- ============================================================================
select has_function('public', 'equipment_item_history', array['uuid'],
  'equipment_item_history(uuid) exists');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'equipment_item_history'),
  true,
  'equipment_item_history is SECURITY DEFINER (audit_log SELECT excludes its audience)'
);

-- has_function_privilege resolves PUBLIC through role inheritance; the
-- information_schema view does not carry a PUBLIC arm at all (the 363-U2a trap).
select is(
  has_function_privilege('anon', 'public.equipment_item_history(uuid)', 'EXECUTE'),
  false,
  'anon may NOT execute equipment_item_history'
);
select is(
  has_function_privilege('authenticated', 'public.equipment_item_history(uuid)', 'EXECUTE'),
  true,
  'authenticated may execute it (the RPC does its own role gate inside)'
);

-- ============================================================================
-- C. The trigger records WHAT CHANGED — and stays quiet when nothing did.
-- ============================================================================
update public.equipment_items
   set name = 'สว่านทดสอบ (แก้ชื่อ)'
 where id = '00000000-0000-0000-0000-00000000e105';

select is(
  (select count(*)::int from public.audit_log
    where target_table = 'equipment_items'
      and target_id = '00000000-0000-0000-0000-00000000e105'
      and action = 'equipment_item_updated'),
  1,
  'one edit writes exactly one audit row'
);

select is(
  (select payload -> 'changes' -> 'name' ->> 'to' from public.audit_log
    where target_table = 'equipment_items'
      and target_id = '00000000-0000-0000-0000-00000000e105'
      and action = 'equipment_item_updated'
    order by created_at desc limit 1),
  'สว่านทดสอบ (แก้ชื่อ)',
  'the payload carries the new value for the field that changed'
);

-- Only the changed field: a whole-row snapshot would put daily_rate (money) into
-- a payload this spec hands to a non-money audience.
select is(
  (select count(*)::int from jsonb_object_keys(
     (select payload -> 'changes' from public.audit_log
       where target_table = 'equipment_items'
         and target_id = '00000000-0000-0000-0000-00000000e105'
         and action = 'equipment_item_updated'
       order by created_at desc limit 1))),
  1,
  'only the changed field is recorded, not the whole row'
);

-- A no-op UPDATE must not manufacture history.
update public.equipment_items
   set name = 'สว่านทดสอบ (แก้ชื่อ)'
 where id = '00000000-0000-0000-0000-00000000e105';

select is(
  (select count(*)::int from public.audit_log
    where target_table = 'equipment_items'
      and target_id = '00000000-0000-0000-0000-00000000e105'
      and action = 'equipment_item_updated'),
  1,
  'an UPDATE that changes nothing writes no second row'
);

-- ============================================================================
-- D + E. The reader: procurement gets the trail; the money wall holds for the
-- field view. A rate event is seeded directly so the wall has something to hide.
-- ============================================================================
insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
values ('00000000-0000-0000-0000-00000000e101','procurement','equipment_rate_change',
        'equipment_items','00000000-0000-0000-0000-00000000e105',
        '{"kind":"rate_change","old_rate":null,"new_rate":250}'::jsonb);

-- allow role switches to write TAP (the _tap_buf grant trap)
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-00000000e101"}';

select ok(
  (select count(*) from public.equipment_item_history('00000000-0000-0000-0000-00000000e105')
    where kind = 'rate_change') = 1,
  'procurement (money audience) sees the rate event'
);

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-00000000e102"}';

select ok(
  (select count(*) from public.equipment_item_history('00000000-0000-0000-0000-00000000e105')
    where kind = 'rate_change') = 0
  and
  (select count(*) from public.equipment_item_history('00000000-0000-0000-0000-00000000e105')
    where kind = 'item_updated') >= 1,
  'site_admin sees the edit history but NOT the rate event (money omitted, not redacted)'
);

select * from finish();
rollback;
