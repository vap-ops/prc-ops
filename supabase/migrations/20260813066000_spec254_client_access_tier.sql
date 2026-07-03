-- Spec 254 — client access tier (basic/full, extends spec 233/234 ADR 0067).
-- A PD/super grants a client `full` access: all-status photos (defect phase
-- STAYS excluded per spec 248 — untouched by this migration) + WP category +
-- priority on the drill page. Money/notes stay locked (spec 233 D7).
--
-- RPC bodies below are copied VERBATIM from LIVE (queried immediately before
-- writing this file), not from the original spec-233 migration file — LIVE
-- has already drifted: client_invites stores `token_hash` (M1 hashing fix,
-- migration 024000), and the photo RLS arm already excludes phase='defect'
-- (spec 248, migration 060000). Only the tier-related lines are new.

create type public.client_access_tier as enum ('basic', 'full');

alter table public.client_portal_access
  add column tier public.client_access_tier not null default 'basic';
alter table public.client_invites
  add column tier public.client_access_tier not null default 'basic';

-- Mirrors client_has_live_access, plus the tier check.
create function public.client_has_full_access(p_project uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.client_portal_access a
    where a.user_id = (select auth.uid())
      and a.project_id = p_project
      and a.tier = 'full'
      and a.revoked_at is null
      and (a.expires_at is null or a.expires_at > now())
  );
$function$;

revoke all on function public.client_has_full_access(uuid) from public, anon;
grant execute on function public.client_has_full_access(uuid) to authenticated;

-- create_client_invite gains a trailing p_tier — a new PARAMETER COUNT is a
-- distinct signature to Postgres (grants don't carry, exact-arity calls would
-- keep resolving to the old 2-arg overload) — DROP the old signature first
-- (DB-migration-lessons: DROP+CREATE on a signature change, never a silent
-- second overload).
drop function public.create_client_invite(uuid, timestamptz);

create function public.create_client_invite(
  p_project uuid,
  p_valid_until timestamptz,
  p_tier public.client_access_tier default 'basic'
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  insert into public.client_invites (token_hash, project_id, access_expires_at, created_by, tier)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_project, p_valid_until, auth.uid(), p_tier);

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), (select public.current_user_role()), 'client_invites', p_project,
          jsonb_build_object('event', 'client_invite_created',
                             'project_id', p_project, 'access_expires_at', p_valid_until, 'tier', p_tier));
  return v_token;
end;
$function$;

revoke all on function public.create_client_invite(uuid, timestamptz, public.client_access_tier) from public, anon;
grant execute on function public.create_client_invite(uuid, timestamptz, public.client_access_tier) to authenticated;

-- claim_client_invite keeps its signature (p_token text) — CREATE OR REPLACE
-- is enough. Propagates v_invite.tier onto BOTH the fresh-grant insert and
-- the re-entrant/un-revoke on-conflict-update path (spec 234 D5).
create or replace function public.claim_client_invite(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if v_role is null or v_role not in ('visitor', 'client') then
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

  insert into public.client_portal_access (user_id, project_id, granted_by, expires_at, tier)
  values (auth.uid(), v_invite.project_id, v_invite.created_by, v_invite.access_expires_at, v_invite.tier)
  on conflict (user_id, project_id) do update
    set expires_at = excluded.expires_at,
        granted_by = excluded.granted_by,
        granted_at = now(),
        tier = excluded.tier,
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
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('other', auth.uid(), 'client', 'client_portal_access', v_access_id,
            jsonb_build_object('event', 'client_access_granted',
                               'project_id', v_invite.project_id, 'via', 'client_invite'));
  end if;

  update public.client_invites set claimed_by = auth.uid(), claimed_at = now()
   where id = v_invite.id;
end;
$function$;

-- New RPC: PD/super upgrades or downgrades an existing binding's tier
-- without re-inviting (D2). Same gate as revoke_client_access.
create function public.set_client_access_tier(p_access_id uuid, p_tier public.client_access_tier)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_project uuid;
begin
  if not coalesce((select public.current_user_role()) in ('project_director', 'super_admin'), false) then
    raise exception 'set_client_access_tier: role not permitted' using errcode = '42501';
  end if;

  update public.client_portal_access
     set tier = p_tier
   where id = p_access_id and revoked_at is null
   returning project_id into v_project;
  if not found then
    raise exception 'set_client_access_tier: access not found or revoked' using errcode = 'P0001';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('other', auth.uid(), (select public.current_user_role()), 'client_portal_access', p_access_id,
          jsonb_build_object('event', 'client_access_tier_changed', 'project_id', v_project, 'tier', p_tier));
end;
$function$;

revoke all on function public.set_client_access_tier(uuid, public.client_access_tier) from public, anon;
grant execute on function public.set_client_access_tier(uuid, public.client_access_tier) to authenticated;

-- Dedicated client read arms — ADDITIONAL permissive policies (OR'd with the
-- existing arms). photo_logs: same shape as "client reads approved project
-- photos" but the w.status='complete' gate is replaced with full-tier check;
-- phase<>'defect' is KEPT (spec 248's rule is independent of tier).
create policy "client reads all project photos (full tier)"
  on public.photo_logs for select to authenticated
  using ((select public.current_user_role()) = 'client'
         and phase <> 'defect'
         and exists (
           select 1 from public.work_packages w
           where w.id = photo_logs.work_package_id
             and public.client_has_full_access(w.project_id)
         ));

-- project_categories: net-new client arm (none existed before this spec —
-- only the staff-scoped "readable by project members" policy).
create policy "client reads project categories (full tier)"
  on public.project_categories for select to authenticated
  using ((select public.current_user_role()) = 'client'
         and public.client_has_full_access(project_id));
