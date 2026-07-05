-- Spec 266 / ADR 0073 U7 — worker portal role split: a claimed ช่าง becomes a
-- `technician` (was `contractor`). ADR 0073 §4. The subcontractor claim
-- (claim_contractor_invite) stays `contractor`, and `create_worker_invite` is
-- unchanged (U1 already repointed it to read pay_type='daily').
--
-- Data access is NOT touched: the worker portal gates on
-- workers.user_id = auth.uid() (current_user_worker_id()), never on the caller's
-- role, so this flip is routing + label only — not an RLS change. The three
-- `contractor` role tokens below (the users.role update, the audit actor_role,
-- and the audit payload 'to') become `technician`.
--
-- Body re-sourced verbatim from the LIVE definition (pg_get_functiondef) per the
-- db-migration lessons (never hand-copy an old migration file). CREATE OR REPLACE
-- preserves the existing EXECUTE grants + the anon/public revoke. AUTH-path →
-- operator-held merge (danger-path guard holds this PR by design).

create or replace function public.claim_worker_invite(p_token text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_invite   public.worker_invites%rowtype;
  v_role     public.user_role;
  v_existing uuid;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null then
    raise exception 'claim_worker_invite: no user' using errcode = 'P0001';
  end if;
  if v_role is null or v_role <> 'visitor' then
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
  update public.users set role = 'technician' where id = auth.uid();
  update public.worker_invites
     set claimed_by = auth.uid(), claimed_at = now()
   where id = v_invite.id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('role_change', auth.uid(), 'technician', 'users', auth.uid(),
          jsonb_build_object('from', 'visitor', 'to', 'technician',
                             'worker_id', v_invite.worker_id, 'via', 'worker_invite'));
  return v_invite.worker_id;
end;
$function$;
