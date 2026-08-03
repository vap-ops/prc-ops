-- spec 390 U1 — per-channel notification switches.
--
-- The drain fans out over ONE recipient list to BOTH channels unconditionally
-- (drain/route.ts), so a user bound to LINE and Telegram receives every
-- notification twice. This adds the missing preference. Contract mirrors
-- notification_preferences (spec 318 U3) exactly: absence of a row = ON, own-rows
-- RLS for reads, RPC-only writes — so shipping it changes nobody's behaviour.
--
-- THE FLOOR: a user may never be switched down to zero channels that could
-- deliver. site_issue_reported is locked-unmutable by product decision; a channel
-- switch reaching zero would defeat that lock silently, leaving the event
-- "enabled" and reaching nobody.
--
-- ⚠️ Reachability is NOT boundness, and this is the whole design. LINE returns
-- 403 to a non-OA-friend, so line_oa_friend = false means bound AND
-- undeliverable — live, one of the four dual-bound users is exactly that. A
-- boundness floor would have let them disable Telegram and called it protected.
-- null means "never probed" (the flag refreshes only at LINE login) and counts as
-- REACHABLE: refusing on null would strand the 15 users we have no evidence
-- against (spec 386 U5's rule — unknown is not a failure).

create type public.notification_channel as enum ('line', 'telegram');

create table public.notification_channel_preferences (
  user_id uuid not null references public.users (id) on delete cascade,
  channel public.notification_channel not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, channel)
);

alter table public.notification_channel_preferences enable row level security;

revoke all on table public.notification_channel_preferences from anon, authenticated;
grant select on table public.notification_channel_preferences to authenticated;

create policy notification_channel_preferences_read_own
  on public.notification_channel_preferences
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The reachability predicate, in ONE place. Both the setter's floor and
-- unlink_telegram's back-door close call this rather than restating it — a
-- restated predicate is how the two drift, and only one of them would be
-- re-checked when line_oa_friend's semantics next change.
--
-- Not granted to anyone: it takes an arbitrary user id, and its only callers are
-- the SECURITY DEFINER functions below, which execute as the owner.
create or replace function public.reachable_notification_channels(p_user uuid)
returns setof public.notification_channel
language sql
stable
set search_path = public, pg_temp
as $$
  select ch.channel
  from public.users u
  cross join lateral (
    values
      ('line'::public.notification_channel, u.line_user_id is not null and u.line_oa_friend is not false),
      ('telegram'::public.notification_channel, u.telegram_chat_id is not null)
  ) as ch (channel, reachable)
  where u.id = p_user
    and ch.reachable;
$$;

revoke all on function public.reachable_notification_channels(uuid) from public, anon, authenticated;

create or replace function public.set_notification_channel_preference(
  p_channel public.notification_channel,
  p_enabled boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- The floor, evaluated against the state this call would PRODUCE: would any
  -- OTHER reachable channel still be enabled afterwards? Absence of a row = ON,
  -- hence the coalesce. Disabling a channel that cannot deliver anyway is
  -- allowed — the question is only what remains.
  if not p_enabled then
    if not exists (
      select 1
      from public.reachable_notification_channels(v_uid) as ch
      where ch <> p_channel
        and coalesce(
          (select p.enabled
             from public.notification_channel_preferences p
            where p.user_id = v_uid and p.channel = ch),
          true
        )
    ) then
      raise exception 'no reachable notification channel would remain' using errcode = '22023';
    end if;
  end if;

  insert into public.notification_channel_preferences (user_id, channel, enabled)
  values (v_uid, p_channel, p_enabled)
  on conflict (user_id, channel)
  do update set enabled = excluded.enabled, updated_at = now();
end;
$$;

revoke all on function public.set_notification_channel_preference(public.notification_channel, boolean)
  from public, anon;
grant execute on function public.set_notification_channel_preference(public.notification_channel, boolean)
  to authenticated;

-- Back-door close. The floor above cannot see this path: a user may disable LINE
-- (legal — Telegram is still on) and then UNLINK Telegram, reaching zero through
-- two individually-legal steps because unlinking is a different RPC.
--
-- So after unlinking, if nothing reachable is left enabled, drop the caller's
-- channel rows — undoing OUR switch, not their binding choice. Deliberately
-- narrow: a user whose remaining channel is enabled keeps every stated
-- preference (an over-eager delete would silently re-enable a channel they had
-- turned off, which is the same class of bug in the other direction).
--
-- Body below is the live 20260813075888 definition, verbatim, plus the closing
-- block. Sourced from pg_get_functiondef on the LIVE database, not from the
-- migration file.
create or replace function public.unlink_telegram()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.users
     set telegram_chat_id = null,
         telegram_linked_at = null
   where id = v_uid;

  delete from public.telegram_link_tokens
   where user_id = v_uid and consumed_at is null;

  -- spec 390 — see above.
  if not exists (
    select 1
    from public.reachable_notification_channels(v_uid) as ch
    where coalesce(
      (select p.enabled
         from public.notification_channel_preferences p
        where p.user_id = v_uid and p.channel = ch),
      true
    )
  ) then
    delete from public.notification_channel_preferences where user_id = v_uid;
  end if;
end;
$$;

revoke all on function public.unlink_telegram() from public, anon;
grant execute on function public.unlink_telegram() to authenticated;
