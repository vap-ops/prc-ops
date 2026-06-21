-- Spec 170 / ADR 0062 U4a — worker portal binding primitive.
--
-- A DC is a worker, so the external portal binds on workers.user_id (the column
-- already exists), not on a contractor party. This unit adds the binding layer:
--   * a partial-unique index so one LINE user ↔ one worker;
--   * current_user_worker_id() — the worker analogue of current_user_contractor_id();
--   * worker_invites + create_worker_invite / claim_worker_invite (mirrors the
--     ADR-0051 contractor invite/claim, mig 20260706) — a PM issues a single-use
--     14-day token; a visitor claims it → workers.user_id set + role='contractor';
--   * worker self-read RLS (own worker row / own DC labor days);
--   * get_my_dc_payments() goes worker-direct (drops the U3 contractor bridge).
--
-- The contractor invite/claim path (subcontractor parties) is untouched; the DC
-- contractor_users binding becomes vestigial (retired in U6). Prod has zero DC /
-- portal data → no backfill. The contractor-based portal page surfaces (profile,
-- consents, bank, docs) re-home onto the worker in U4b/U4c.

-- ----------------------------------------------------------------------------
-- 1. One LINE user ↔ one worker (portal binding). Partial so the many existing
-- null user_id workers are unconstrained.
-- ----------------------------------------------------------------------------
create unique index workers_user_id_key
  on public.workers (user_id) where user_id is not null;

-- ----------------------------------------------------------------------------
-- 2. current_user_worker_id() — the worker bound to the caller, or NULL. The
-- worker analogue of current_user_contractor_id() (mig 20260706); SECURITY
-- DEFINER so the row-level policies below can call it without granting table
-- access, and it never recurses with the policies built on it.
-- ----------------------------------------------------------------------------
create function public.current_user_worker_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.workers where user_id = auth.uid();
$$;
revoke all on function public.current_user_worker_id() from public, anon;
grant execute on function public.current_user_worker_id() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. worker_invites — a PM-issued, single-use, expiring claim token (mirrors
-- contractor_invites). Writes are RPC-only (no insert/update grant).
-- ----------------------------------------------------------------------------
create table public.worker_invites (
  id          uuid primary key default gen_random_uuid(),
  worker_id   uuid not null references public.workers(id),
  token       text not null unique,
  created_by  uuid not null references public.users(id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  claimed_by  uuid references public.users(id),
  claimed_at  timestamptz,
  constraint worker_invites_token_len check (length(token) between 16 and 128)
);
create index worker_invites_token_idx on public.worker_invites (token);

alter table public.worker_invites enable row level security;
revoke all on public.worker_invites from anon, authenticated;
grant select on public.worker_invites to authenticated;
-- Staff read invites (to manage/track); creation + claim are RPC-only.
create policy "worker_invites readable by staff"
  on public.worker_invites for select to authenticated
  using (public.current_user_role() in ('project_manager', 'super_admin', 'project_director'));

-- ----------------------------------------------------------------------------
-- 4. create_worker_invite(worker) — pm/super/director issue a claim token for a
-- DC worker (ADR 0062: portal invites are for DC people, who are workers).
-- ----------------------------------------------------------------------------
create function public.create_worker_invite(p_worker uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_type  public.worker_type;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_worker_invite: role not permitted' using errcode = '42501';
  end if;
  select worker_type into v_type from public.workers where id = p_worker;
  if not found then
    raise exception 'create_worker_invite: worker not found' using errcode = 'P0001';
  end if;
  if v_type <> 'dc' then
    raise exception 'create_worker_invite: portal invites are for dc workers' using errcode = 'P0001';
  end if;
  v_token := encode(gen_random_bytes(24), 'hex');  -- 48 hex chars, unguessable
  insert into public.worker_invites (worker_id, token, created_by, expires_at)
  values (p_worker, v_token, auth.uid(), now() + interval '14 days');
  return v_token;
end;
$$;
revoke all on function public.create_worker_invite(uuid) from public, anon;
grant execute on function public.create_worker_invite(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. claim_worker_invite(token) — a freshly-logged-in DC (role 'visitor') binds
-- their LINE login to the invite's worker and becomes a 'contractor'. Guards
-- mirror claim_contractor_invite: visitor-only (protects staff), one binding per
-- user, single-use + unexpired token, and the target worker must be unlinked.
-- Audited as a role_change.
-- ----------------------------------------------------------------------------
create function public.claim_worker_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite   public.worker_invites%rowtype;
  v_role     public.user_role;
  v_existing uuid;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null then
    raise exception 'claim_worker_invite: no user' using errcode = 'P0001';
  end if;
  if v_role <> 'visitor' then
    raise exception 'claim_worker_invite: only a visitor may claim' using errcode = '42501';
  end if;
  -- One binding per user — neither a worker nor a contractor binding already.
  if exists (select 1 from public.workers where user_id = auth.uid())
     or exists (select 1 from public.contractor_users where user_id = auth.uid()) then
    raise exception 'claim_worker_invite: already bound' using errcode = 'P0001';
  end if;

  select * into v_invite from public.worker_invites where token = p_token for update;
  if not found then
    raise exception 'claim_worker_invite: invalid token' using errcode = 'P0001';
  end if;
  if v_invite.claimed_by is not null then
    raise exception 'claim_worker_invite: token already used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'claim_worker_invite: token expired' using errcode = 'P0001';
  end if;

  -- The worker must not already be linked to a different LINE user.
  select user_id into v_existing from public.workers where id = v_invite.worker_id;
  if v_existing is not null then
    raise exception 'claim_worker_invite: worker already linked' using errcode = 'P0001';
  end if;

  update public.workers set user_id = auth.uid() where id = v_invite.worker_id;
  update public.users set role = 'contractor' where id = auth.uid();
  update public.worker_invites
     set claimed_by = auth.uid(), claimed_at = now()
   where id = v_invite.id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('role_change', auth.uid(), 'contractor', 'users', auth.uid(),
          jsonb_build_object('from', 'visitor', 'to', 'contractor',
                             'worker_id', v_invite.worker_id, 'via', 'worker_invite'));
  return v_invite.worker_id;
end;
$$;
revoke all on function public.claim_worker_invite(text) from public, anon;
grant execute on function public.claim_worker_invite(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Worker self-read RLS (ADR 0051 worker arm). ADDITIVE permissive SELECT
-- policies so a DC worker reads THEIR OWN rows; an unbound/staff caller matches
-- nothing extra. day_rate / day_rate_snapshot stay column-grant-blocked. Helper
-- + auth.uid() wrapped (select …) for the RLS eval-once optimization (file-40).
-- ----------------------------------------------------------------------------
create policy "workers readable by self (portal)"
  on public.workers for select to authenticated
  using (user_id = (select auth.uid()));

create policy "labor_logs readable by self worker (portal)"
  on public.labor_logs for select to authenticated
  using (
    worker_type_snapshot = 'dc'
    and worker_id = (select public.current_user_worker_id())
  );

-- ----------------------------------------------------------------------------
-- 7. get_my_dc_payments() — drop the U3 contractor bridge; read the caller's own
-- worker payments directly via the worker binding. An unbound session (NULL
-- worker) gets zero rows. Current-state only (supersede anti-join). Signature
-- unchanged → the spec-130 grant is preserved.
-- ----------------------------------------------------------------------------
create or replace function public.get_my_dc_payments()
returns setof public.dc_payments
language sql
stable
security definer
set search_path = public
as $$
  select d.*
  from public.dc_payments d
  where public.current_user_worker_id() is not null
    and d.worker_id = public.current_user_worker_id()
    and not exists (select 1 from public.dc_payments n where n.superseded_by = d.id);
$$;
