-- Spec 336 — category-derived งานย่อย codes (W05-01), retiring the WP- convention.
--
-- Additive, forward-only: no existing row is recoded and no constraint ties a
-- code to its category. Two changes:
--
-- 1. create_work_package gains a trailing p_category_id (default null) so a new
--    งานย่อย is created WITH the category its code claims. Without it the code
--    would say W05 on a row whose category_id is null (17 of 349 leaves are in
--    that state today). Body sourced from the LIVE function, DROP+CREATE because
--    adding a defaulted parameter changes the signature — exactly the shape spec
--    270 U4 used to add p_parent_id (mig 072700).
--
-- 2. suggest_work_package_code returns the next free <category>-NN for a project.
--    SECURITY INVOKER on purpose: it only reads work_packages/project_categories,
--    so the caller's RLS is the correct and sufficient gate. One round trip keeps
--    the งาน detail's group branch free of a waterfall.

drop function if exists public.create_work_package(uuid, text, text, text, uuid);

create function public.create_work_package(
  p_project_id uuid,
  p_code text,
  p_name text,
  p_description text default null,
  p_parent_id uuid default null,
  p_category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_id   uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'create_work_package: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or char_length(v_code) > 50 then
    raise exception 'create_work_package: invalid code' using errcode = '22023';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'create_work_package: invalid name' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_work_package: unknown project' using errcode = '22023';
  end if;
  -- A category from another project would silently mislabel the row.
  if p_category_id is not null and not exists (
    select 1
    from public.project_categories pc
    where pc.id = p_category_id
      and pc.project_id = p_project_id
  ) then
    raise exception 'create_work_package: category not in project' using errcode = '22023';
  end if;

  insert into public.work_packages (project_id, code, name, description, parent_id, category_id)
  values (p_project_id, v_code, v_name, v_desc, p_parent_id, p_category_id)
  returning id into v_id;

  return v_id;
end;
$function$;

revoke execute on function public.create_work_package(uuid, text, text, text, uuid, uuid) from anon;
grant execute on function public.create_work_package(uuid, text, text, text, uuid, uuid) to authenticated;

create or replace function public.suggest_work_package_code(
  p_project_id uuid,
  p_category_id uuid
)
returns text
language sql
stable
security invoker
set search_path to 'public'
as $function$
  -- Numbering is per PROJECT + CATEGORY, not per parent งาน: (project_id, code)
  -- is unique, so two งาน sharing a category would collide under per-งาน numbering.
  -- Only codes already in <category>-<digits> form count, so the legacy WP-* rows
  -- neither block a number nor inflate it.
  select pc.code || '-' || lpad(
           (coalesce(max(substring(w.code from '^' || pc.code || '-([0-9]+)$')::int), 0) + 1)::text,
           2,
           '0'
         )
  from public.project_categories pc
  left join public.work_packages w
    on w.project_id = p_project_id
   and w.code ~ ('^' || pc.code || '-[0-9]+$')
  where pc.id = p_category_id
    and pc.project_id = p_project_id
  group by pc.code;
$function$;

revoke execute on function public.suggest_work_package_code(uuid, uuid) from anon;
grant execute on function public.suggest_work_package_code(uuid, uuid) to authenticated;
