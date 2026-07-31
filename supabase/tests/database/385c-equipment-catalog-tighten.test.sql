-- Spec 385 U4 — the tightened SKU model: no SKU-less instance can exist, and a
-- bulk SKU owns exactly one row AT THE DB LEVEL (the U2 app-code rule survives
-- a race only because this index exists).

begin;
select plan(4);

-- fixtures (RLS bypassed for setup)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000e401','tighten@t.local','{}'::jsonb);
insert into public.equipment_categories (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000e402','ทดสอบหมวดไทเทน','00000000-0000-0000-0000-00000000e401');
insert into public.equipment_owners (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000e403','ทดสอบเจ้าของไทเทน','00000000-0000-0000-0000-00000000e401');
insert into public.equipment_catalog_items (id, name, category_id, default_tracking, created_by) values
  ('00000000-0000-0000-0000-00000000e404','สายยางไทเทน',
   '00000000-0000-0000-0000-00000000e402','bulk','00000000-0000-0000-0000-00000000e401');

select col_not_null('public', 'equipment_items', 'equipment_catalog_item_id',
  'every instance carries its SKU — the FK is NOT NULL');

select throws_ok($$
  insert into public.equipment_items (name, category_id, owner_id, tracking, status, created_by)
  values ('กำพร้า', '00000000-0000-0000-0000-00000000e402',
          '00000000-0000-0000-0000-00000000e403', 'unit', 'available',
          '00000000-0000-0000-0000-00000000e401')
$$, '23502', null, 'an instance without a SKU is refused at the column');

-- the bulk one-row rule, DB level: first row lands, the twin 23505s.
insert into public.equipment_items
  (name, category_id, owner_id, tracking, quantity, status, created_by, equipment_catalog_item_id)
values ('สายยางไทเทน', '00000000-0000-0000-0000-00000000e402',
        '00000000-0000-0000-0000-00000000e403', 'bulk', 3, 'available',
        '00000000-0000-0000-0000-00000000e401', '00000000-0000-0000-0000-00000000e404');

select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'public' and tablename = 'equipment_items'
      and indexname = 'equipment_items_bulk_one_row_per_sku'),
  1,
  'the bulk partial unique index exists'
);

select throws_ok($$
  insert into public.equipment_items
    (name, category_id, owner_id, tracking, quantity, status, created_by, equipment_catalog_item_id)
  values ('สายยางไทเทน', '00000000-0000-0000-0000-00000000e402',
          '00000000-0000-0000-0000-00000000e403', 'bulk', 5, 'available',
          '00000000-0000-0000-0000-00000000e401', '00000000-0000-0000-0000-00000000e404')
$$, '23505', null, 'a second bulk row for the same SKU is refused BY THE INDEX — the race is closed');

select * from finish();
rollback;
