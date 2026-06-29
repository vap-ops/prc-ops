-- ERD audit (2026-06-29) — finding M1 (the only at-rest credential-leak vector).
-- contractor_invites.token and worker_invites.token were stored PLAINTEXT and
-- exposed to staff via a whole-row SELECT grant. A token is a replayable bearer
-- credential that binds a LINE account and flips a visitor to the `contractor`
-- role. A DB read / backup leak therefore leaks live, usable invites.
--
-- Fix: store only a SHA-256 digest of the token. The create RPC still returns
-- the cleartext ONCE (the PM pastes it into the claim URL); the claim RPC hashes
-- the presented token and compares digests. After this migration the plaintext
-- column is gone, so even a full-row read yields nothing replayable.
--
-- Contract preserved (no src change): RPC signatures unchanged (create returns
-- text cleartext, claim takes text), and the claim "invalid token" message is
-- kept verbatim — src/lib/portal/actions.ts relays worker→contractor by matching
-- that exact substring.
--
-- Backfill preserves OUTSTANDING invites: the cleartext lives only in the URL the
-- PM already sent; hashing the existing plaintext to token_hash means that URL
-- still claims successfully. pgcrypto is installed in schema `extensions`
-- (verified) — digest() is schema-qualified because these definers run with
-- search_path=public (the historical gen_random_bytes failure was the unqualified
-- call; see 20260706000200 / 20260785000000).
--
-- NOTE (destructive): this DROPs the plaintext `token` column. That data loss is
-- the intent (it is the secret we are removing) and is safe — token_hash is
-- backfilled first and outstanding invites are preserved.

-- ----------------------------------------------------------------------------
-- 1. Add token_hash, backfill from the existing plaintext, lock it down.
-- ----------------------------------------------------------------------------
alter table public.contractor_invites add column token_hash text;
update public.contractor_invites
  set token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
alter table public.contractor_invites alter column token_hash set not null;
alter table public.contractor_invites
  add constraint contractor_invites_token_hash_key unique (token_hash);

alter table public.worker_invites add column token_hash text;
update public.worker_invites
  set token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
alter table public.worker_invites alter column token_hash set not null;
alter table public.worker_invites
  add constraint worker_invites_token_hash_key unique (token_hash);

-- ----------------------------------------------------------------------------
-- 2. create_contractor_invite — store the digest, return cleartext once.
--    Body sourced verbatim from LIVE (20260813017000, is_manager gate); only the
--    INSERT column (token -> token_hash) changes.
-- ----------------------------------------------------------------------------
create or replace function public.create_contractor_invite(p_contractor_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'create_contractor_invite: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contractors where id = p_contractor_id) then
    raise exception 'create_contractor_invite: contractor not found' using errcode = 'P0001';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.contractor_invites (contractor_id, token_hash, created_by, expires_at)
  values (p_contractor_id, encode(extensions.digest(v_token, 'sha256'), 'hex'),
          auth.uid(), now() + interval '14 days');
  return v_token;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 3. create_worker_invite — same. Body verbatim from LIVE (20260813016000,
--    is_back_office gate); only the INSERT column changes.
-- ----------------------------------------------------------------------------
create or replace function public.create_worker_invite(p_worker uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
  v_type  public.worker_type;
begin
  if not public.is_back_office(public.current_user_role()) then
    raise exception 'create_worker_invite: role not permitted' using errcode = '42501';
  end if;
  select worker_type into v_type from public.workers where id = p_worker;
  if not found then
    raise exception 'create_worker_invite: worker not found' using errcode = 'P0001';
  end if;
  if v_type <> 'dc' then
    raise exception 'create_worker_invite: portal invites are for dc workers' using errcode = 'P0001';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.worker_invites (worker_id, token_hash, created_by, expires_at)
  values (p_worker, encode(extensions.digest(v_token, 'sha256'), 'hex'),
          auth.uid(), now() + interval '14 days');
  return v_token;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 4. claim_contractor_invite — hash the presented token, compare digests.
--    Body verbatim from LIVE (20260706000100); only the lookup predicate changes
--    (token = p_token -> token_hash = digest(p_token)). "invalid token" message
--    is preserved (the portal relay depends on it).
-- ----------------------------------------------------------------------------
create or replace function public.claim_contractor_invite(p_token text)
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
  if v_role <> 'visitor' then
    raise exception 'claim_contractor_invite: only a visitor may claim' using errcode = '42501';
  end if;
  if exists (select 1 from public.contractor_users where user_id = auth.uid()) then
    raise exception 'claim_contractor_invite: already bound' using errcode = 'P0001';
  end if;

  select * into v_invite from public.contractor_invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
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

-- ----------------------------------------------------------------------------
-- 5. claim_worker_invite — same. Body verbatim from LIVE (20260784000000); only
--    the lookup predicate changes. "invalid token" message preserved.
-- ----------------------------------------------------------------------------
create or replace function public.claim_worker_invite(p_token text)
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
  if exists (select 1 from public.workers where user_id = auth.uid())
     or exists (select 1 from public.contractor_users where user_id = auth.uid()) then
    raise exception 'claim_worker_invite: already bound' using errcode = 'P0001';
  end if;

  select * into v_invite from public.worker_invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then
    raise exception 'claim_worker_invite: invalid token' using errcode = 'P0001';
  end if;
  if v_invite.claimed_by is not null then
    raise exception 'claim_worker_invite: token already used' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'claim_worker_invite: token expired' using errcode = 'P0001';
  end if;

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

-- ----------------------------------------------------------------------------
-- 6. Drop the plaintext column (auto-drops contractor_invites_token_idx /
--    worker_invites_token_idx, the inline UNIQUE, and the *_token_len CHECKs).
-- ----------------------------------------------------------------------------
alter table public.contractor_invites drop column token;
alter table public.worker_invites drop column token;
