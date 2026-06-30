-- Spec 220 / ADR 0050 (G63) — super_admin changes a user's role in-app.
--
-- ADR 0019 REVOKEd UPDATE on public.users from authenticated (no direct user
-- write), so this single SECURITY DEFINER RPC is the one gated, owner-privileged,
-- audited exception. Gate is on the AUTHENTICATED session (current_user_role() =
-- 'super_admin') — never call via the admin client (service-role has no auth.uid()
-- → no actor stamp + a null role would fail the gate anyway). Exactly one
-- audit_log row (action 'role_change', old→new). Guard-railed per ADR 0050.

create function public.set_user_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_actor_role  public.user_role := public.current_user_role();
  v_current     public.user_role;
  v_super_count int;
begin
  -- 1. Gate: super_admin only (null-safe — a null/anon role is rejected, not
  --    silently treated as a match).
  if v_actor_role is null or v_actor_role <> 'super_admin' then
    raise exception 'set_user_role: super_admin only' using errcode = '42501';
  end if;

  -- 2. Target must exist.
  select role into v_current from public.users where id = p_user_id;
  if not found then
    raise exception 'set_user_role: unknown user' using errcode = '22023';
  end if;

  -- 3. No-op: already has the role (idempotent — no change, no audit row).
  if v_current = p_role then
    return;
  end if;

  -- 4. Last-super_admin lockout. Checked BEFORE the self guard so both are
  --    reachable: a lone super_admin demoting self trips this; a super_admin
  --    demoting self while another super_admin remains trips the self guard.
  if v_current = 'super_admin' and p_role <> 'super_admin' then
    select count(*) into v_super_count from public.users where role = 'super_admin';
    if v_super_count <= 1 then
      raise exception 'set_user_role: cannot remove the last super_admin'
        using errcode = '22023';
    end if;
  end if;

  -- 5. Self-demotion guard — a super_admin cannot change their own role (forces a
  --    second super_admin to do it; avoids accidental self-lockout).
  if p_user_id = v_actor then
    raise exception 'set_user_role: cannot change your own role' using errcode = '22023';
  end if;

  -- 6. Apply + audit (exactly one row).
  update public.users set role = p_role, updated_at = now() where id = p_user_id;
  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, payload)
  values
    (v_actor, v_actor_role, 'role_change', 'users', p_user_id,
     jsonb_build_object('from', v_current, 'to', p_role));
end;
$$;

revoke all on function public.set_user_role(uuid, public.user_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated;
