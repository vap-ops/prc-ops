-- Spec 277 P1a PR3 — serious-site-issue capture trigger (AUTOMATION #1, ADR 0037).
--
-- A newly filed SERIOUS site issue enqueues one notification_outbox row so the
-- drainer can push the project's PM + the project_director / procurement_manager
-- pools (recipient resolution + Thai copy live app-side in the drainer). Clones
-- the four existing capture functions and notify_wp_reopened (…011000):
-- SECURITY DEFINER, pinned search_path, and the failure-SWALLOW posture
-- (RAISE WARNING, never an exception) — a notification must NEVER block
-- report_site_issue, the only write path into site_issues.
--
-- SERIOUS-SET SSOT lives HERE, in the trigger WHEN clause: only {safety, access,
-- equipment} enqueue. weather / other file no row. The trigger is AFTER INSERT
-- and forward-only — issues filed before this migration are never retro-alerted.
--
-- work_package_id rides on the outbox row (not payload) so the drainer's existing
-- WP-code enrichment resolves it for free (as wp_pending_approval does); project_id
-- + issue_type + reported_by ride in payload (the drain select is unchanged).

create function public.notify_site_issue_reported()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_outbox (event_type, work_package_id, payload)
  values ('site_issue_reported', new.work_package_id,
          jsonb_build_object(
            'project_id',  new.project_id,
            'issue_type',  new.issue_type,
            'reported_by', new.reported_by));
  return new;
exception when others then
  raise warning '[notify_site_issue_reported] outbox insert failed: %', sqlerrm;
  return new;
end;
$$;

-- Serious types only — the WHEN guard is the serious-set SSOT. A minor issue
-- (weather / other) produces no outbox row at all.
create trigger site_issues_notify_serious
  after insert on public.site_issues
  for each row
  when (new.issue_type in ('safety', 'access', 'equipment'))
  execute function public.notify_site_issue_reported();

comment on function public.notify_site_issue_reported() is
  'Spec 277 P1a — enqueue a site_issue_reported notification when a SERIOUS site issue (safety/access/equipment) is filed. Capture layer (ADR 0037); failures swallowed; forward-only (AFTER INSERT).';
