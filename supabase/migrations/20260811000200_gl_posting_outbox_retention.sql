-- Data-architecture hardening — bound gl_posting_outbox (the subledger->GL
-- posting queue). Like notification_outbox, the drainer only flips status and
-- never deletes, so the queue grows forever (and the table-wide-count GL tests
-- broke once real posted jobs accumulated — see pgTAP 82/84/88). The outbox is
-- delivery STATE, not evidence (journal_entries + the audit chain are the
-- evidence), so terminal rows are safe to prune. Same shape as
-- prune_notification_outbox (20260625000300).
--
-- Only 'posted' (done) and 'skipped' (no-op) are removed; 'failed' may still be
-- retried and 'pending'/'posting' are in flight, so they stay. Age keyed on
-- created_at (always set; a posted row's posted_at is also set, but created_at
-- is the uniform key and matches the notification prune).

create function public.prune_gl_posting_outbox(p_max_age_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.gl_posting_outbox
   where status in ('posted', 'skipped')
     and created_at < now() - make_interval(days => p_max_age_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.prune_gl_posting_outbox(integer)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'gl-posting-outbox-prune') then
    perform cron.unschedule('gl-posting-outbox-prune');
  end if;
  perform cron.schedule(
    'gl-posting-outbox-prune',
    '17 3 * * *',
    'select public.prune_gl_posting_outbox()');
end;
$$;
