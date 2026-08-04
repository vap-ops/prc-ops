-- Spec 394 U1 — เลือกรูปเข้ารายงานลูกค้า: the per-photo client-report selection.
--
-- `reports.params.photos` is a RULE ("after" | "all_phases" | "none") that the
-- job expands into a phase list, so today a client report emits EVERY photo of
-- the chosen phases. There is no per-photo choice anywhere in the report path.
-- This is that store.
--
-- Its own table, because both cheaper homes are wrong:
--   * NOT a column on `photo_logs` — that table is genuinely append-only
--     (`photo_logs_block_update` raises on UPDATE), so a mutable flag there is
--     impossible, not merely discouraged.
--   * NOT a `purpose` column on `wp_catalog_reference_photos` — the natural
--     keys differ (catalogue item vs project), so one side would become a
--     nullable CHECK-policed column: the mixed-content reference column
--     CLAUDE.md bans. It would also re-collapse the two distinct judgments
--     ("an exemplar of this work type" vs "what THIS client sees") that the
--     spec exists to keep apart.
--
-- `work_package_id` is the one accepted denormalisation: `position` is scoped
-- WITHIN a work package (D6), so the unique index needs a partition — and a
-- photo's WP is immutable because photo_logs is append-only, so it cannot
-- drift. `project_id` stays DERIVED (photo → WP → project); storing it would
-- create a second source of truth needing a trigger to stay honest.

create table public.report_selected_photos (
  photo_log_id    uuid primary key references public.photo_logs(id) on delete cascade,
  work_package_id uuid not null references public.work_packages(id) on delete cascade,
  -- `position` is a Postgres col_name_keyword: legal as a column, but it must
  -- be quoted everywhere it is read, or the parser looks for position(x in y).
  "position"      integer not null,
  selected_by     uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  -- DEFERRABLE INITIALLY DEFERRED is load-bearing: a reorder shuffles several
  -- rows in one statement, and a non-deferred index trips mid-update on any
  -- swap. The pgTAP full-reversal assert is this clause's positive control.
  constraint report_selected_photos_wp_position_key
    unique (work_package_id, "position") deferrable initially deferred
);

comment on table public.report_selected_photos is
  'Spec 394 — photos a PD/PM picked for a CLIENT report, ordered within a work package. Distinct from wp_catalog_reference_photos, which is the firm-wide exemplar set. All writes go through the DEFINER RPCs; authenticated holds SELECT only.';

alter table public.report_selected_photos enable row level security;

-- Read: PM_ROLES on a project they can see. Both halves matter — the role set
-- alone would leak another project's curation to any PM, and visibility alone
-- would show it to a site_admin. All three PM_ROLES members CAN pass
-- can_see_project (super_admin/project_director blanket, project_manager by
-- membership), verified live, so no arm here is unreachable.
create policy "report selections readable by PM roles on visible projects"
  on public.report_selected_photos for select to authenticated
  using (
    (select public.current_user_role())
      = any (array['project_manager', 'super_admin', 'project_director']::public.user_role[])
    and exists (
      select 1 from public.work_packages w
       where w.id = report_selected_photos.work_package_id
         and (select public.can_see_project(w.project_id))
    )
  );

revoke all on public.report_selected_photos from public, anon, authenticated;
grant select on public.report_selected_photos to authenticated;

-- ---------------------------------------------------------------------------
-- select_report_photo — append. New rows take max(position) + 1 within the WP,
-- so the first-selected photo leads until PD says otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.select_report_photo(p_photo_log_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor      uuid := auth.uid();
  v_role       public.user_role := public.current_user_role();
  v_wp         uuid;
  v_project    uuid;
  v_superseded boolean;
  v_tombstone  boolean;
  v_pos        integer;
begin
  -- null-safe: a null role must not fall through the `not in` (the coalesce
  -- trap — a bare role-literal arm reopens the null-role hole).
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'select_report_photo: project_manager, project_director or super_admin only'
      using errcode = '42501';
  end if;

  select p.work_package_id, w.project_id,
         exists (select 1 from public.photo_logs n where n.superseded_by = p.id),
         (p.storage_path is null)
    into v_wp, v_project, v_superseded, v_tombstone
  from public.photo_logs p
  join public.work_packages w on w.id = p.work_package_id
  where p.id = p_photo_log_id;

  if not found then
    raise exception 'select_report_photo: unknown photo' using errcode = '22023';
  end if;

  -- Project scope, not just role: the SELECT policy above is PM_ROLES AND
  -- visibility, and a write gate narrower than the read gate is the hole.
  if not public.can_see_project(v_project) then
    raise exception 'select_report_photo: no access to this project' using errcode = '42501';
  end if;

  if v_superseded or v_tombstone then
    raise exception 'select_report_photo: a superseded or removed photo cannot go in a client report'
      using errcode = '22023';
  end if;

  -- Serialise on the WP row itself, not on the selection rows: the FIRST
  -- selection in a WP has no rows to lock, which is exactly when two
  -- concurrent appends would both compute position 1.
  --
  -- ⚠️ The lock is taken BEFORE the idempotency check, not after. A double tap
  -- on a slow link is two overlapping requests for the SAME photo: with the
  -- check outside the lock both see no row, both insert, and the loser gets a
  -- raw 23505 on the primary key — a SQLSTATE outside this spec's refusal
  -- vocabulary, so the UI would report a retryable failure for a state that is
  -- already correct. Under the lock the second caller reads the first's
  -- committed row and returns changed:false, which is what the comment below
  -- actually promises.
  perform 1 from public.work_packages where id = v_wp for update;

  -- Idempotent, matching the star RPCs' contract: re-selecting is a no-op, not
  -- an error.
  if exists (select 1 from public.report_selected_photos where photo_log_id = p_photo_log_id) then
    return jsonb_build_object(
      'changed', false,
      'position', (select r."position" from public.report_selected_photos r
                    where r.photo_log_id = p_photo_log_id));
  end if;

  select coalesce(max(r."position"), 0) + 1 into v_pos
  from public.report_selected_photos r where r.work_package_id = v_wp;

  insert into public.report_selected_photos (photo_log_id, work_package_id, "position", selected_by)
  values (p_photo_log_id, v_wp, v_pos, v_actor);

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (v_actor, v_role, 'other', 'report_selected_photos', p_photo_log_id,
    jsonb_build_object('event', 'report_photo_selected',
                       'work_package_id', v_wp,
                       'position', v_pos));

  return jsonb_build_object('changed', true, 'position', v_pos);
end;
$function$;

comment on function public.select_report_photo(uuid) is
  'Spec 394 — add a photo to its work package''s client-report selection, appended at max(position)+1. PM_ROLES + can_see_project. Idempotent (changed:false).';

-- ---------------------------------------------------------------------------
-- unselect_report_photo — remove, and CLOSE THE GAP so positions stay dense
-- and the next append is predictable.
-- ---------------------------------------------------------------------------
create or replace function public.unselect_report_photo(p_photo_log_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor   uuid := auth.uid();
  v_role    public.user_role := public.current_user_role();
  v_wp      uuid;
  v_project uuid;
  v_pos     integer;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'unselect_report_photo: project_manager, project_director or super_admin only'
      using errcode = '42501';
  end if;

  select p.work_package_id, w.project_id into v_wp, v_project
  from public.photo_logs p
  join public.work_packages w on w.id = p.work_package_id
  where p.id = p_photo_log_id;

  if not found then
    raise exception 'unselect_report_photo: unknown photo' using errcode = '22023';
  end if;

  if not public.can_see_project(v_project) then
    raise exception 'unselect_report_photo: no access to this project' using errcode = '42501';
  end if;

  perform 1 from public.work_packages where id = v_wp for update;

  delete from public.report_selected_photos
   where photo_log_id = p_photo_log_id
   returning "position" into v_pos;

  -- Not selected ⇒ nothing to undo. A no-op, not an error (star parity).
  if v_pos is null then
    return jsonb_build_object('changed', false);
  end if;

  update public.report_selected_photos
     set "position" = "position" - 1
   where work_package_id = v_wp and "position" > v_pos;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (v_actor, v_role, 'other', 'report_selected_photos', p_photo_log_id,
    jsonb_build_object('event', 'report_photo_unselected',
                       'work_package_id', v_wp,
                       'position', v_pos));

  return jsonb_build_object('changed', true);
end;
$function$;

comment on function public.unselect_report_photo(uuid) is
  'Spec 394 — remove a photo from its work package''s client-report selection and close the position gap. PM_ROLES + can_see_project. Idempotent (changed:false).';

-- ---------------------------------------------------------------------------
-- reorder_report_photos — the WHOLE list at once, never a move-one-step call:
-- a single statement cannot leave a half-applied order, and the client sends
-- what it displays so the server never reconstructs intent from a delta.
-- ---------------------------------------------------------------------------
create or replace function public.reorder_report_photos(
  p_work_package_id uuid,
  p_photo_ids       uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor    uuid := auth.uid();
  v_role     public.user_role := public.current_user_role();
  v_project  uuid;
  v_current  integer;
  v_given    integer := coalesce(array_length(p_photo_ids, 1), 0);
  v_distinct integer;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'reorder_report_photos: project_manager, project_director or super_admin only'
      using errcode = '42501';
  end if;

  select project_id into v_project from public.work_packages where id = p_work_package_id;
  if not found then
    raise exception 'reorder_report_photos: unknown work package' using errcode = '22023';
  end if;

  if not public.can_see_project(v_project) then
    raise exception 'reorder_report_photos: no access to this project' using errcode = '42501';
  end if;

  -- Two arranging sessions must serialise, or the loser writes an order it
  -- computed from a set the winner has already changed.
  perform 1 from public.work_packages where id = p_work_package_id for update;

  select count(*) into v_current
  from public.report_selected_photos where work_package_id = p_work_package_id;

  select count(distinct id) into v_distinct from unnest(p_photo_ids) as u(id);

  -- The list must be EXACTLY the current set. A stale client that has missed a
  -- concurrent unselect must re-read rather than silently resurrect or drop a
  -- photo — so a short list, a duplicate, and a foreign photo are all refused.
  if v_given <> v_current
     or v_distinct <> v_given
     or exists (
       select 1 from unnest(p_photo_ids) as u(id)
        where not exists (
          select 1 from public.report_selected_photos r
           where r.photo_log_id = u.id and r.work_package_id = p_work_package_id))
  then
    raise exception 'reorder_report_photos: the list is not exactly this work package''s current selection'
      using errcode = '22023';
  end if;

  if v_given = 0 then
    return jsonb_build_object('changed', false, 'count', 0);
  end if;

  update public.report_selected_photos r
     set "position" = t.ord
    from (select id, ord from unnest(p_photo_ids) with ordinality as u(id, ord)) t
   where r.photo_log_id = t.id;

  -- ⚠️ This row targets the WORK PACKAGE, not a photo — reordering is an act on
  -- the WP's whole list. So it is filed under `work_packages` (the house shape,
  -- as in map_wp_to_catalog's `wp_catalog_mapped`) rather than under
  -- `report_selected_photos` with a WP id in `target_id`: one target_table
  -- carrying two different entity types is the mixed reference this repo bans,
  -- and it would silently break any reader joining target_id to a photo.
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (v_actor, v_role, 'other', 'work_packages', p_work_package_id,
    jsonb_build_object('event', 'report_photos_reordered',
                       'work_package_id', p_work_package_id,
                       'count', v_given,
                       'order', to_jsonb(p_photo_ids)));

  return jsonb_build_object('changed', true, 'count', v_given);
end;
$function$;

comment on function public.reorder_report_photos(uuid, uuid[]) is
  'Spec 394 — set the whole client-report order for one work package. Refuses (22023) any list that is not exactly the WP''s current selection. PM_ROLES + can_see_project.';

-- Definer RPCs: revoke from public AND anon (an anon-only revoke leaves the
-- default PUBLIC grant in place), then grant to authenticated.
revoke all on function public.select_report_photo(uuid) from public, anon;
revoke all on function public.unselect_report_photo(uuid) from public, anon;
revoke all on function public.reorder_report_photos(uuid, uuid[]) from public, anon;
grant execute on function public.select_report_photo(uuid) to authenticated;
grant execute on function public.unselect_report_photo(uuid) to authenticated;
grant execute on function public.reorder_report_photos(uuid, uuid[]) to authenticated;
