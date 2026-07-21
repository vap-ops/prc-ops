-- Spec 336 review fixes — three defects in 075823, found by fresh-eyes review
-- before the PR landed. Applied migrations are never edited, so this is new.
--
-- 1. lpad TRUNCATES on the right: lpad('100', 2, '0') = '10' (verified live).
--    The moment a project+category series passes 99 — or anyone hand-types
--    W05-100, which D4 explicitly allows — every later suggestion for that
--    category would be 'W05-10' forever, colliding on unique(project_id, code).
--    Zero-padding is now explicit and never shortens a number.
--
-- 2. pc.code was interpolated into a regex UNESCAPED and project_categories.code
--    has no format constraint. A code like 'W.5' would match 'WX5-01' and inflate
--    the number; 'W(5' would raise invalid-regex and kill the suggester for that
--    category. The prefix test is now plain string comparison; the only regex
--    left is a CONSTANT applied to the remainder.
--
-- 3. ::int over an unbounded digit run overflows (22003) on a hand-typed
--    W05-99999999999 — codes allow 50 chars. The remainder is now bounded to 9
--    digits before casting, and cast to bigint.
--
-- Plus a parity gap: create_work_package accepted a DEACTIVATED category, which
-- the designated sole writer set_work_package_category refuses. It now matches.

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
  -- is unique, so two งาน sharing a category would collide under per-งาน
  -- numbering. Legacy WP-* codes match no category prefix, so they neither
  -- block a number nor inflate one.
  select pc.code || '-' ||
         case when x.n < 10 then '0' || x.n::text else x.n::text end
  from public.project_categories pc
  cross join lateral (
    select coalesce(max(taken.suffix), 0) + 1 as n
    from (
      select substring(w.code from length(pc.code) + 2)::bigint as suffix
      from public.work_packages w
      where w.project_id = p_project_id
        -- Plain prefix comparison — pc.code never reaches a regex engine.
        and left(w.code, length(pc.code) + 1) = pc.code || '-'
        -- Constant regex, and the 1..9 bound keeps the cast inside bigint.
        and substring(w.code from length(pc.code) + 2) ~ '^[0-9]{1,9}$'
    ) taken
  ) x
  where pc.id = p_category_id
    and pc.project_id = p_project_id;
$function$;

comment on function public.suggest_work_package_code(uuid, uuid) is
  'Spec 336 — the next free <project category code>-NN for a project. Read-only and SECURITY INVOKER: the caller''s RLS on project_categories/work_packages is the gate. Returns NULL when the category does not belong to the project. A suggestion only; the code field stays editable (spec 336 D4).';

create or replace function public.create_work_package(
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
  -- Same-project AND active, matching set_work_package_category (mig 003400):
  -- binding a deactivated category here would let this path do what the
  -- designated writer refuses.
  if p_category_id is not null and not exists (
    select 1
    from public.project_categories pc
    where pc.id = p_category_id
      and pc.project_id = p_project_id
      and pc.is_active
  ) then
    raise exception 'create_work_package: category not in project or inactive'
      using errcode = '22023';
  end if;

  insert into public.work_packages (project_id, code, name, description, parent_id, category_id)
  values (p_project_id, v_code, v_name, v_desc, p_parent_id, p_category_id)
  returning id into v_id;

  return v_id;
end;
$function$;

comment on function public.create_work_package(uuid, text, text, text, uuid, uuid) is
  'Spec 142 U4 / 270 U4 / 336 — create a work package. Manager-tier only. p_parent_id carries the parent งาน (wp_hierarchy_guard validates it); p_category_id sets the work category at insert time, validated same-project AND active.';

comment on column public.work_packages.category_id is
  'Spec 207 — the WP''s single project work-category (หมวดงาน). NULL = uncategorised. Set at insert by create_work_package (spec 336) and thereafter only via set_work_package_category. ON DELETE SET NULL, though project_categories has no delete (deactivate-not-delete), so the action is structurally moot.';
