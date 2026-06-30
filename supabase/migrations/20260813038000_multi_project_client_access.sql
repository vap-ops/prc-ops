-- Spec 234 / ADR 0067 — multi-project client access. A NEW direct-grant RPC and
-- a re-entrant claim (visitor OR client). No table/RLS change — client_portal_access
-- and the four read arms (migration 035000) are already per-project.

-- Direct grant: PD/super attach an EXISTING client login to a project. ON CONFLICT
-- un-revokes + refreshes the valid-until (resolves the spec-233 "revoke is
-- terminal per pair" limit).
create function public.grant_client_access(
  p_user_id uuid, p_project uuid, p_valid_until timestamptz
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_access_id uuid;
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
  -- Only an EXISTING client login (a person who already claimed in via LINE).
  if not exists (select 1 from public.users where id = p_user_id and role = 'client') then
    raise exception 'grant_client_access: target is not a client' using errcode = 'P0001';
  end if;

  insert into public.client_portal_access (user_id, project_id, granted_by, expires_at)
  values (p_user_id, p_project, auth.uid(), p_valid_until)
  on conflict (user_id, project_id) do update
    set expires_at = excluded.expires_at,
        granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = null,
        revoked_by = null
  returning id into v_access_id;

  -- target = the access binding row (mirrors revoke_client_access, mig 036000).
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), (select public.current_user_role()), 'client_portal_access', v_access_id,
          jsonb_build_object('event', 'client_access_granted',
                             'user_id', p_user_id, 'project_id', p_project,
                             'access_expires_at', p_valid_until));
end;
$$;
revoke execute on function public.grant_client_access(uuid, uuid, timestamptz) from public, anon;
grant  execute on function public.grant_client_access(uuid, uuid, timestamptz) to authenticated;

-- Re-entrant claim: a visitor (first bind, flips role) OR an existing client
-- (additional project, no flip) may claim. Body is the LIVE claim_client_invite
-- (migration 036000, sourced via pg_get_functiondef) with the gate widened, the
-- insert made ON CONFLICT DO UPDATE (un-revoke), and the role-flip + audit
-- branched on whether the caller was a visitor. DROP+CREATE (signature unchanged).
drop function if exists public.claim_client_invite(text);
create function public.claim_client_invite(p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_invite      public.client_invites%rowtype;
  v_role        public.user_role;
  v_was_visitor boolean;
  v_access_id   uuid;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null then
    raise exception 'claim_client_invite: no user' using errcode = 'P0001';
  end if;
  if v_role not in ('visitor', 'client') then
    raise exception 'claim_client_invite: only a visitor or client may claim' using errcode = '42501';
  end if;
  v_was_visitor := (v_role = 'visitor');

  select * into v_invite from public.client_invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then
    raise exception 'claim_client_invite: invalid token' using errcode = 'P0001';
  end if;
  if v_invite.claimed_by is not null then
    raise exception 'claim_client_invite: token already used' using errcode = 'P0001';
  end if;
  if v_invite.created_at < now() - interval '14 days' then
    raise exception 'claim_client_invite: token expired' using errcode = 'P0001';
  end if;

  insert into public.client_portal_access (user_id, project_id, granted_by, expires_at)
  values (auth.uid(), v_invite.project_id, v_invite.created_by, v_invite.access_expires_at)
  on conflict (user_id, project_id) do update
    set expires_at = excluded.expires_at,
        granted_by = excluded.granted_by,
        granted_at = now(),
        revoked_at = null,
        revoked_by = null
  returning id into v_access_id;

  if v_was_visitor then
    update public.users set role = 'client' where id = auth.uid();
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('role_change', auth.uid(), 'client', 'users', auth.uid(),
            jsonb_build_object('from', 'visitor', 'to', 'client',
                               'project_id', v_invite.project_id, 'via', 'client_invite'));
  else
    -- target = the access binding row (mirrors revoke_client_access, mig 036000).
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('other', auth.uid(), 'client', 'client_portal_access', v_access_id,
            jsonb_build_object('event', 'client_access_granted',
                               'project_id', v_invite.project_id, 'via', 'client_invite'));
  end if;

  update public.client_invites set claimed_by = auth.uid(), claimed_at = now()
   where id = v_invite.id;
end;
$$;
revoke execute on function public.claim_client_invite(text) from public, anon;
grant  execute on function public.claim_client_invite(text) to authenticated;
