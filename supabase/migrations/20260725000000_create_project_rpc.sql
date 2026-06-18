-- Spec 142 U1 — project onboarding data layer.
--
-- Today a project can only be created at the service-role layer (a migration or
-- the console). This adds the sanctioned in-app write path.
--
-- create_project is SECURITY DEFINER and gates on role internally
-- (project_manager / super_admin) — exactly like update_project_settings
-- (spec 79) lets PMs write while the projects UPDATE policy stays super-only.
-- The projects INSERT policy is intentionally NOT widened here: the RPC is the
-- PM path, a direct INSERT stays super_admin-only (ADR 0013 posture).
--
-- It also auto-adds the creator as a project_members row: the PM who onboards a
-- project is on its team (operator request, 2026-06-18). Members are display /
-- accountability metadata today (ADR 0032) and the access hook for the future
-- PM-visibility change (spec 143).

-- ----------------------------------------------------------------------------
-- create_project — insert a project stub + auto-enrol the creator.
-- ----------------------------------------------------------------------------
create function public.create_project(
  p_code         text,
  p_name         text,
  p_project_type public.project_type default null,
  p_client_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_uid  uuid := auth.uid();
  v_id   uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'create_project: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or char_length(v_code) > 50 then
    raise exception 'create_project: invalid code' using errcode = '22023';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'create_project: invalid name' using errcode = '22023';
  end if;
  if p_client_id is not null
     and not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'create_project: unknown client' using errcode = '22023';
  end if;

  insert into public.projects (code, name, project_type, client_id)
  values (v_code, v_name, p_project_type, p_client_id)
  returning id into v_id;

  -- The onboarding PM joins the team. added_by = creator = self.
  insert into public.project_members (project_id, user_id, added_by)
  values (v_id, v_uid, v_uid);

  return v_id;
end;
$$;

revoke all on function
  public.create_project(text, text, public.project_type, uuid)
  from public, anon;
grant execute on function
  public.create_project(text, text, public.project_type, uuid)
  to authenticated;

comment on function public.create_project(text, text, public.project_type, uuid) is
  'Spec 142 — create a project stub (PM/super, SECURITY DEFINER). Auto-adds the creator as a project_members row. Duplicate code raises 23505 for the UI to re-suggest.';

-- ----------------------------------------------------------------------------
-- suggest_project_code — next PRC-YYYY-NNN for the current year (advisory).
-- Definer read bypasses RLS so a PM who (under spec 143) cannot see every
-- project still gets a correct next number.
-- ----------------------------------------------------------------------------
create function public.suggest_project_code()
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_year text := to_char(current_date, 'YYYY');
  v_max  int;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'suggest_project_code: role not permitted' using errcode = '42501';
  end if;
  select coalesce(max(substring(code from '^PRC-' || v_year || '-([0-9]+)$')::int), 0)
    into v_max
    from public.projects
   where code ~ ('^PRC-' || v_year || '-[0-9]+$');
  return 'PRC-' || v_year || '-' || lpad((v_max + 1)::text, 3, '0');
end;
$$;

revoke all on function public.suggest_project_code() from public, anon;
grant execute on function public.suggest_project_code() to authenticated;

comment on function public.suggest_project_code() is
  'Spec 142 — next PRC-YYYY-NNN code for the current year. Advisory/editable; the unique constraint on projects.code is the guard.';
