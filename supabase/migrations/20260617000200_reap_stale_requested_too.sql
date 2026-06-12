-- Spec 39 amendment (adversarial-review finding) — the reaper must also
-- free stale 'requested' rows, or pausing the Railway cron re-opens the
-- duplicate-guard wedge: a row the fast path failed to claim-and-build
-- would stay 'requested' forever with no sweeper alive. A requested row
-- older than the cutoff means nothing is processing the queue — flip it
-- to 'failed' so the PM can regenerate. With this, pausing Railway is
-- safe at any time (ADR 0040 end-state).

create or replace function public.reap_stale_reports(p_max_age_minutes integer default 15)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.reports
     set status     = 'failed',
         error      = case status
                        when 'processing' then
                          'stale processing — reaped after ' || p_max_age_minutes
                          || ' min (ADR 0040)'
                        else
                          'stale requested — no builder picked this up within '
                          || p_max_age_minutes || ' min (ADR 0040)'
                      end,
         updated_at = now()
   where status in ('processing', 'requested')
     and updated_at < now() - make_interval(mins => p_max_age_minutes);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reap_stale_reports(integer)
  from public, anon, authenticated;
