-- Spec 391 U1 — ตัวอย่างงาน fills itself.
--
-- 389 U5 shipped the ⭐ and the section; both work, and the section has never
-- rendered anything because `wp_catalog_reference_photos` holds 0 rows. Filling
-- it was a manual act nobody performed. This adds a DERIVED arm to the reader —
-- no rows written, so every future completion is covered for free (a backfill
-- would be a snapshot and the hole would re-open next month).
--
-- ⚠️ THE SIGNATURE IS UNCHANGED, DELIBERATELY. A second argument would create an
-- OVERLOAD rather than a replacement, and the shipped 1-arg caller
-- (`reference-photo-section.tsx`) would stay bound to the old body forever —
-- rendering no derived photo while every new test passed. It also keeps 389's
-- three grant assertions meaningful.
--
-- ⚠️ HIDING GETS ITS OWN TABLE, and that is forced, not stylistic:
--   * `wp_catalog_reference_photos.starred_by` is NOT NULL, so a hide-only row
--     (a photo nobody starred) has nothing to put there; and
--   * the shipped `unstar_reference_photo` deletes by `photo_log_id` with NO
--     guard, so a shared table would let un-starring silently delete a hide.
-- The separate table also makes "starring and hiding are different acts"
-- structural rather than a comment. Pinned in 391's pgTAP.

create table if not exists public.wp_catalog_hidden_reference_photos (
  photo_log_id uuid primary key references public.photo_logs (id) on delete cascade,
  hidden_by    uuid not null references public.users (id),
  created_at   timestamptz not null default now()
);

comment on table public.wp_catalog_hidden_reference_photos is
  'Spec 391 — photos a PD has suppressed as ตัวอย่างงาน. Keyed by photo alone: a '
  'photo belongs to one WP and therefore one catalog item, so there is no item '
  'column to get out of step. Separate from wp_catalog_reference_photos because '
  'starred_by is NOT NULL there and unstar_reference_photo deletes by photo id '
  'without a guard.';

-- Zero-grant table: RLS on, no policies, no grants. Every read and write goes
-- through the SECURITY DEFINER functions below, which carry the role gate.
alter table public.wp_catalog_hidden_reference_photos enable row level security;

-- ---------------------------------------------------------------------------
-- hide / unhide — PD tier, mirroring star_reference_photo's null-safe gate and
-- its 22023 refusals so the two controls answer the same way.
-- ---------------------------------------------------------------------------
create or replace function public.hide_reference_photo(p_photo_log_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  -- null-safe: a null role must not fall through the `not in` (the coalesce
  -- trap — a bare role-literal arm reopens the null-role hole).
  if v_role is null or v_role not in ('project_director', 'super_admin') then
    raise exception 'hide_reference_photo: project_director or super_admin only'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.photo_logs where id = p_photo_log_id) then
    raise exception 'hide_reference_photo: unknown photo' using errcode = '22023';
  end if;

  insert into public.wp_catalog_hidden_reference_photos (photo_log_id, hidden_by)
  values (p_photo_log_id, auth.uid())
  on conflict (photo_log_id) do nothing;
end;
$function$;

create or replace function public.unhide_reference_photo(p_photo_log_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role not in ('project_director', 'super_admin') then
    raise exception 'unhide_reference_photo: project_director or super_admin only'
      using errcode = '42501';
  end if;

  delete from public.wp_catalog_hidden_reference_photos where photo_log_id = p_photo_log_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The reader. Same signature, same return type, new body.
--
-- Two arms, concatenated and capped:
--   tier 0  explicit stars  — pinned to the front (D4: curation is promotion,
--                             never erasure, so a star never deletes the rest)
--   tier 1  derived         — `after` + `after_fix` photos of COMPLETE, mapped,
--                             NON-GROUP WPs
-- Derived rows report starred_by / starred_at / note as NULL, which is what lets
-- the UI mark the real stars (D7) without a second query.
-- ---------------------------------------------------------------------------
create or replace function public.get_wp_reference_photos(p_wp_catalog_item_id uuid)
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
           p.created_at as sort_at
    from public.photo_logs p
    join public.work_packages w on w.id = p.work_package_id
    join public.projects pr on pr.id = w.project_id
    where w.wp_catalog_item_id = p_wp_catalog_item_id
      -- "confirmed" = complete.
      and w.status = 'complete'
      -- ⓘ NO is_group filter, deliberately. The spec called for one — a group
      -- rolls up to complete arithmetically, so its completion is not a
      -- judgement about work — but `wp_reject_group_binding()` already raises
      -- 23514 on ANY photo_logs row bound to a group, so no group WP can own a
      -- photo in the first place. The predicate would be UNREACHABLE, and an
      -- unreachable clause asserts a hazard that is not there (spec 340's
      -- lesson, which cost three migrations). The trigger is pinned in 391's
      -- pgTAP instead, so relaxing it reds this unit's tests.
      -- `during` / `before` answer "what happened", not "what does done look like".
      and p.phase in ('after', 'after_fix')
      and p.storage_path is not null
      and not exists (select 1 from public.photo_logs n where n.superseded_by = p.id)
      and not exists (select 1 from hidden h where h.photo_log_id = p.id)
      -- ⚠️ INERT TODAY — every one of the 2,873 live photo_logs rows is at round
      -- 0, so this excludes nothing right now. Kept because photoReworkRoundFor
      -- (src/lib/photos/rework-round.ts) stamps after_fix/defect with the WP's
      -- round while pinning before/during/after to 0: the day a real send-back
      -- happens, this is what stops the REJECTED `after` photo standing as the
      -- example for its work type. It must NOT be justified by the 10 complete
      -- WPs that carry after_fix photos today — those had zero rejections and
      -- are documented legacy free-capture (spec 391 §7.2).
      and p.rework_round = (
        select max(p2.rework_round)
        from public.photo_logs p2
        where p2.work_package_id = w.id
          and p2.phase in ('after', 'after_fix')
      )
      -- A starred photo must appear ONCE, in tier 0 — not again here.
      and not exists (select 1 from starred s2 where s2.photo_log_id = p.id)
  )
  select t.photo_log_id, t.storage_path, t.phase, t.project_name, t.note,
         t.starred_by, t.starred_at
  from (select * from starred union all select * from derived) t
  order by t.tier, t.sort_at desc
  limit 4;
$function$;

-- A new function carries a default PUBLIC EXECUTE (#833), so the revoke must
-- name `public` as well as `anon`.
revoke all on function public.hide_reference_photo(uuid) from public, anon;
revoke all on function public.unhide_reference_photo(uuid) from public, anon;
grant execute on function public.hide_reference_photo(uuid) to authenticated;
grant execute on function public.unhide_reference_photo(uuid) to authenticated;

-- The reader's posture is UNCHANGED by this unit — 389 U5 chose it deliberately
-- and two pgTAP files now pin it. Restated because CREATE OR REPLACE preserves
-- grants silently, and a posture that is never written down drifts.
revoke all on function public.get_wp_reference_photos(uuid) from public, anon;
grant execute on function public.get_wp_reference_photos(uuid) to authenticated;
