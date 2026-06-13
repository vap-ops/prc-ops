-- Data-architecture hardening (rank 4): pin the notification_outbox retention
-- function + its scheduled cron job (20260625000300).

begin;
select plan(3);

select has_function(
  'public', 'prune_notification_outbox', array['integer'],
  'prune_notification_outbox(integer) exists'
);

select is(
  has_function_privilege('authenticated',
    'public.prune_notification_outbox(integer)', 'EXECUTE'),
  false, 'prune_notification_outbox is not executable by authenticated (cron-only)'
);

select is(
  (select count(*)::int from cron.job where jobname = 'notification-outbox-prune'),
  1, 'notification-outbox-prune cron job is scheduled'
);

select * from finish();
rollback;
