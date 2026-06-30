-- Spec 233 / ADR 0067 — the only sanctioned writers for client portal access.
-- Bodies cloned from the live create_contractor_invite / claim_contractor_invite
-- (token gen + SHA-256 hashing via extensions.digest; visitor-only claim; audit).
-- All three: SECURITY DEFINER, search_path = public, EXECUTE revoked from
-- public/anon and granted to authenticated, null-safe role gate (coalesce-false).

-- Issue a single-use invite link for a project; returns the cleartext token.
-- Gate: project_director / super_admin only (NOT pm). Audited.
create function public.create_client_invite(p_project uuid, p_valid_until timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  if not coalesce((select public.current_user_role()) in ('project_director', 'super_admin'), false) then
    raise exception 'create_client_invite: role not permitted' using errcode = '42501';
  end if;
  if p_valid_until is null then
    raise exception 'create_client_invite: valid-until required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'create_client_invite: project not found' using errcode = 'P0001';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.client_invites (token_hash, project_id, access_expires_at, created_by)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_project, p_valid_until, auth.uid());

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), (select public.current_user_role()), 'client_invites', p_project,
          jsonb_build_object('event', 'client_invite_created',
                             'project_id', p_project, 'access_expires_at', p_valid_until));
  return v_token;
end;
$$;
revoke execute on function public.create_client_invite(uuid, timestamptz) from public, anon;
grant  execute on function public.create_client_invite(uuid, timestamptz) to authenticated;

-- The ONLY sanctioned visitor → client writer. Visitor-only (a staff/contractor
-- identity is rejected — no silent role flip); single-use; ≤14-day link. Flips
-- the role, binds the access row (stamped with the invite's access_expires_at),
-- marks the token claimed, audits the role change.
create function public.claim_client_invite(p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_invite public.client_invites%rowtype;
  v_role   public.user_role;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null then
    raise exception 'claim_client_invite: no user' using errcode = 'P0001';
  end if;
  if v_role <> 'visitor' then
    raise exception 'claim_client_invite: only a visitor may claim' using errcode = '42501';
  end if;

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
  values (auth.uid(), v_invite.project_id, v_invite.created_by, v_invite.access_expires_at);

  update public.users set role = 'client' where id = auth.uid();

  update public.client_invites set claimed_by = auth.uid(), claimed_at = now()
   where id = v_invite.id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('role_change', auth.uid(), 'client', 'users', auth.uid(),
          jsonb_build_object('from', 'visitor', 'to', 'client',
                             'project_id', v_invite.project_id, 'via', 'client_invite'));
end;
$$;
revoke execute on function public.claim_client_invite(text) from public, anon;
grant  execute on function public.claim_client_invite(text) to authenticated;

-- Early revoke. Gate: project_director / super_admin only. Idempotent guard
-- (already-revoked / unknown → P0001). Audited.
create function public.revoke_client_access(p_access_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
begin
  if not coalesce((select public.current_user_role()) in ('project_director', 'super_admin'), false) then
    raise exception 'revoke_client_access: role not permitted' using errcode = '42501';
  end if;

  update public.client_portal_access
     set revoked_at = now(), revoked_by = auth.uid()
   where id = p_access_id and revoked_at is null
   returning project_id into v_project;
  if not found then
    raise exception 'revoke_client_access: access not found or already revoked' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), (select public.current_user_role()), 'client_portal_access', p_access_id,
          jsonb_build_object('event', 'client_access_revoked', 'project_id', v_project));
end;
$$;
revoke execute on function public.revoke_client_access(uuid) from public, anon;
grant  execute on function public.revoke_client_access(uuid) to authenticated;
