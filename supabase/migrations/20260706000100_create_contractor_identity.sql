-- Spec 130 U1 / ADR 0051 — external partner identity + binding.
--
-- Binds an external LINE login to ONE contractor and promotes it to the
-- `contractor` role via a PM-issued invite the party claims. The
-- current_user_contractor_id() helper is the row-level-RLS primitive U2 builds
-- on (the contractor_id ownership axis, orthogonal to ADR 0013's project axis).
-- All writes go through the two SECURITY DEFINER RPCs; tables have no direct
-- write grant.

-- ----------------------------------------------------------------------------
-- contractor_users — one row per external user, bound to one contractor.
-- (Many users may belong to one contractor; a user belongs to at most one.)
-- ----------------------------------------------------------------------------
create table public.contractor_users (
  user_id       uuid primary key references public.users(id) on delete cascade,
  contractor_id uuid not null references public.contractors(id),
  created_at    timestamptz not null default now()
);
create index contractor_users_contractor_idx on public.contractor_users (contractor_id);

alter table public.contractor_users enable row level security;
revoke all on public.contractor_users from anon, authenticated;
grant select on public.contractor_users to authenticated;
-- Staff (pm/super) see every binding; an external user sees only their own.
-- Writes are RPC-only (no insert/update/delete grant).
create policy "contractor_users readable by staff or self"
  on public.contractor_users for select to authenticated
  using (
    public.current_user_role() in ('project_manager', 'super_admin')
    or user_id = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- contractor_invites — a PM-issued, single-use, expiring claim token.
-- ----------------------------------------------------------------------------
create table public.contractor_invites (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id),
  token         text not null unique,
  created_by    uuid not null references public.users(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  claimed_by    uuid references public.users(id),
  claimed_at    timestamptz,
  constraint contractor_invites_token_len check (length(token) between 16 and 128)
);
create index contractor_invites_token_idx on public.contractor_invites (token);

alter table public.contractor_invites enable row level security;
revoke all on public.contractor_invites from anon, authenticated;
grant select on public.contractor_invites to authenticated;
-- Staff read invites (to manage/track); creation + claim are RPC-only.
create policy "contractor_invites readable by staff"
  on public.contractor_invites for select to authenticated
  using (public.current_user_role() in ('project_manager', 'super_admin'));

-- ----------------------------------------------------------------------------
-- current_user_contractor_id() — the contractor bound to the caller, or NULL.
-- SECURITY DEFINER so U2's row-level policies can call it without granting
-- table access (the current_user_role() pattern, ADR 0011). Reads
-- contractor_users as definer → never recurses with the policies built on it.
-- ----------------------------------------------------------------------------
create function public.current_user_contractor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select contractor_id from public.contractor_users where user_id = auth.uid();
$$;
revoke all on function public.current_user_contractor_id() from public, anon;
grant execute on function public.current_user_contractor_id() to authenticated;

-- ----------------------------------------------------------------------------
-- create_contractor_invite(contractor) — pm/super issue a claim token.
-- ----------------------------------------------------------------------------
create function public.create_contractor_invite(p_contractor_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'create_contractor_invite: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contractors where id = p_contractor_id) then
    raise exception 'create_contractor_invite: contractor not found' using errcode = 'P0001';
  end if;
  v_token := encode(gen_random_bytes(24), 'hex');  -- 48 hex chars, unguessable
  insert into public.contractor_invites (contractor_id, token, created_by, expires_at)
  values (p_contractor_id, v_token, auth.uid(), now() + interval '14 days');
  return v_token;
end;
$$;
revoke all on function public.create_contractor_invite(uuid) from public, anon;
grant execute on function public.create_contractor_invite(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- claim_contractor_invite(token) — a freshly-logged-in external user (role
-- 'visitor') binds to the invite's contractor and becomes a 'contractor'. The
-- only sanctioned writer of role='contractor'. Guards: visitor-only (protects
-- staff accounts), one binding per user (no rebind), single-use + unexpired
-- token. Audited as a role_change.
-- ----------------------------------------------------------------------------
create function public.claim_contractor_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.contractor_invites%rowtype;
  v_role   public.user_role;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null then
    raise exception 'claim_contractor_invite: no user' using errcode = 'P0001';
  end if;
  -- Only a fresh external signup may claim; a staff account can never be
  -- converted by a token.
  if v_role <> 'visitor' then
    raise exception 'claim_contractor_invite: only a visitor may claim' using errcode = '42501';
  end if;
  if exists (select 1 from public.contractor_users where user_id = auth.uid()) then
    raise exception 'claim_contractor_invite: already bound' using errcode = 'P0001';
  end if;

  select * into v_invite from public.contractor_invites where token = p_token for update;
  if not found then
    raise exception 'claim_contractor_invite: invalid token' using errcode = 'P0001';
  end if;
  if v_invite.claimed_by is not null then
    raise exception 'claim_contractor_invite: token already used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'claim_contractor_invite: token expired' using errcode = 'P0001';
  end if;

  insert into public.contractor_users (user_id, contractor_id)
  values (auth.uid(), v_invite.contractor_id);

  update public.users set role = 'contractor' where id = auth.uid();

  update public.contractor_invites
     set claimed_by = auth.uid(), claimed_at = now()
   where id = v_invite.id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('role_change', auth.uid(), 'contractor', 'users', auth.uid(),
          jsonb_build_object('from', 'visitor', 'to', 'contractor',
                             'contractor_id', v_invite.contractor_id,
                             'via', 'contractor_invite'));
  return v_invite.contractor_id;
end;
$$;
revoke all on function public.claim_contractor_invite(text) from public, anon;
grant execute on function public.claim_contractor_invite(text) to authenticated;
