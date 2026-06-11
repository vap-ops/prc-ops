-- Spec 32 / ADR 0037 — LINE notification outbox: drain scheduling.
--
-- pg_cron + pg_net call the app's drain endpoint every minute. The URL and
-- shared secret live in Supabase Vault (names: notification_drain_url /
-- notification_drain_secret) so no secret is committed to the repo.
-- Missing Vault entries (or an unavailable Vault) make the invoker a
-- silent no-op — safe to ship before the operator configures the LINE
-- Messaging channel (go-live checklist §8).

create extension if not exists pg_cron;
create extension if not exists pg_net;

create function public.invoke_notification_drain()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets
     where name = 'notification_drain_url';
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'notification_drain_secret';
  exception when others then
    return; -- Vault unavailable: not configured yet, no-op.
  end;

  if v_url is null or v_secret is null then
    return; -- Secrets not set yet: no-op.
  end if;

  perform net.http_post(
    url     => v_url,
    headers => jsonb_build_object(
                 'x-drain-secret', v_secret,
                 'content-type',   'application/json'),
    body    => '{}'::jsonb);
exception when others then
  raise warning '[invoke_notification_drain] %', sqlerrm;
end;
$$;

revoke execute on function public.invoke_notification_drain()
  from public, authenticated, anon;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notification-drain') then
    perform cron.unschedule('notification-drain');
  end if;
  perform cron.schedule(
    'notification-drain',
    '* * * * *',
    'select public.invoke_notification_drain()');
end;
$$;
