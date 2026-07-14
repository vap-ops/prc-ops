-- spec 318 U5 — pr_created payload gains project_id so the drain can scope the
-- PM fanout to the request's project (multi-project audit P1 cluster E).
-- Body sourced VERBATIM from the LIVE function (pg_get_functiondef,
-- 2026-07-14) + the single project_id line; same name/trigger, no re-grant
-- needed (trigger fns execute as owner).

create or replace function public.notify_pr_created()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.notification_outbox
    (event_type, work_package_id, purchase_request_id, payload)
  values ('pr_created', new.work_package_id, new.id,
          jsonb_build_object(
            'item_description', new.item_description,
            'quantity',         new.quantity,
            'unit',             new.unit,
            'priority',         new.priority,
            'requested_by',     new.requested_by,
            'pr_number',        new.pr_number,
            'project_id',       new.project_id));
  return new;
exception when others then
  raise warning '[notify_pr_created] outbox insert failed: %', sqlerrm;
  return new;
end;
$function$;
