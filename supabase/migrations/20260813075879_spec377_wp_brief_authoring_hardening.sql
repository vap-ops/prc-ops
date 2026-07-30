-- Spec 377 U2a — fresh-eyes hardening of 075876 (same unit, second migration
-- per the applied-migration-edit-no-op rule).
--
-- The review's live-probed findings, each fixed here:
--   🔴 clone_wp_briefs_from_project gated only the TARGET project. A
--      project_manager who is NOT a member of the SOURCE project could still
--      copy its briefs (scope, quantities, sheet citations, acceptance
--      criteria) into a project they control and read them back — a
--      repeatable RLS-bypass oracle, live-proven by the reviewer. Now gates
--      BOTH ends.
--   🟡 publish_wp_brief read the draft head and its criteria/evidence-slot
--      children in TWO separate implicit statements — under READ COMMITTED
--      each takes its own snapshot, so a concurrent edit landing between them
--      could freeze a torn version (scope from one instant, criteria from
--      another) into the append-only table forever. Now ONE statement.
--   🟡 the snapshot never carried attachment ids, so a post-publish
--      attachment tombstone would silently change what a published version
--      renders once U4 wires attachments in. Now snapshots the CURRENT-STATE
--      attachment ids (ADR-0015 read: storage_path IS NOT NULL) so this does
--      not need re-touching when U4 ships.
--   🔵 jsonb_agg for criteria/evidence_slots ordered by sort_order alone;
--      duplicate sort_orders (reachable — no unique constraint) left
--      Postgres-undefined tie order. Now tiebreaks on id.
--   🔵 update_wp_brief_criterion / update_wp_brief_evidence_slot raised a raw
--      23502 on a null sort_order instead of the 22023 this unit reserves for
--      validation errors. Now explicit.
--   🔵 the clone had no ON CONFLICT guard, so a race against a concurrent
--      manual save on the same target leaf aborted the WHOLE batch on a raw
--      23505. Now skips that one leaf and continues.
--   🔵 the clone carried sheet_code/sheet_rev verbatim into the target
--      project — a citation naming a DIFFERENT project's drawing register is
--      wrong by construction, not merely unverified. Now nulled on clone; the
--      PD re-cites against the target's own drawings when they edit.
--
-- NOT changed (reviewer flagged, deliberately left — recorded so it is not
-- re-litigated): clone's "unknown project" (22023) vs "not a member" (42501)
-- ordering asymmetry. This mirrors the live clone_work_packages precedent on
-- purpose and is already justified inline in 075876's migration comment — a
-- bogus project id is a plain validation error, not an authorization
-- boundary, unlike a WP id (which a non-member could otherwise probe for
-- existence). Low severity, coherent as designed.
--
-- ADDITIVE ONLY.

-- 1. clone_wp_briefs_from_project — gate the SOURCE too; null sheet
--    citations on clone; ON CONFLICT DO NOTHING so a race skips, not aborts.
create or replace function public.clone_wp_briefs_from_project(
  p_source_project_id uuid,
  p_target_project_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer := 0;
  r       record;
  cr      record;
  sl      record;
  v_new_brief_id uuid;
  v_new_crit_id  uuid;
  v_old_ids      uuid[];
  v_new_ids      uuid[];
  v_idx          integer;
  v_mapped_crit  uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'clone_wp_briefs_from_project: role not permitted' using errcode = '42501';
  end if;
  if p_source_project_id = p_target_project_id then
    raise exception 'clone_wp_briefs_from_project: source and destination must differ'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_source_project_id)
     or not exists (select 1 from public.projects where id = p_target_project_id) then
    raise exception 'clone_wp_briefs_from_project: unknown project' using errcode = '22023';
  end if;
  if not public.can_see_project(p_source_project_id) then
    raise exception 'clone_wp_briefs_from_project: not a member of the source project'
      using errcode = '42501';
  end if;
  if not public.can_see_project(p_target_project_id) then
    raise exception 'clone_wp_briefs_from_project: not a member of the target project'
      using errcode = '42501';
  end if;

  for r in
    select distinct on (tgt.id)
           tgt.id as target_wp_id, src_b.id as source_brief_id,
           src_b.scope_included, src_b.scope_excluded, src_b.quantity, src_b.location,
           src_b.display_config
      from public.wp_briefs src_b
      join public.work_packages src_wp
        on src_wp.id = src_b.work_package_id
       and src_wp.project_id = p_source_project_id
       and src_wp.is_group = false
      join public.work_packages tgt
        on tgt.project_id = p_target_project_id
       and tgt.is_group = false
       and btrim(tgt.name) = btrim(src_wp.name)
     where not exists (select 1 from public.wp_briefs existing where existing.work_package_id = tgt.id)
     order by tgt.id, src_wp.code
  loop
    -- sheet_code/sheet_rev deliberately NOT carried: a citation naming the
    -- SOURCE project's drawing register is wrong for the target by
    -- construction (spec 377 §4.4 amendment records this).
    insert into public.wp_briefs (
      work_package_id, scope_included, scope_excluded, quantity, location,
      sheet_code, sheet_rev, display_config, updated_by
    ) values (
      r.target_wp_id, r.scope_included, r.scope_excluded, r.quantity, r.location,
      null, null, r.display_config, v_uid
    )
    on conflict (work_package_id) do nothing
    returning id into v_new_brief_id;

    if v_new_brief_id is null then
      -- lost a race against a concurrent draft on this leaf — skip it, don't
      -- abort the whole batch.
      continue;
    end if;

    v_old_ids := '{}';
    v_new_ids := '{}';
    for cr in
      select id, body, sort_order from public.wp_brief_criteria
       where brief_id = r.source_brief_id order by sort_order, id
    loop
      insert into public.wp_brief_criteria (brief_id, body, sort_order)
      values (v_new_brief_id, cr.body, cr.sort_order)
      returning id into v_new_crit_id;
      v_old_ids := array_append(v_old_ids, cr.id);
      v_new_ids := array_append(v_new_ids, v_new_crit_id);
    end loop;

    for sl in
      select label, criterion_id, sort_order from public.wp_brief_evidence_slots
       where brief_id = r.source_brief_id order by sort_order, id
    loop
      v_mapped_crit := null;
      if sl.criterion_id is not null then
        v_idx := array_position(v_old_ids, sl.criterion_id);
        if v_idx is not null then
          v_mapped_crit := v_new_ids[v_idx];
        end if;
      end if;
      insert into public.wp_brief_evidence_slots (brief_id, label, criterion_id, sort_order)
      values (v_new_brief_id, sl.label, v_mapped_crit, sl.sort_order);
    end loop;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function public.clone_wp_briefs_from_project is
  'Spec 377 U2a — clones DRAFT briefs (+ criteria + evidence slots, remapping slot->criterion ids) from every matching leaf in the source project onto the target project''s leaves. Requires can_see_project on BOTH ends (075877 fix — the source-only omission was a live-probed cross-project read oracle). Match key = exact WP NAME. sheet_code/sheet_rev are NOT carried (they would cite the wrong project''s drawings). Skips a target leaf that already has a draft (ON CONFLICT DO NOTHING, so a race skips rather than aborts the batch). Clones the DRAFT, never a published version; the clone is never auto-published.';

-- 2. publish_wp_brief — ONE statement (no torn read across concurrent edits);
--    tiebreak criteria/slot ordering on id; snapshot current-state attachment
--    ids (forward-compatible with U4, which wires the upload UI).
create or replace function public.publish_wp_brief(p_work_package_id uuid) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content jsonb;
  v_id      uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'publish_wp_brief: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'publish_wp_brief: not a member of this project' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'scope_included', b.scope_included,
    'scope_excluded', b.scope_excluded,
    'quantity',       b.quantity,
    'location',       b.location,
    'sheet_code',     b.sheet_code,
    'sheet_rev',      b.sheet_rev,
    'display_config', b.display_config,
    'criteria', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'sort_order', c.sort_order)
                                 order by c.sort_order, c.id), '[]'::jsonb)
        from public.wp_brief_criteria c where c.brief_id = b.id
    ),
    'evidence_slots', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label,
                                   'criterion_id', s.criterion_id, 'sort_order', s.sort_order)
                                 order by s.sort_order, s.id), '[]'::jsonb)
        from public.wp_brief_evidence_slots s where s.brief_id = b.id
    ),
    'attachment_ids', (
      select coalesce(jsonb_agg(a.id order by a.created_at, a.id), '[]'::jsonb)
        from public.wp_brief_attachments a
       where a.brief_id = b.id and a.storage_path is not null
    )
  )
  into v_content
  from public.wp_briefs b
  where b.work_package_id = p_work_package_id;

  if v_content is null then
    raise exception 'publish_wp_brief: no draft to publish' using errcode = '22023';
  end if;

  insert into public.wp_brief_versions (work_package_id, content, published_by)
  values (p_work_package_id, v_content, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.publish_wp_brief is
  'Spec 377 U2a / ADR 0086 §4 — snapshots the DRAFT (wp_briefs + criteria + evidence_slots + current-state attachment ids) into an IMMUTABLE wp_brief_versions row, in ONE statement (075877 fix — two separate reads could torn-snapshot a concurrent edit into an append-only row). The draft keeps evolving after publish; the snapshot is frozen forever. Runs under the caller''s session so published_by is a real actor (spec-337 U1 attribution lesson).';

-- 3. update_wp_brief_criterion / update_wp_brief_evidence_slot — explicit
--    22023 on a null sort_order, matching this file's own reserved-for-
--    validation convention instead of a raw 23502.
create or replace function public.update_wp_brief_criterion(
  p_id         uuid,
  p_body       text,
  p_sort_order int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'update_wp_brief_criterion: role not permitted' using errcode = '42501';
  end if;
  if p_sort_order is null then
    raise exception 'update_wp_brief_criterion: sort_order is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.wp_brief_criteria c
      join public.wp_briefs b on b.id = c.brief_id
     where c.id = p_id and public.can_see_wp(b.work_package_id)
  ) then
    raise exception 'update_wp_brief_criterion: criterion not found' using errcode = '42501';
  end if;

  update public.wp_brief_criteria set body = p_body, sort_order = p_sort_order where id = p_id;
end;
$$;

create or replace function public.update_wp_brief_evidence_slot(
  p_id           uuid,
  p_label        text,
  p_criterion_id uuid,
  p_sort_order   int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'update_wp_brief_evidence_slot: role not permitted' using errcode = '42501';
  end if;
  if p_sort_order is null then
    raise exception 'update_wp_brief_evidence_slot: sort_order is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.wp_brief_evidence_slots s
      join public.wp_briefs b on b.id = s.brief_id
     where s.id = p_id and public.can_see_wp(b.work_package_id)
  ) then
    raise exception 'update_wp_brief_evidence_slot: slot not found' using errcode = '42501';
  end if;

  -- own-brief mapping re-checked by wp_brief_slot_guard (fires on UPDATE too)
  update public.wp_brief_evidence_slots
     set label = p_label, criterion_id = p_criterion_id, sort_order = p_sort_order
   where id = p_id;
end;
$$;
