-- Spec 218 U5 — capture the defect reopen (complete → rework) into the
-- notification outbox, so the SA who shot the work gets pinged to come fix it.
--
-- Trigger-capture (ADR 0037): one AFTER UPDATE trigger sees every writer of the
-- transition — here the only writer is reopen_work_package_for_defect (a definer
-- UPDATE), but the trigger pattern keeps the capture layer independent of the
-- caller. The reason/source live in the reopen's audit row, not on the WP, so the
-- payload snapshots what the WP row has (code/name/round) + the reopener
-- (auth.uid(), for self-exclusion); the recipient opens the app — the "ต้องแก้ไข"
-- surface (spec 218) carries the full reason/source. Failures are SWALLOWED
-- (RAISE WARNING) so a notification can never block the reopen.

create function public.notify_wp_reopened()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'complete' and new.status = 'rework' then
    insert into public.notification_outbox (event_type, work_package_id, payload)
    values ('wp_reopened', new.id,
            jsonb_build_object(
              'code',        new.code,
              'name',        new.name,
              'round',       new.rework_round,
              'reopened_by', auth.uid()));
  end if;
  return new;
exception when others then
  raise warning '[notify_wp_reopened] outbox insert failed: %', sqlerrm;
  return new;
end;
$$;

create trigger work_packages_notify_reopened
  after update on public.work_packages
  for each row
  when (old.status is distinct from new.status)
  execute function public.notify_wp_reopened();

comment on function public.notify_wp_reopened() is
  'Spec 218 — enqueue a wp_reopened notification when a complete WP flips to rework (defect reopen). Capture layer (ADR 0037); failures swallowed.';
