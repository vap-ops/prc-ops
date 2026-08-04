-- Spec 391 U1b — the derived arm was showing a WP its OWN photos.
--
-- 🔴 Measured on live data before this migration: all 144 complete, mapped leaf
-- WPs returned examples, and **403 of 403 of those photos were the WP's own** —
-- rendered in ตัวอย่างงาน directly above the same photos in the WP's own gallery.
-- Zero cross-project content anywhere, which is the feature's entire purpose.
--
-- The reader could not tell, because it only ever knew the catalog ITEM. So it
-- now takes the viewing WP as well and excludes it.
--
-- ⚠️ THIS DROPS THE 1-ARG FORM, deliberately, and 075898's own comment argued
-- against a second argument. That argument was about an accidental OVERLOAD —
-- `create or replace` with a new signature leaves the old body in place and the
-- shipped caller silently bound to it. Dropping first is what makes a second
-- argument safe: a 1-arg call then resolves to this function through the
-- DEFAULT, so `reference-photo-section.tsx` keeps working unchanged while the
-- page that knows its own WP id can pass it.
-- `389-wp-catalog.test.sql`'s three literal-signature assertions move to the new
-- signature in the same PR — a deliberate guard update, not a weakening.
--
-- Also folded in, all found by the U1 review:
--   * the missing table-level revoke (RLS-with-no-policies was asserted, not
--     enforced — the default grant was still there);
--   * the rework-round max counted tombstones and superseded rows, so a WP could
--     silently contribute nothing;
--   * ordering used upload time, against the repo's own documented display rule.

-- The house revoke. Every sibling zero-grant table does this explicitly, which
-- is only meaningful because Supabase's default grant exists: RLS with no
-- policies denies DML today, but the day anyone adds a read policy for a
-- hide-admin surface, a leaked INSERT/DELETE would go live and bypass the PD
-- gate in hide_reference_photo.
revoke all on public.wp_catalog_hidden_reference_photos from anon, authenticated;

drop function if exists public.get_wp_reference_photos(uuid);

create or replace function public.get_wp_reference_photos(
  p_wp_catalog_item_id uuid,
  p_exclude_work_package_id uuid default null
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
      and not exists (select 1 from public.photo_logs n where n.superseded_by = p.id)
      and p.storage_path is not null
      and not exists (select 1 from hidden h where h.photo_log_id = p.id)
      -- A star is a deliberate human act, so it is honoured even on the viewing
      -- WP's own photo: the PD chose that photo as the example for this work
      -- type, and silently dropping it would make their star look broken.
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
           -- ADR 0039's offline queue flushes hours to days late, so upload time
           -- is not capture time. `src/lib/photos/current-photos.ts` sets the
           -- display rule for every other photo surface in the app; match it, or
           -- a photo taken Monday and uploaded Thursday outranks one genuinely
           -- newer — and at a cap of 4 it evicts it.
           coalesce(p.captured_at_client, p.created_at) as sort_at
    from public.photo_logs p
    join public.work_packages w on w.id = p.work_package_id
    join public.projects pr on pr.id = w.project_id
    where w.wp_catalog_item_id = p_wp_catalog_item_id
      and w.status = 'complete'
      -- 🔴 THE FIX. Without this a completed WP is its own best example: its
      -- photos are the item's newest, so they take all 4 slots and the section
      -- duplicates the gallery immediately below it.
      and (p_exclude_work_package_id is null or w.id <> p_exclude_work_package_id)
      -- ⓘ No is_group filter: `photo_logs_reject_group_wp` (BEFORE INSERT),
      -- `photo_logs_block_update` (append-only) and `is_group` immutability
      -- together make a group-owned photo unreachable. Three guarantees, pinned
      -- in 391's pgTAP so relaxing any of them reds this unit.
      and p.phase in ('after', 'after_fix')
      and p.storage_path is not null
      and not exists (select 1 from public.photo_logs n where n.superseded_by = p.id)
      and not exists (select 1 from hidden h where h.photo_log_id = p.id)
      -- ⚠️ INERT TODAY — every live photo_logs row is at round 0. Kept because
      -- photoReworkRoundFor stamps after_fix/defect with the WP's round, so the
      -- first real send-back is when this stops the REJECTED `after` photo
      -- standing as the example.
      -- The max must ignore tombstones and superseded rows: buildTombstoneRow
      -- COPIES the target's phase and rework_round, so a removed round-1 photo
      -- would otherwise hold the max at 1 and disqualify every surviving round-0
      -- photo — the WP would contribute nothing at all.
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
