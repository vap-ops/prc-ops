-- Spec 391 U2b (correction) — take the `w.status = 'complete'` filter back OFF
-- the starred arm.
--
-- 075901 added it to make the subtitle's ทำเสร็จแล้ว claim true. The claim was
-- indeed false, but this was the wrong end to fix it, and pgTAP said so
-- immediately: FIVE assertions in `389-wp-catalog.test.sql` went red, because
-- spec 389 U5 deliberately shipped "a star surfaces cross-project" with no
-- status condition, and its tests encode that contract on purpose.
--
-- The filter also has a consequence I had not thought through. The ⭐ lives on
-- `/review`, which is a pending_approval surface — so a star is ALWAYS applied
-- before the WP is finished. With the filter, a PD stars a photo and sees
-- nothing happen anywhere; the example only appears if and when the WP is later
-- approved. That is a defensible design, but it is a change to another spec's
-- shipped behaviour, and it is not mine to make inside a follow-up migration.
--
-- So the copy carries the correction instead: the subtitle no longer asserts
-- ทำเสร็จแล้ว over a set whose starred half has no completion condition. The
-- derived half still requires `complete` — that filter stays where it belongs.
--
-- ⚠️ Recorded for whoever revisits this: "should a star only count once the WP
-- is approved?" is a real question with a real answer either way. It belongs to
-- spec 389's owner as a deliberate change, with 389's five assertions updated in
-- the same breath — not smuggled in as a hardening.

create or replace function public.get_wp_reference_photos(
  p_wp_catalog_item_id uuid,
  p_exclude_work_package_id uuid
)
returns table (
  photo_log_id uuid,
  storage_path text,
  phase public.photo_phase,
  project_name text,
  note text,
  starred_by uuid,
  starred_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with hidden as (
    select h.photo_log_id from public.wp_catalog_hidden_reference_photos h
  ),
  starred as (
    select p.id       as photo_log_id,
           p.storage_path,
           p.phase,
           pr.name    as project_name,
           s.note,
           s.starred_by,
           s.created_at as starred_at,
           0          as tier,
           s.created_at as sort_at
    from public.wp_catalog_reference_photos s
    join public.photo_logs p on p.id = s.photo_log_id
    join public.work_packages w on w.id = p.work_package_id
    join public.projects pr on pr.id = w.project_id
    where s.wp_catalog_item_id = p_wp_catalog_item_id
      -- KEPT from 075901, and the important half: never your own photos, in
      -- EITHER arm. Every star the UI can create is a self-reference (the ⭐ only
      -- renders on /review and stars the photo's own WP), so without this a
      -- curated WP shows 4 of its own photos above its own gallery.
      and w.id <> p_exclude_work_package_id
      -- NO status filter here — see the header. Spec 389's contract.
      and not exists (select 1 from public.photo_logs n where n.superseded_by = p.id)
      and p.storage_path is not null
      and not exists (select 1 from hidden h where h.photo_log_id = p.id)
  ),
  derived as (
    select p.id       as photo_log_id,
           p.storage_path,
           p.phase,
           pr.name    as project_name,
           null::text as note,
           null::uuid as starred_by,
           null::timestamptz as starred_at,
           1          as tier,
           coalesce(p.captured_at_client, p.created_at) as sort_at
    from public.photo_logs p
    join public.work_packages w on w.id = p.work_package_id
    join public.projects pr on pr.id = w.project_id
    where w.wp_catalog_item_id = p_wp_catalog_item_id
      and w.status = 'complete'
      and w.id <> p_exclude_work_package_id
      and p.phase in ('after', 'after_fix')
      and p.storage_path is not null
      and not exists (select 1 from public.photo_logs n where n.superseded_by = p.id)
      and not exists (select 1 from hidden h where h.photo_log_id = p.id)
      and p.rework_round = (
        select max(p2.rework_round)
        from public.photo_logs p2
        where p2.work_package_id = w.id
          and p2.phase in ('after', 'after_fix')
          and p2.storage_path is not null
          and not exists (select 1 from public.photo_logs n2 where n2.superseded_by = p2.id)
      )
      and not exists (select 1 from starred s2 where s2.photo_log_id = p.id)
  )
  select t.photo_log_id, t.storage_path, t.phase, t.project_name, t.note,
         t.starred_by, t.starred_at
  from (select * from starred union all select * from derived) t
  order by t.tier, t.sort_at desc
  limit 4;
$function$;

revoke all on function public.get_wp_reference_photos(uuid, uuid) from public, anon;
grant execute on function public.get_wp_reference_photos(uuid, uuid) to authenticated;
