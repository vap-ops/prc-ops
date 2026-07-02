-- Spec 244 U5 fix (adversarial-review finding, same PR as 20260813057000) —
-- deterministic in-batch ordering for get_actor_timeline. The client tracker
-- flushes events in batches (~20s / 20 events) and /api/telemetry inserts a
-- whole batch as ONE multi-row INSERT, so every event in a flush shares an
-- IDENTICAL created_at (now() is transaction-stable). Ordering the screens /
-- friction jsonb by created_at alone therefore leaves in-batch order to the
-- whims of the index scan — a real A→B tap sequence could render reversed, and
-- the consecutive-dedupe on the page could then show a wrong ×count. client_ts
-- (device time, set per event at emit) is the honest tiebreaker; it is nullable
-- (asc default = nulls last), used for ORDER ONLY. The displayed `at` stays the
-- server-stamped created_at (trustworthy, PDPA-documented; ≤ one flush late —
-- accepted).
--
-- CREATE OR REPLACE in a NEW migration (never edit the applied 057000 — the
-- recorded-history drift lesson, ADR 0069). Body otherwise identical.
create or replace function public.get_actor_timeline(
  p_actor_id uuid,
  p_days     integer default 14
) returns table (
  session_id   text,
  started_at   timestamptz,
  last_seen_at timestamptz,
  duration_ms  bigint,
  screens      jsonb,
  friction     jsonb
) language sql stable security invoker set search_path = public as $$
  select
    e.session_id,
    min(e.created_at)                                            as started_at,
    max(e.created_at)                                            as last_seen_at,
    (count(*) filter (where e.event_type = 'heartbeat'))::bigint
      * 20000                                                    as duration_ms,
    coalesce(
      jsonb_agg(jsonb_build_object('route', e.route, 'at', e.created_at)
                order by e.created_at, e.client_ts)
        filter (where e.event_type = 'route_view'),
      '[]'::jsonb)                                               as screens,
    coalesce(
      jsonb_agg(jsonb_build_object(
                  'type', e.event_type, 'route', e.route, 'at', e.created_at)
                order by e.created_at, e.client_ts)
        filter (where e.event_type in
                  ('js_error', 'upload_fail', 'validation_error',
                   'form_abandon', 'rage_tap')),
      '[]'::jsonb)                                               as friction
  from public.interaction_events e
  where e.actor_id = p_actor_id
    -- Window bounded by the 90-day raw retention (mig 20260813045000); a
    -- nonsense p_days clamps instead of erroring.
    and e.created_at >=
      now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 90))
  group by e.session_id
  order by min(e.created_at) desc
$$;

-- Re-assert the grant surface (CREATE OR REPLACE preserves ACLs, but pin it
-- against a future replay from scratch).
revoke all on function public.get_actor_timeline(uuid, integer) from public, anon;
grant execute on function public.get_actor_timeline(uuid, integer) to authenticated;
