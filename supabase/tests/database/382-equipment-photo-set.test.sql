-- Spec 382 U1 — four photos per equipment item.
--
-- What this pins, in the order the traps actually bite:
--
--   1. ONE row per (item, kind) — the whole "รูป n/4" model rests on it. Without
--      the unique index, "documented?" stops being a countable question.
--   2. The `item` kind MIRRORS into equipment_items.image_path (D4). The CSV
--      export's hasImage, the page thumbnail and the spec-367 pins all read that
--      column; if the mirror breaks they silently report an item as image-less
--      while its photo sits in the new table.
--   3. Deleting a photo row must CLEAR the mirror, not leave a dangling path —
--      a thumbnail pointing at a deleted photo is worse than no thumbnail.
--   4. The other three kinds must NOT touch image_path. A nameplate is not the
--      item's picture, and mirroring it would put the wrong image on the row.
--
-- Note on grants: unlike its parent, this table has no money columns, so it takes
-- ordinary table grants. Section A pins that authenticated can read it at all —
-- equipment_items is column-granted, and copying that pattern here by reflex
-- would make the whole table invisible to PostgREST.

begin;
select plan(11);

-- principals
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000f201','photoset-proc@t.local','{}'::jsonb);
update public.users set role='procurement' where id='00000000-0000-0000-0000-00000000f201';

insert into public.equipment_categories (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000f202','ทดสอบชุดรูป','00000000-0000-0000-0000-00000000f201');
insert into public.equipment_owners (id, name, created_by) values
  ('00000000-0000-0000-0000-00000000f203','ทดสอบเจ้าของชุดรูป','00000000-0000-0000-0000-00000000f201');
insert into public.equipment_items
  (id, name, category_id, owner_id, tracking, status, created_by) values
  ('00000000-0000-0000-0000-00000000f204','เครื่องทดสอบชุดรูป',
   '00000000-0000-0000-0000-00000000f202','00000000-0000-0000-0000-00000000f203',
   'unit','available','00000000-0000-0000-0000-00000000f201');

-- ============================================================================
-- A. Shape.
-- ============================================================================
select has_table('public', 'equipment_item_photos', 'equipment_item_photos exists');

select has_type('public', 'equipment_photo_kind', 'equipment_photo_kind enum exists');
select enum_has_labels('public', 'equipment_photo_kind',
  array['item', 'nameplate', 'brand', 'qr_tag'],
  'the four kinds the operator asked for, and only those');

-- The parent is COLUMN-granted (money). This one must not be, or PostgREST
-- refuses the whole read and every slot renders empty.
select is(
  has_table_privilege('authenticated', 'public.equipment_item_photos', 'SELECT'),
  true,
  'authenticated may read the photo set'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.equipment_item_photos'::regclass),
  true,
  'RLS is enabled'
);

-- ============================================================================
-- B. One per kind — the invariant the n/4 chip depends on.
-- ============================================================================
insert into public.equipment_item_photos (item_id, kind, storage_path, created_by) values
  ('00000000-0000-0000-0000-00000000f204','item',
   '00000000-0000-0000-0000-00000000f204/a.jpeg','00000000-0000-0000-0000-00000000f201');

select throws_ok(
  $$ insert into public.equipment_item_photos (item_id, kind, storage_path, created_by)
     values ('00000000-0000-0000-0000-00000000f204','item',
             '00000000-0000-0000-0000-00000000f204/b.jpeg',
             '00000000-0000-0000-0000-00000000f201') $$,
  '23505',
  null,
  'a second photo of the same kind is refused (replace, do not accumulate)'
);

-- A DIFFERENT kind on the same item is exactly what we want, though — the
-- positive control that the unique index is on the PAIR, not on item_id.
select lives_ok(
  $$ insert into public.equipment_item_photos (item_id, kind, storage_path, created_by)
     values ('00000000-0000-0000-0000-00000000f204','nameplate',
             '00000000-0000-0000-0000-00000000f204/c.jpeg',
             '00000000-0000-0000-0000-00000000f201') $$,
  'a different kind on the same item is allowed'
);

-- ============================================================================
-- C. The image_path mirror (D4).
-- ============================================================================
select is(
  (select image_path from public.equipment_items
    where id = '00000000-0000-0000-0000-00000000f204'),
  '00000000-0000-0000-0000-00000000f204/a.jpeg',
  'the item kind mirrors into equipment_items.image_path'
);

-- The nameplate inserted above must NOT have moved the mirror.
select is(
  (select image_path from public.equipment_items
    where id = '00000000-0000-0000-0000-00000000f204'),
  '00000000-0000-0000-0000-00000000f204/a.jpeg',
  'a nameplate photo does NOT become the item thumbnail'
);

update public.equipment_item_photos
   set storage_path = '00000000-0000-0000-0000-00000000f204/replaced.jpeg'
 where item_id = '00000000-0000-0000-0000-00000000f204' and kind = 'item';

select is(
  (select image_path from public.equipment_items
    where id = '00000000-0000-0000-0000-00000000f204'),
  '00000000-0000-0000-0000-00000000f204/replaced.jpeg',
  'replacing the item photo repoints the mirror'
);

delete from public.equipment_item_photos
 where item_id = '00000000-0000-0000-0000-00000000f204' and kind = 'item';

select is(
  (select image_path from public.equipment_items
    where id = '00000000-0000-0000-0000-00000000f204'),
  null,
  'deleting the item photo CLEARS the mirror (no dangling thumbnail path)'
);

select * from finish();
rollback;
