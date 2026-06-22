-- Spec 175 U4 — one reference image per catalog item.
--
-- Mirrors the photos-bucket posture (20260524040000): a PRIVATE bucket, uploads
-- governed by a role-gated INSERT policy on storage.objects, NO SELECT policy
-- (reads go through service-role-minted signed URLs — mintSignedUrls). Uploads
-- are gated to the back-office curators (pm/super/procurement/director), matching
-- who may edit the catalog. catalog_items.image_path stores the object PATH
-- (not a URL); set_catalog_item_image is the controlled write (the table has no
-- UPDATE grant). Replacing an image repoints image_path; the old object is LEFT
-- in the bucket (retain-originals; orphan cleanup is a later concern).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog-images',
  'catalog-images',
  false,
  26214400,   -- 25 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "catalog-images uploads by back-office"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'catalog-images'
    and public.current_user_role() in (
      'project_manager', 'super_admin', 'procurement', 'project_director'
    )
  );

-- image_path inherits catalog_items' table-level SELECT grant (no column-level
-- grants on this table), so authenticated reads it; signing happens server-side.
alter table public.catalog_items add column image_path text;

-- set_catalog_item_image — attach / replace / clear (p_image_path null) the
-- item's reference image. Back-office only; unknown id → 22023. The image bytes
-- are uploaded client-side to the catalog-images bucket first; this records the
-- resulting path.
create function public.set_catalog_item_image(
  p_id         uuid,
  p_image_path text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text := nullif(btrim(coalesce(p_image_path, '')), '');
  v_n    integer;
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'set_catalog_item_image: role not permitted' using errcode = '42501';
  end if;
  if v_path is not null and length(v_path) > 300 then
    raise exception 'set_catalog_item_image: path too long' using errcode = '22023';
  end if;

  update public.catalog_items set image_path = v_path where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'set_catalog_item_image: unknown item' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_catalog_item_image(uuid, text) from public, anon;
grant execute on function public.set_catalog_item_image(uuid, text) to authenticated;

comment on function public.set_catalog_item_image(uuid, text) is
  'Spec 175 U4 — set / clear a catalog item reference image path (back-office). Unknown id → 22023. Bytes live in the catalog-images bucket.';
