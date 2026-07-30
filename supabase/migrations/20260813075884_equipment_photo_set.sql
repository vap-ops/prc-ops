-- Spec 382 U1 — four photos per equipment item.
--
-- Operator, 2026-07-30: รูปอุปกรณ์ · เพลทเลขเครื่อง (serial legible) · ยี่ห้อ ·
-- **QR ของเรา** (our spec-370 sticker, photographed ON the machine — proof the tag
-- was applied and the link between the printed label and this row).
--
-- Shipped BEFORE the refill on purpose: `equipment_items` is at 0 rows, so this is
-- a shape change with no backfill and no half-documented fleet. A week later the
-- same change costs a migration plus a chase list.
--
-- Decisions (with the operator): ONE photo per kind, replaceable — so "documented?"
-- stays countable; OPTIONAL, never blocking a save (a dead camera must not stall
-- the refill), with completeness surfaced as `รูป n/4`.
--
-- ⚠️ Paths do NOT change: `<itemId>/<uuid>.<ext>`, folder depth 1 — the only arm of
-- the live `equipment-images` INSERT policy that admits the back office. Adding
-- kinds must never become a storage-policy change.

create type public.equipment_photo_kind as enum ('item', 'nameplate', 'brand', 'qr_tag');

create table public.equipment_item_photos (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.equipment_items(id) on delete cascade,
  kind         public.equipment_photo_kind not null,
  storage_path text not null,
  created_by   uuid not null references public.users(id),
  created_at   timestamptz not null default now(),
  -- The invariant the n/4 chip rests on: four slots, not a gallery.
  constraint equipment_item_photos_one_per_kind unique (item_id, kind)
);

create index equipment_item_photos_item_idx on public.equipment_item_photos (item_id);

comment on table public.equipment_item_photos is
  'Spec 382 — up to four photos per equipment item (item/nameplate/brand/qr_tag), one per kind. equipment_items.image_path mirrors the ''item'' row.';

alter table public.equipment_item_photos enable row level security;

-- Audience mirrors the parent: the /equipment page audience reads (the site_admin
-- moving the tool is a legitimate reader), the back office writes. NOT
-- column-granted — unlike equipment_items, nothing here is money, and copying the
-- parent's column-grant pattern by reflex would make the table invisible to
-- PostgREST instead of merely hiding a column.
grant select, insert, update, delete on public.equipment_item_photos to authenticated;

create policy "equipment_item_photos readable by staff"
  on public.equipment_item_photos for select
  using (
    coalesce((select public.current_user_role())::text, '') = any (array[
      'site_admin','project_manager','procurement','procurement_manager',
      'super_admin','project_director'
    ])
  );

create policy "equipment_item_photos written by back office"
  on public.equipment_item_photos for insert
  with check (
    coalesce((select public.current_user_role())::text, '') = any (array[
      'project_manager','procurement','procurement_manager','super_admin','project_director'
    ])
  );

create policy "equipment_item_photos updated by back office"
  on public.equipment_item_photos for update
  using (
    coalesce((select public.current_user_role())::text, '') = any (array[
      'project_manager','procurement','procurement_manager','super_admin','project_director'
    ])
  );

create policy "equipment_item_photos deleted by back office"
  on public.equipment_item_photos for delete
  using (
    coalesce((select public.current_user_role())::text, '') = any (array[
      'project_manager','procurement','procurement_manager','super_admin','project_director'
    ])
  );

-- ---------------------------------------------------------------------------
-- The mirror (spec 382 D4).
--
-- `equipment_items.image_path` stays the item's thumbnail pointer because three
-- existing readers depend on it — the CSV export's `hasImage`, the /equipment page
-- thumbnail, and the spec-367 U1 pgTAP pins. Rather than rewrite all three, the
-- new table stays the SSOT and the column is kept in step here, by one writer.
--
-- Two consequences worth stating:
--   - ONLY the `item` kind mirrors. A nameplate is not the machine's picture.
--   - a DELETE clears it. A thumbnail pointing at a deleted object is worse than
--     no thumbnail.
-- It also means an item-photo swap lands in the spec-381 history for free: that
-- audit trigger already diffs `image_path`.
--
-- SECURITY DEFINER for the same reason as spec 381's writer: this updates
-- equipment_items, whose UPDATE policy admits only the back office — and a
-- future widening of who may attach photos should not silently start failing here.
-- ---------------------------------------------------------------------------
create or replace function public.equipment_item_photo_mirror()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'item' then
      update public.equipment_items
         set image_path = null
       where id = old.item_id;
    end if;
    return null;
  end if;

  if new.kind = 'item' then
    update public.equipment_items
       set image_path = new.storage_path
     where id = new.item_id;
  end if;
  return null;
end;
$$;

revoke all on function public.equipment_item_photo_mirror() from public, anon;

create trigger equipment_item_photos_mirror
  after insert or update or delete on public.equipment_item_photos
  for each row
  execute function public.equipment_item_photo_mirror();
