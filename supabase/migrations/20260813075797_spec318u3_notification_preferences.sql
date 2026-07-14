-- spec 318 U3 — per-user notification mute. Absence of a row = ON; a row
-- records an explicit choice. Reads: own rows only. Writes: RPC-only
-- (set_notification_preference), which refuses the locked safety alert.
-- The drain (service-role) filters recipients from enabled=false rows.

create table public.notification_preferences (
  user_id uuid not null references public.users (id) on delete cascade,
  event_type public.notification_event_type not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_type)
);

alter table public.notification_preferences enable row level security;

revoke all on table public.notification_preferences from anon, authenticated;
grant select on table public.notification_preferences to authenticated;

create policy notification_preferences_read_own
  on public.notification_preferences
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.set_notification_preference(
  p_event public.notification_event_type,
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
  -- spec 318 locked set: safety alerts cannot be muted (mirror of
  -- LOCKED_NOTIFICATION_EVENTS in notification-catalog.ts).
  if p_event = 'site_issue_reported' then
    raise exception 'notification event is locked' using errcode = '22023';
  end if;
  insert into public.notification_preferences (user_id, event_type, enabled)
  values (v_uid, p_event, p_enabled)
  on conflict (user_id, event_type)
  do update set enabled = excluded.enabled, updated_at = now();
end;
$$;

revoke all on function public.set_notification_preference(public.notification_event_type, boolean)
  from public, anon;
grant execute on function public.set_notification_preference(public.notification_event_type, boolean)
  to authenticated;
