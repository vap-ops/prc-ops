-- Spec 244 U5 / ADR 0068 (amended, Tier B) — get_actor_timeline: the per-person
-- activity-timeline RPC behind /settings/usage/[actorId] (operator 2026-07-02:
-- "detailed info down to individual's logged activities"). The raw
-- interaction_events slice is heartbeat-dominated (~1 row/20s foreground), so a
-- raw PostgREST read for one person over 14 days would truncate at the page cap
-- — sessions are grouped server-side instead, and heartbeats leave the function
-- only as a duration (count × 20s, the same screen-time proxy as
-- refresh_usage_daily, mig 20260813046000).
--
-- SECURITY INVOKER on purpose (contrast the definer writers in 045000/046000):
-- the RLS policy "interaction_events read super or own" scopes the read, so
-- super_admin (the v1 support reader, spec 244 §9) gets any actor while a
-- non-super caller gets only their own rows (self-mirror, PDPA) — a
-- cross-subject call returns zero rows, never an error. EXECUTE is granted to
-- authenticated (safe because invoker + RLS), revoked from public/anon.
create function public.get_actor_timeline(
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
                order by e.created_at)
        filter (where e.event_type = 'route_view'),
      '[]'::jsonb)                                               as screens,
    coalesce(
      jsonb_agg(jsonb_build_object(
                  'type', e.event_type, 'route', e.route, 'at', e.created_at)
                order by e.created_at)
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

revoke all on function public.get_actor_timeline(uuid, integer) from public, anon;
grant execute on function public.get_actor_timeline(uuid, integer) to authenticated;
