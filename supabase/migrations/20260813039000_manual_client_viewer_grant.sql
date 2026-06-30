-- Spec 234 follow-up (broken-link STOPGAP) — relax grant_client_access so a
-- PD/super can attach a VISITOR (flipping them to client — the manual, no-token
-- equivalent of the currently-broken claim link) OR an existing client. Staff
-- and contractor targets stay ineligible (never demote / silent-flip a staffer).
-- Body = the LIVE grant_client_access (mig 038000) with the target gate widened
-- and a visitor-flip branch. DROP+CREATE (signature unchanged).
drop function if exists public.grant_client_access(uuid, uuid, timestamptz);
create function public.grant_client_access(
  p_user_id uuid, p_project uuid, p_valid_until timestamptz
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_access_id   uuid;
  v_target_role public.user_role;
  v_was_visitor boolean;
begin
  if not coalesce((select public.current_user_role()) in ('project_director', 'super_admin'), false) then
    raise exception 'grant_client_access: role not permitted' using errcode = '42501';
  end if;
  if p_valid_until is null then
    raise exception 'grant_client_access: valid-until required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'grant_client_access: project not found' using errcode = 'P0001';
  end if;

  select role into v_target_role from public.users where id = p_user_id;
  if v_target_role is null then
    raise exception 'grant_client_access: user not found' using errcode = 'P0001';
  end if;
  -- A PD/super may grant a visitor (flip → client) or an existing client. Staff
  -- and contractor are never converted (no demotion / no silent flip).
  if v_target_role not in ('visitor', 'client') then
    raise exception 'grant_client_access: target is not eligible (must be a visitor or client)'
      using errcode = 'P0001';
  end if;
  v_was_visitor := (v_target_role = 'visitor');

  insert into public.client_portal_access (user_id, project_id, granted_by, expires_at)
  values (p_user_id, p_project, auth.uid(), p_valid_until)
  on conflict (user_id, project_id) do update
    set expires_at = excluded.expires_at,
        granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = null,
        revoked_by = null
  returning id into v_access_id;

  if v_was_visitor then
    update public.users set role = 'client' where id = p_user_id;
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('role_change', auth.uid(), (select public.current_user_role()), 'users', p_user_id,
            jsonb_build_object('from', 'visitor', 'to', 'client',
                               'project_id', p_project, 'via', 'manual_grant'));
  else
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('other', auth.uid(), (select public.current_user_role()), 'client_portal_access', v_access_id,
            jsonb_build_object('event', 'client_access_granted',
                               'user_id', p_user_id, 'project_id', p_project,
                               'access_expires_at', p_valid_until));
  end if;
end;
$$;
revoke execute on function public.grant_client_access(uuid, uuid, timestamptz) from public, anon;
grant  execute on function public.grant_client_access(uuid, uuid, timestamptz) to authenticated;
