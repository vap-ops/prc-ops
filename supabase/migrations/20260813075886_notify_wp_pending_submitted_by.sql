-- Feedback c5136ad9 — "we want to know who submitted for approval".
-- The wp_pending_approval outbox payload gains submitted_by: auth.uid() at
-- flip time. The capture trigger runs inside the submitting user's session
-- (SECURITY DEFINER elevates rights, not claims), so auth.uid() IS the
-- submitter; NULL when a system/cron flip has no user context — the drain
-- omits the line rather than inventing an actor. Sibling events already
-- carry their actor (decided_by / reopened_by / resubmitted_by /
-- requested_by); this closes the one gap.
-- CREATE OR REPLACE keeps the function's owner, ACL, and trigger binding.

create or replace function public.notify_wp_pending_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.notification_outbox (event_type, work_package_id, payload)
  values ('wp_pending_approval', new.id,
          jsonb_build_object(
            'code',         new.code,
            'name',         new.name,
            'project_id',   new.project_id,
            'submitted_by', auth.uid()));
  return new;
exception when others then
  raise warning '[notify_wp_pending_approval] outbox insert failed: %', sqlerrm;
  return new;
end;
$function$;
