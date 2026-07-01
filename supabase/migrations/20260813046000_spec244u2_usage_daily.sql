-- Spec 244 U1b-2 / ADR 0068 (amended, Tier B) — usage_daily: the per-(actor, day)
-- rollup over interaction_events (the U1a sink) that turns raw session/heartbeat
-- telemetry into the visible payoff — DAU (distinct active actors per day) and
-- per-SA screen time. Kept SMALL and longer-lived than the 90-day raw events
-- (spec 244 §3.2, D6). It is written ONLY by refresh_usage_daily (SECURITY
-- DEFINER), run daily by pg_cron — no app client ever writes it. RLS mirrors
-- interaction_events: super_admin (the v1 support reader, spec 244 §9) OR the
-- subject's own row (self-mirror, PDPA).

create table public.usage_daily (
  actor_id       uuid    not null references public.users(id),
  day            date    not null,
  sessions       integer not null default 0,
  active         boolean not null default false,
  screen_time_ms bigint  not null default 0,
  opens          integer not null default 0,
  routes_touched integer not null default 0,
  primary key (actor_id, day)
);
-- DAU / active-users-by-day scans (the read groups by day across all actors).
create index usage_daily_day_idx on public.usage_daily (day);

alter table public.usage_daily enable row level security;
revoke all on public.usage_daily from anon, authenticated;
grant select on public.usage_daily to authenticated;

-- Read = super_admin OR the subject's own rows (self-mirror). No INSERT/UPDATE/
-- DELETE policy -> writes denied for every authenticated caller; the definer
-- refresh fn writes past this (the owner bypasses RLS), same posture as
-- prune_interaction_events (mig 20260813045000).
create policy "usage_daily read super or own"
  on public.usage_daily for select to authenticated
  using ((select public.current_user_role()) = 'super_admin'
         or actor_id = (select auth.uid()));

-- refresh_usage_daily(p_day): recompute + UPSERT the rollup for one day from
-- interaction_events. Idempotent, so it is safe to re-run or backfill.
--   screen_time_ms = heartbeat count * the 20s heartbeat interval (spec 244 §9.4):
--     a heartbeat fires every 20s while the app is foreground, so counting them
--     is a robust screen-time proxy that survives a missed session_end — simpler
--     and more resilient than pairing session_start/session_end.
--   sessions       = distinct session_id
--   opens          = session_start count
--   routes_touched = distinct route
-- A "day" is bucketed by the server-stamped created_at (always present; the
-- client_ts is nullable and offline-skewed).
create function public.refresh_usage_daily(p_day date default (current_date - 1))
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  insert into public.usage_daily
    (actor_id, day, sessions, active, screen_time_ms, opens, routes_touched)
  select
    e.actor_id,
    p_day,
    count(distinct e.session_id)::integer,
    true,
    (count(*) filter (where e.event_type = 'heartbeat'))::bigint * 20000,
    (count(*) filter (where e.event_type = 'session_start'))::integer,
    count(distinct e.route)::integer
  from public.interaction_events e
  where e.created_at >= p_day::timestamptz
    and e.created_at <  (p_day + 1)::timestamptz
  group by e.actor_id
  on conflict (actor_id, day) do update
    set sessions       = excluded.sessions,
        active         = excluded.active,
        screen_time_ms = excluded.screen_time_ms,
        opens          = excluded.opens,
        routes_touched = excluded.routes_touched;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
-- writer-only: never callable by app clients; runs as the daily cron / a manual backfill.
revoke all on function public.refresh_usage_daily(date) from public, anon, authenticated;

-- Daily rollup of *yesterday* (default p_day = current_date - 1), once the day is
-- complete. Guard: unschedule an existing same-named job first so the migration
-- is re-runnable (mirror of the prune job in mig 20260813045000).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'usage-daily-refresh') then
    perform cron.unschedule('usage-daily-refresh');
  end if;
  perform cron.schedule(
    'usage-daily-refresh',
    '30 3 * * *',
    'select public.refresh_usage_daily()');
end;
$$;
