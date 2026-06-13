-- Data-architecture hardening (rank 4) — bound the fastest-growing disposable
-- table. notification_outbox holds delivery STATE, not evidence (unlike
-- audit_log/photo_logs/labor_logs, which are append-only and must be kept).
-- The drainer only flips status and never deletes, so the table grows forever
-- and every reclaim/expiry scan walks a larger heap each tick. Prune terminal
-- rows on a daily pg_cron sweep — same shape as the report reaper (20260617000100).
--
-- Only 'sent' (delivered) and 'expired' (gave up) are removed; 'failed' may
-- still be retried and 'pending'/'sending' are in flight, so they stay.
-- Age is keyed on created_at (always set; expired rows may have no sent_at).

create function public.prune_notification_outbox(p_max_age_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.notification_outbox
   where status in ('sent', 'expired')
     and created_at < now() - make_interval(days => p_max_age_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.prune_notification_outbox(integer)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notification-outbox-prune') then
    perform cron.unschedule('notification-outbox-prune');
  end if;
  perform cron.schedule(
    'notification-outbox-prune',
    '23 3 * * *',
    'select public.prune_notification_outbox()');
end;
$$;
