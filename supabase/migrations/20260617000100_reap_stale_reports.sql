-- Spec 39 / ADR 0040 — stale-report reaper.
--
-- Closes the documented v1 gap: a crash mid-'processing' (worker OR the
-- new in-app fast path) left the row stuck forever and the duplicate
-- guard then blocked every future report for that project. Reaped rows
-- go to 'failed' (NOT back to 'requested'): the PDF may or may not have
-- uploaded, so a human regenerates deliberately; either way the guard
-- is freed. Scheduled via pg_cron (already enabled, spec 32) — pure
-- SQL, no HTTP/Vault dependency.

create function public.reap_stale_reports(p_max_age_minutes integer default 15)
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
         error      = 'stale processing — reaped after ' || p_max_age_minutes
                      || ' min (ADR 0040)',
         updated_at = now()
   where status = 'processing'
     and updated_at < now() - make_interval(mins => p_max_age_minutes);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.reap_stale_reports(integer)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'report-reaper') then
    perform cron.unschedule('report-reaper');
  end if;
  perform cron.schedule(
    'report-reaper',
    '*/5 * * * *',
    'select public.reap_stale_reports()');
end;
$$;
