-- Spec 377 U2 — PD brief authoring RPCs: draft upsert, criteria/slot CRUD,
-- publish, and clone-from-previous-project.
--
-- Every RPC mirrors the LIVE `set_work_package_deliverable` shape verbatim
-- (is_manager() + can_see_wp(), 42501 for "can't reach this — absent or not
-- yours to see", never distinguishing the two so existence is never leaked
-- to a non-member) — U1 locked writes to RPC-only (no INSERT/UPDATE/DELETE
-- policy exists on any of the six tables), so SECURITY DEFINER is the only
-- path in. 22023 is reserved for genuine validation errors on a target the
-- caller CAN see (e.g. "no draft to publish", "source and destination must
-- differ") — never for authorization boundaries.
--
-- Corrects spec 377 §5: the table listed U2 as "DB? No" — wrong, authoring
-- needs RPCs, so this unit claims the schema lane (fixed in the same PR).
--
-- ADDITIVE ONLY.

-- 1. save_wp_brief_draft — upsert, FULL REPLACE semantics (matches the
--    spec-331 update_x convention: the caller sends the whole row, not a
--    partial patch — a second save with fewer fields genuinely clears them).
create function public.save_wp_brief_draft(
  p_work_package_id uuid,
  p_scope_included   text,
  p_scope_excluded   text,
  p_quantity         text,
  p_location         text,
  p_sheet_code       text,
  p_sheet_rev        text,
  p_display_config   jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'save_wp_brief_draft: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'save_wp_brief_draft: not a member of this project' using errcode = '42501';
  end if;

  insert into public.wp_briefs (
    work_package_id, scope_included, scope_excluded, quantity, location,
    sheet_code, sheet_rev, display_config, updated_by
  ) values (
    p_work_package_id, p_scope_included, p_scope_excluded, p_quantity, p_location,
    p_sheet_code, p_sheet_rev, p_display_config, auth.uid()
  )
  on conflict (work_package_id) do update
    set scope_included = excluded.scope_included,
        scope_excluded = excluded.scope_excluded,
        quantity       = excluded.quantity,
        location       = excluded.location,
        sheet_code     = excluded.sheet_code,
        sheet_rev      = excluded.sheet_rev,
        display_config = excluded.display_config,
        updated_by     = excluded.updated_by
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.save_wp_brief_draft(uuid, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.save_wp_brief_draft(uuid, text, text, text, text, text, text, jsonb) to authenticated;

comment on function public.save_wp_brief_draft is
  'Spec 377 U2 — upsert the DRAFT head for a leaf WP. FULL REPLACE (a second call with a null field clears it, matching spec-331''s update_x convention). The leaf-only guard fires through the shared wp_reject_group_binding trigger. can_see_wp already returns false for a nonexistent WP id, so a bogus id and a real-but-inaccessible WP are indistinguishable to the caller (existence is never leaked).';

-- 2. Criteria CRUD ───────────────────────────────────────────────────────────
create function public.add_wp_brief_criterion(
  p_brief_id   uuid,
  p_body       text,
  p_sort_order int default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'add_wp_brief_criterion: role not permitted' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.wp_briefs b
     where b.id = p_brief_id and public.can_see_wp(b.work_package_id)
  ) then
    raise exception 'add_wp_brief_criterion: brief not found' using errcode = '42501';
  end if;

  insert into public.wp_brief_criteria (brief_id, body, sort_order)
  values (
    p_brief_id, p_body,
    coalesce(p_sort_order,
      (select coalesce(max(sort_order), 0) + 1 from public.wp_brief_criteria where brief_id = p_brief_id))
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_wp_brief_criterion(uuid, text, int) from public, anon;
grant execute on function public.add_wp_brief_criterion(uuid, text, int) to authenticated;

create function public.update_wp_brief_criterion(
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
revoke all on function public.update_wp_brief_criterion(uuid, text, int) from public, anon;
grant execute on function public.update_wp_brief_criterion(uuid, text, int) to authenticated;

create function public.delete_wp_brief_criterion(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'delete_wp_brief_criterion: role not permitted' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.wp_brief_criteria c
      join public.wp_briefs b on b.id = c.brief_id
     where c.id = p_id and public.can_see_wp(b.work_package_id)
  ) then
    raise exception 'delete_wp_brief_criterion: criterion not found' using errcode = '42501';
  end if;

  -- any slot mapping this criterion has its criterion_id set NULL by the FK
  -- (on delete set null) — the slot survives, the mapping does not.
  delete from public.wp_brief_criteria where id = p_id;
end;
$$;
revoke all on function public.delete_wp_brief_criterion(uuid) from public, anon;
grant execute on function public.delete_wp_brief_criterion(uuid) to authenticated;

-- 3. Evidence-slot CRUD ──────────────────────────────────────────────────────
create function public.add_wp_brief_evidence_slot(
  p_brief_id     uuid,
  p_label        text,
  p_criterion_id uuid default null,
  p_sort_order   int  default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'add_wp_brief_evidence_slot: role not permitted' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.wp_briefs b
     where b.id = p_brief_id and public.can_see_wp(b.work_package_id)
  ) then
    raise exception 'add_wp_brief_evidence_slot: brief not found' using errcode = '42501';
  end if;

  -- own-brief mapping is enforced by the existing wp_brief_slot_guard trigger
  insert into public.wp_brief_evidence_slots (brief_id, label, criterion_id, sort_order)
  values (
    p_brief_id, p_label, p_criterion_id,
    coalesce(p_sort_order,
      (select coalesce(max(sort_order), 0) + 1 from public.wp_brief_evidence_slots where brief_id = p_brief_id))
  )
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.add_wp_brief_evidence_slot(uuid, text, uuid, int) from public, anon;
grant execute on function public.add_wp_brief_evidence_slot(uuid, text, uuid, int) to authenticated;

create function public.update_wp_brief_evidence_slot(
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
revoke all on function public.update_wp_brief_evidence_slot(uuid, text, uuid, int) from public, anon;
grant execute on function public.update_wp_brief_evidence_slot(uuid, text, uuid, int) to authenticated;

create function public.delete_wp_brief_evidence_slot(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'delete_wp_brief_evidence_slot: role not permitted' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.wp_brief_evidence_slots s
      join public.wp_briefs b on b.id = s.brief_id
     where s.id = p_id and public.can_see_wp(b.work_package_id)
  ) then
    raise exception 'delete_wp_brief_evidence_slot: slot not found' using errcode = '42501';
  end if;

  delete from public.wp_brief_evidence_slots where id = p_id;
end;
$$;
revoke all on function public.delete_wp_brief_evidence_slot(uuid) from public, anon;
grant execute on function public.delete_wp_brief_evidence_slot(uuid) to authenticated;

-- 4. publish_wp_brief — the version row IS the publish event (ADR 0086 §4).
--    Version number is derived by the U1 trigger; this RPC never passes one.
--    "no draft to publish" is a genuine 22023 — unlike the gates above, the
--    WP itself IS visible; only the co-input (a draft row) is missing.
create function public.publish_wp_brief(p_work_package_id uuid) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brief   public.wp_briefs%rowtype;
  v_content jsonb;
  v_id      uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'publish_wp_brief: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'publish_wp_brief: not a member of this project' using errcode = '42501';
  end if;

  select * into v_brief from public.wp_briefs where work_package_id = p_work_package_id;
  if not found then
    raise exception 'publish_wp_brief: no draft to publish' using errcode = '22023';
  end if;

  v_content := jsonb_build_object(
    'scope_included', v_brief.scope_included,
    'scope_excluded', v_brief.scope_excluded,
    'quantity',       v_brief.quantity,
    'location',       v_brief.location,
    'sheet_code',     v_brief.sheet_code,
    'sheet_rev',      v_brief.sheet_rev,
    'display_config', v_brief.display_config,
    'criteria', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'sort_order', c.sort_order)
                                 order by c.sort_order), '[]'::jsonb)
        from public.wp_brief_criteria c where c.brief_id = v_brief.id
    ),
    'evidence_slots', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label,
                                   'criterion_id', s.criterion_id, 'sort_order', s.sort_order)
                                 order by s.sort_order), '[]'::jsonb)
        from public.wp_brief_evidence_slots s where s.brief_id = v_brief.id
    )
  );

  insert into public.wp_brief_versions (work_package_id, content, published_by)
  values (p_work_package_id, v_content, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.publish_wp_brief(uuid) from public, anon;
grant execute on function public.publish_wp_brief(uuid) to authenticated;

comment on function public.publish_wp_brief is
  'Spec 377 U2 / ADR 0086 §4 — snapshots the DRAFT (wp_briefs + criteria + evidence_slots) into an IMMUTABLE wp_brief_versions row. The draft keeps evolving after publish; the snapshot is frozen forever. Runs under the caller''s session so published_by is a real actor (spec-337 U1 attribution lesson).';

-- 5. clone_wp_briefs_from_project — name-matched, draft-only, non-clobbering.
--    Deviates from the live clone_work_packages precedent (which has NO
--    can_see_project check) by requiring can_see_project on the TARGET —
--    this RPC writes drafts into a project the caller is actively managing,
--    unlike clone_work_packages which only needs is_manager. Match key is
--    exact WP NAME, not code: clone_work_packages matches by code because it
--    creates NEW rows on-conflict-do-nothing, but WP codes here are
--    project-local sequential (spec 336) and will not align across two
--    independently-numbered TFM projects — name is the stable cross-project
--    identity the operator actually recognises ("TFM branches are
--    prototypes"). A wrong name match is caught by the human before publish
--    (item 5 of the locked design), which backstops the heuristic. Mirrors
--    clone_work_packages for "unknown project" (22023, not 42501) — a bogus
--    project id here is a plain validation error, not an authorization
--    boundary (unlike a WP, which a non-member could probe for existence).
create function public.clone_wp_briefs_from_project(
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
  if not public.can_see_project(p_target_project_id) then
    raise exception 'clone_wp_briefs_from_project: not a member of the target project'
      using errcode = '42501';
  end if;

  for r in
    select distinct on (tgt.id)
           tgt.id as target_wp_id, src_b.id as source_brief_id,
           src_b.scope_included, src_b.scope_excluded, src_b.quantity, src_b.location,
           src_b.sheet_code, src_b.sheet_rev, src_b.display_config
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
    insert into public.wp_briefs (
      work_package_id, scope_included, scope_excluded, quantity, location,
      sheet_code, sheet_rev, display_config, updated_by
    ) values (
      r.target_wp_id, r.scope_included, r.scope_excluded, r.quantity, r.location,
      r.sheet_code, r.sheet_rev, r.display_config, v_uid
    )
    returning id into v_new_brief_id;

    v_old_ids := '{}';
    v_new_ids := '{}';
    for cr in
      select id, body, sort_order from public.wp_brief_criteria
       where brief_id = r.source_brief_id order by sort_order
    loop
      insert into public.wp_brief_criteria (brief_id, body, sort_order)
      values (v_new_brief_id, cr.body, cr.sort_order)
      returning id into v_new_crit_id;
      v_old_ids := array_append(v_old_ids, cr.id);
      v_new_ids := array_append(v_new_ids, v_new_crit_id);
    end loop;

    for sl in
      select label, criterion_id, sort_order from public.wp_brief_evidence_slots
       where brief_id = r.source_brief_id order by sort_order
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
revoke all on function public.clone_wp_briefs_from_project(uuid, uuid) from public, anon;
grant execute on function public.clone_wp_briefs_from_project(uuid, uuid) to authenticated;

comment on function public.clone_wp_briefs_from_project is
  'Spec 377 U2 — clones DRAFT briefs (+ criteria + evidence slots, remapping slot->criterion ids) from every matching leaf in the source project onto the target project''s leaves. Match key = exact WP NAME (not code — see the function body comment for why). Skips a target leaf that already has a draft. Clones the DRAFT, never a published version; the clone is never auto-published.';
