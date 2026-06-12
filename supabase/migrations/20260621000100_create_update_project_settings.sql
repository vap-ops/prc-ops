-- Spec 58 / ADR 0042 — back-office project settings write path.
--
-- ADR 0013 keeps projects UPDATE at super_admin only; this RPC is the
-- column-scoped escape hatch (the spec-31 set_work_package_contractor
-- shape): name + status ONLY, role check inside, code untouchable.
-- ADR 0011 checklist: SECURITY DEFINER with search_path pinned,
-- revoke-then-grant execute, no row-leaking error paths.

create function public.update_project_settings(
  p_project_id uuid,
  p_name text,
  p_status public.project_status
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'update_project_settings: role not permitted'
      using errcode = '42501';
  end if;

  -- Defense in depth with the app validator (spec 58): no caller can
  -- write a blank or oversized project name.
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'update_project_settings: invalid name'
      using errcode = '22023';
  end if;

  update public.projects
     set name = v_name,
         status = p_status
   where id = p_project_id;
  return found;
end;
$$;

revoke all on function public.update_project_settings(uuid, text, public.project_status)
  from public, anon;
grant execute on function public.update_project_settings(uuid, text, public.project_status)
  to authenticated;
