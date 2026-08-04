-- Spec 391 U2b — the starred arm had the SAME bug U1b fixed in the derived one,
-- and the shipped UI can only ever create the case that triggers it.
--
-- 🔴 The argument I used in 075899 to exempt stars ("a PD chose this photo, and
-- dropping it would make their star look broken") does not survive the call
-- graph. The ⭐ control renders ONLY on `/review/work-packages/[id]`
-- (`starring` is set nowhere else — verified), and `star_reference_photo`
-- derives the catalogue item from the photo's OWN work package. So **every star
-- the application can create is, by construction, a self-reference**: the PD is
-- on WP-X's review page, starring WP-X's photo, onto WP-X's item.
--
-- Consequence, on exactly the WPs a PD bothered to curate: 4 stars fill tier 0,
-- `limit 4` consumes every slot, the derived arm returns nothing renderable, and
-- ตัวอย่างงาน becomes 100% the WP's own photos sitting directly above the same
-- photos in its own gallery — the 403-of-403 state U1b exists to end. Worse, the
-- subtitle then flips to its all-starred branch and puts the PD's name to it, so
-- the duplicate gallery carries an endorsement.
--
-- And the premise was false anyway: the star's visible result is the gold star on
-- the review tile at the moment of the tap (`reference-star-button.tsx`
-- `fill-attn-edge`). Excluding the viewing WP from tier 0 takes nothing away from
-- that feedback — the star still ranks the photo first on every OTHER work
-- package of its type, which is the only place an example is useful.
--
-- Three changes:
--   ① the exclusion applies to BOTH arms, symmetrically;
--   ② the starred arm gains `w.status = 'complete'`. It had none, and `/review`
--      is a pending_approval surface — so a star is always applied to work that
--      is not finished yet. The section's subtitle says ทำเสร็จแล้ว ("finished"),
--      which was false for any starred photo whose WP never completed. Same lie
--      class as the one D8 was written to kill, relocated from WHO CHOSE it to
--      WHAT STATE it is in. The star now activates when the WP completes.
--   ③ p_exclude_work_package_id becomes REQUIRED. With a default, omitting it is
--      silent — PostgREST happily resolves the 1-arg call and returns the
--      un-excluded set, so a future caller reintroduces the bug with a green
--      suite. Without a default the same mistake is a hard PGRST202. Every
--      caller is one I control (one component, this spec's pgTAP), so the
--      default bought nothing and hid a regression.

drop function if exists public.get_wp_reference_photos(uuid, uuid);

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
      -- ① never your own photos, in EITHER arm.
      and w.id <> p_exclude_work_package_id
      -- ② the section claims finished work; a star is applied on a review page,
      --    i.e. always before the WP is complete.
      and w.status = 'complete'
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
      -- ⚠️ INERT TODAY (all live rows are round 0). Kept for the first real
      -- send-back, when photoReworkRoundFor stamps after_fix with the WP's round
      -- and this is what stops the REJECTED `after` photo standing as the example.
      -- ⓘ Correction to 075899's comment, which credited the wrong clause: the
      -- row that would hold the max at 1 is the SUPERSEDED TARGET, removed by the
      -- anti-join below — not the tombstone, which `storage_path is not null`
      -- already excluded. Both predicates are needed; the earlier note explained
      -- one with the other's mechanism, which is §7.2's own lesson recurring.
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

-- Narrow the hidden table's read to the ONE column `/review` selects. The repo
-- has this idiom (spec 367's column-granted table, 380's column-level inserts);
-- 075900 argued from "nothing here to protect" rather than from need, which is
-- the weaker form of the same decision. `hidden_by` / `created_at` — who
-- suppressed what, and when — stay closed.
revoke select on public.wp_catalog_hidden_reference_photos from authenticated;
grant select (photo_log_id) on public.wp_catalog_hidden_reference_photos to authenticated;
