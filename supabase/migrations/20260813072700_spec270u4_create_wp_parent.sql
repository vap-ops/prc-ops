-- Spec 270 U4 — create_work_package gains a trailing p_parent_id (default null).
-- Why: the U6 forward guard (072500) rejects a parentless งานย่อย INSERT in any
-- project that already has งาน rows — so the 4-arg RPC made "+ เพิ่มงาน" fail
-- (23514) in adopted projects (PRC-2026-004 since the 2026-07-06 import). The
-- creation UI now requires a parent pick there; this carries it through.
-- Parent VALIDATION stays in wp_hierarchy_guard (same-project · is_group ·
-- depth · U6 mandatory-forward) — the RPC only passes the value.
-- Body sourced VERBATIM from LIVE (pg_get_functiondef, 2026-07-06) + the two
-- parent lines; DROP+CREATE because adding a parameter changes the signature.
-- Additive tier: no data change, old callers keep working (trailing default).

drop function public.create_work_package(uuid, text, text, text);

create function public.create_work_package(
  p_project_id uuid,
  p_code text,
  p_name text,
  p_description text default null::text,
  p_parent_id uuid default null::uuid
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

  insert into public.work_packages (project_id, code, name, description, parent_id)
  values (p_project_id, v_code, v_name, v_desc, p_parent_id)
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.create_work_package(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.create_work_package(uuid, text, text, text, uuid) to authenticated;

comment on function public.create_work_package(uuid, text, text, text, uuid) is
  'Creates a work package (PM/PD/super; SECURITY DEFINER role gate). Spec 270 U4: '
  'trailing p_parent_id (default null) — required in practice for a งานย่อย in a '
  'project that has adopted งาน grouping (U6 forward guard); parent validity is '
  'enforced by wp_hierarchy_guard, not here.';
