-- Spec 201 awareness arc A4 — feedback_submitted capture trigger (ADR 0037).
--
-- A new bug report / feature request enqueues a notification_outbox row so the
-- drainer can LINE-push the operator (super_admin). Mirrors the four existing
-- capture functions: SECURITY DEFINER, pinned search_path, and the failure-SWALLOW
-- posture (RAISE WARNING, never an exception) — a notification must NEVER block the
-- report itself (submit_feedback). Feedback rows have no work_package_id /
-- purchase_request_id, so the whole snapshot rides in payload (the drain select is
-- unchanged). The new event type was added in its own migration (…001700).

create function public.notify_feedback_submitted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_outbox (event_type, payload)
  values ('feedback_submitted',
          jsonb_build_object(
            'feedback_id',    new.id,
            'feedback_type',  new.type,
            'feedback_title', new.title,
            'role_snapshot',  new.role_snapshot,
            'submitted_by',   new.submitted_by));
  return new;
exception when others then
  raise warning '[notify_feedback_submitted] outbox insert failed: %', sqlerrm;
  return new;
end;
$$;

-- No WHEN guard: submit_feedback is the only write path into feedback and every
-- insert is a fresh report.
create trigger feedback_notify_submitted
  after insert on public.feedback
  for each row
  execute function public.notify_feedback_submitted();
