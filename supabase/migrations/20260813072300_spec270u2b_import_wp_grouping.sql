-- Spec 270 U2b / ADR 0074 — import_wp_grouping(p_project_id, p_rows jsonb).
-- Applies an engineer grouping file (SubOf | WP | OldCode | ชื่องาน rows as
-- jsonb) in ONE transaction: creates งาน rows, re-parents every งานย่อย,
-- renames, and renumbers. Matching is by old_code ONLY (rename+renumber are
-- simultaneous). Codes move via a two-phase swap so the unique
-- (project_id, code) index survives arbitrary permutations. super_admin only;
-- the client-side dry-run (src/lib/work-packages/grouping-import.ts) gives the
-- friendly report — this RPC re-asserts the hard invariants (22023) because a
-- definer function trusts nothing from the browser.

create or replace function public.import_wp_grouping(p_project_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_actor_role public.user_role := public.current_user_role();
  v_bad        text;
  v_missing    int;
  v_groups_created int := 0;
  v_groups_matched int := 0;
  v_leaves_created int := 0;
  v_updated        int := 0;
begin
  -- 1. Gate: super_admin only (null-safe).
  if v_actor_role is null or v_actor_role <> 'super_admin' then
    raise exception 'import_wp_grouping: super_admin only' using errcode = '42501';
  end if;

  -- 2. Project must exist.
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'import_wp_grouping: unknown project' using errcode = '22023';
  end if;

  -- 3. Parse + shape checks. (drop-if-exists: temp tables survive between calls
  -- inside one transaction — e.g. consecutive calls under pgTAP.)
  drop table if exists _imp_rows, _imp_resolved, _imp_ids;
  create temp table _imp_rows on commit drop as
    select ord,
           nullif(trim(r ->> 'sub_of'), '')   as sub_of,
           nullif(trim(r ->> 'code'), '')     as code,
           nullif(trim(r ->> 'old_code'), '') as old_code,
           nullif(trim(r ->> 'name'), '')     as name
    from jsonb_array_elements(p_rows) with ordinality as t(r, ord);

  if not exists (select 1 from _imp_rows) then
    raise exception 'import_wp_grouping: empty file' using errcode = '22023';
  end if;
  if exists (select 1 from _imp_rows where code is null or name is null) then
    raise exception 'import_wp_grouping: every row needs a code and a name'
      using errcode = '22023';
  end if;
  if exists (select 1 from _imp_rows where code like '~%') then
    raise exception 'import_wp_grouping: codes may not start with "~" (reserved for the recode swap)'
      using errcode = '22023';
  end if;
  select code into v_bad from _imp_rows group by code having count(*) > 1 limit 1;
  if v_bad is not null then
    raise exception 'import_wp_grouping: duplicate code %', v_bad using errcode = '22023';
  end if;
  select old_code into v_bad from _imp_rows where old_code is not null
    group by old_code having count(*) > 1 limit 1;
  if v_bad is not null then
    raise exception 'import_wp_grouping: duplicate old_code %', v_bad using errcode = '22023';
  end if;

  -- 4. Resolve old_code → existing row (same project only).
  create temp table _imp_resolved on commit drop as
    select i.ord, i.sub_of, i.code, i.old_code, i.name,
           w.id as existing_id, w.is_group as existing_is_group
    from _imp_rows i
    left join public.work_packages w
      on w.project_id = p_project_id and w.code = i.old_code;

  select old_code into v_bad from _imp_resolved
    where old_code is not null and existing_id is null limit 1;
  if v_bad is not null then
    raise exception 'import_wp_grouping: old_code % does not exist in this project', v_bad
      using errcode = '22023';
  end if;

  -- 5. Row classification invariants. A row without sub_of is a งาน; its
  --    old_code must not be an existing งานย่อย (either a งานย่อย missing its
  --    SubOf — grouping is mandatory — or an is_group flip; both invalid).
  select coalesce(old_code, code) into v_bad from _imp_resolved
    where sub_of is null and existing_id is not null and not existing_is_group limit 1;
  if v_bad is not null then
    raise exception
      'import_wp_grouping: % is an existing งานย่อย but its row has no sub_of (grouping is mandatory; is_group is immutable)', v_bad
      using errcode = '22023';
  end if;
  -- A row WITH sub_of is a งานย่อย; its old_code must not be an existing งาน.
  select old_code into v_bad from _imp_resolved
    where sub_of is not null and existing_id is not null and existing_is_group limit 1;
  if v_bad is not null then
    raise exception 'import_wp_grouping: old_code % is an existing งาน — it cannot become a งานย่อย', v_bad
      using errcode = '22023';
  end if;
  -- Every sub_of must reference a งาน row in the same file.
  select i.sub_of into v_bad from _imp_resolved i
    where i.sub_of is not null
      and not exists (select 1 from _imp_resolved g where g.code = i.sub_of and g.sub_of is null)
    limit 1;
  if v_bad is not null then
    raise exception 'import_wp_grouping: sub_of % is not a งาน row in the file', v_bad
      using errcode = '22023';
  end if;

  -- 6. Coverage: every existing WP of the project appears exactly once as an
  --    old_code (removals are not part of this import).
  select count(*) into v_missing
    from public.work_packages w
    where w.project_id = p_project_id
      and not exists (select 1 from _imp_resolved i where i.existing_id = w.id);
  if v_missing > 0 then
    raise exception 'import_wp_grouping: % existing WP(s) missing from the file — removals are not part of this import', v_missing
      using errcode = '22023';
  end if;

  -- 7. Phase A — free every code in play: matched rows move to a collision-proof
  --    temporary code (the unique index is (project_id, code)).
  update public.work_packages w
    set code = '~imp~' || i.ord
    from _imp_resolved i
    where w.id = i.existing_id and i.existing_id is not null;
  get diagnostics v_updated = row_count;

  -- 8. Phase B — create new งาน rows (guard trigger enforces not_started birth).
  create temp table _imp_ids on commit drop as
    select i.ord, i.sub_of, i.code, i.name,
           coalesce(i.existing_id,
             case when i.sub_of is null then null end) as wp_id,
           (i.sub_of is null) as is_group_row,
           i.existing_id
    from _imp_resolved i;

  with new_groups as (
    insert into public.work_packages (project_id, code, name, is_group)
    select p_project_id, '~new~' || ord, name, true
    from _imp_ids where is_group_row and existing_id is null
    returning id, code
  )
  update _imp_ids t
    set wp_id = ng.id
    from new_groups ng
    where ng.code = '~new~' || t.ord;

  select count(*) into v_groups_created from _imp_ids where is_group_row and existing_id is null;
  select count(*) into v_groups_matched from _imp_ids where is_group_row and existing_id is not null;

  -- 9. Phase C — create new งานย่อย rows (old_code empty, sub_of present),
  --    parent wired in phase D with everyone else.
  with new_leaves as (
    insert into public.work_packages (project_id, code, name)
    select p_project_id, '~new~' || ord, name
    from _imp_ids where not is_group_row and existing_id is null
    returning id, code
  )
  update _imp_ids t
    set wp_id = nl.id
    from new_leaves nl
    where nl.code = '~new~' || t.ord;

  select count(*) into v_leaves_created from _imp_ids where not is_group_row and existing_id is null;

  -- 10. Phase D — final names, parents, codes for every row (parent resolution
  --     via the file's sub_of → that งาน row's wp_id).
  update public.work_packages w
    set name = t.name,
        parent_id = case when t.is_group_row then null else g.wp_id end,
        code = t.code
    from _imp_ids t
    left join _imp_ids g on g.code = t.sub_of and g.is_group_row
    where w.id = t.wp_id;

  -- 11. Audit (service-role-only INSERT policy — definer context writes it).
  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (v_actor, v_actor_role, 'other', 'work_packages', p_project_id,
    jsonb_build_object(
      'kind', 'wp_grouping_import',
      'rows', (select count(*) from _imp_ids),
      'groups_created', v_groups_created,
      'groups_matched', v_groups_matched,
      'leaves_created', v_leaves_created,
      'existing_updated', v_updated));

  return jsonb_build_object(
    'rows', (select count(*) from _imp_ids),
    'groups_created', v_groups_created,
    'groups_matched', v_groups_matched,
    'leaves_created', v_leaves_created,
    'existing_updated', v_updated);
end;
$$;

-- Definer fn in an exposed schema: strip PUBLIC/anon execute; the gate inside
-- covers authenticated callers (revoking authenticated would break PostgREST RPC).
revoke execute on function public.import_wp_grouping(uuid, jsonb) from public;
revoke execute on function public.import_wp_grouping(uuid, jsonb) from anon;
grant execute on function public.import_wp_grouping(uuid, jsonb) to authenticated;
