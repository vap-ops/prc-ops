-- Spec 244 U1 / ADR 0068 (amended, Tier B) — interaction_events: the client
-- session/friction telemetry sink for measuring on-site site_admin app usage
-- (screen time -> DAU) and friction. SEPARATE from audit_log by design
-- (ADR 0068 §2): it carries its own retention (90 days), sampling, and RLS —
-- NOT the audit_log append-only triple-lock. The usage_daily rollup + the
-- client capture module + the /api/telemetry ingest land in U1b (they couple
-- to the client event contract, e.g. the heartbeat interval).

-- Event vocabulary for U1 (session + navigation). Friction values
-- (rage_tap, form_abandon, validation_error, upload_fail, js_error) arrive in
-- U2 via their own ALTER TYPE ADD VALUE migration (own txn, ADR 0008 rule).
create type public.interaction_event_type as enum (
  'session_start', 'heartbeat', 'session_end', 'route_view', 'feature_touch'
);

create table public.interaction_events (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid not null references public.users(id),
  actor_role   public.user_role not null,
  session_id   text not null,
  event_type   public.interaction_event_type not null,
  route        text,
  context      jsonb,
  app_version  text,
  client_ts    timestamptz,
  created_at   timestamptz not null default now()
);
-- per-subject time-ordered reads (self-mirror + the future rollup) and the
-- retention scan by age.
create index interaction_events_actor_created_idx
  on public.interaction_events (actor_id, created_at desc);
create index interaction_events_created_idx
  on public.interaction_events (created_at);

-- Identity is stamped server-side, never trusted from the client: force
-- actor_id = the caller and actor_role = the caller's REAL role. A NULL caller
-- (anon / no session) yields NULL actor_id -> NOT NULL violation -> rejected.
-- Runs BEFORE the RLS WITH CHECK, so the stamped row is what gets checked.
create function public.interaction_events_stamp_actor()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.actor_id   := (select auth.uid());
  new.actor_role := public.current_user_role();
  return new;
end;
$$;
create trigger interaction_events_stamp_actor
  before insert on public.interaction_events
  for each row execute function public.interaction_events_stamp_actor();

-- RLS. Insert-own (belt-and-suspenders with the stamp trigger); read =
-- super_admin (the v1 support reader, spec 244 §9) OR the subject's own rows
-- (self-mirror, PDPA). No UPDATE/DELETE policy -> denied for every
-- authenticated caller; retention deletes run only via the definer prune fn.
alter table public.interaction_events enable row level security;
revoke all on public.interaction_events from anon, authenticated;
grant insert, select on public.interaction_events to authenticated;

create policy "interaction_events insert own"
  on public.interaction_events for insert to authenticated
  with check (actor_id = (select auth.uid()));

create policy "interaction_events read super or own"
  on public.interaction_events for select to authenticated
  using ((select public.current_user_role()) = 'super_admin'
         or actor_id = (select auth.uid()));

-- Retention: raw events live 90 days (spec 244 D6, operator 2026-07-01), then a
-- daily pg_cron sweep prunes them (same shape as prune_notification_outbox,
-- mig 20260625000300). SECURITY DEFINER so the sweep can DELETE past the
-- no-delete RLS; not granted to anon/authenticated.
create function public.prune_interaction_events(p_max_age_days integer default 90)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  delete from public.interaction_events
   where created_at < now() - make_interval(days => p_max_age_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.prune_interaction_events(integer)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'interaction-events-prune') then
    perform cron.unschedule('interaction-events-prune');
  end if;
  perform cron.schedule(
    'interaction-events-prune',
    '17 3 * * *',
    'select public.prune_interaction_events()');
end;
$$;
