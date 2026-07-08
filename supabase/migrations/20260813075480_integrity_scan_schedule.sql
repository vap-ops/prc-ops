-- Spec 283 U1 — schedule the System Integrity Console scan (hourly, spec §D4).
--
-- integrity_scan() (20260813075470) records one run of the whole check registry into
-- integrity_check_runs. Like gl-posting-drain (20260813002000) it is PURE SQL — no app
-- endpoint, no Vault secret — so pg_cron invokes it directly. Same idempotent
-- unschedule-then-schedule shape. Hourly: integrity rarely breaks, so sub-hour churn is
-- unwarranted; the console always has an on-demand "run now" (run_and_record_integrity).
--
-- Alerting on a green->red flip is a later unit (U6); this only records.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'integrity-scan') then
    perform cron.unschedule('integrity-scan');
  end if;
  perform cron.schedule(
    'integrity-scan',
    '0 * * * *',
    'select public.integrity_scan()');
end;
$$;
