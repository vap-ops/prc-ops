-- spec 390 U1 (corrections from the fresh-eyes review of 20260813075895).
--
-- 075895 is already APPLIED, so this is a follow-up rather than an edit of it:
-- editing an applied migration and re-pushing silently no-ops. Both objects are
-- create-or-replace, so the append is clean and idempotent.
--
-- Three defects, all in the same blind spot — the floor reasoned about the
-- SHAPE of the reachable set but never about it being EMPTY:
--
--  1. `not exists (... enabled ...)` is TRUE over an empty relation, so a user
--     with nothing reachable at all was refused EVERY disable, told "no
--     reachable notification channel would remain" about a channel that already
--     delivers nothing. Live that is 11 users (10 verified non-friends with no
--     Telegram, 1 fully unbound). When nothing can be reached, a preference
--     cannot make it worse — the floor must stand down, not block.
--
--  2. The same emptiness made unlink_telegram's back-door close fire on a state
--     it does not reason about: a user whose LINE is bound-but-unreachable and
--     switched OFF gets their rows deleted on unlink, restoring ZERO
--     deliverability while silently flipping their LINE choice back ON. That is
--     the mirrored bug 075895's own comment claims to avoid. The close now only
--     heals when something reachable actually exists to be healed.
--
--  3. The floor read the pre-state and wrote without serialising, so two
--     concurrent calls (one per channel — two fast taps on one phone) could
--     each pass the check and both commit, producing exactly the zero-channel
--     state the function exists to prevent. Both writers now take the caller's
--     users row first, which is the lock unlink_telegram already holds by
--     virtue of updating that row.

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

  -- Serialise against the other writers of this user's channel state
  -- (a second set_..., or unlink_telegram) before reading the pre-state.
  perform 1 from public.users where id = v_uid for update;

  -- The floor, evaluated against the state this call would PRODUCE: would any
  -- OTHER reachable channel still be enabled afterwards? Absence of a row = ON,
  -- hence the coalesce.
  --
  -- Skipped entirely when the caller has NO reachable channel: there is nothing
  -- left to protect, and refusing there only blocks a user from recording a
  -- preference that changes nothing.
  if not p_enabled and exists (select 1 from public.reachable_notification_channels(v_uid)) then
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

  -- spec 390 back-door close: disabling LINE and then unlinking Telegram
  -- reaches zero through two individually-legal steps, and the floor cannot see
  -- the second one. Undo OUR switch — but only when a reachable channel exists
  -- for the undo to actually restore. With nothing reachable, deleting the rows
  -- restores no delivery and merely discards a stated preference.
  if exists (select 1 from public.reachable_notification_channels(v_uid))
     and not exists (
       select 1
       from public.reachable_notification_channels(v_uid) as ch
       where coalesce(
         (select p.enabled
            from public.notification_channel_preferences p
           where p.user_id = v_uid and p.channel = ch),
         true
       )
     )
  then
    delete from public.notification_channel_preferences where user_id = v_uid;
  end if;
end;
$$;

revoke all on function public.unlink_telegram() from public, anon;
grant execute on function public.unlink_telegram() to authenticated;

-- 075895's comment claimed the predicate was "not granted to anyone"; that
-- revoke listed public/anon/authenticated and missed Supabase's default
-- service_role grant, so the stated posture was not the held one. No escalation
-- (service_role bypasses RLS regardless) — but the helper takes an arbitrary
-- user id, so the honest posture is that only the DEFINER functions above, which
-- execute as the owner, may call it.
revoke all on function public.reachable_notification_channels(uuid) from service_role;
