-- Spec 271 U3 / ADR 0075 §4.6 — status-transition + schedule-edit audit rows.
--
-- One AFTER UPDATE trigger on work_packages writes an audit_log row for every
-- status flip (submit = pending_approval entry → the D7 completion anchor;
-- approval decisions; hold toggles; reopens) and every planned_* edit
-- (old→new — the date-edit trail behind the baseline discipline).
--
-- A trigger, not per-RPC inserts, because the submit and decision paths run
-- through the ADMIN client (service role bypasses grants and RLS but never
-- triggers), and a single writer also covers any future path uniformly.
-- Consequences, both accepted and documented here:
--   * admin-client transitions carry actor_id NULL (no JWT user) — D7 needs
--     the TIMESTAMP; decision actors live in approvals.decided_by.
--   * reopen_work_package_for_defect keeps its own richer defect row
--     (reason + source + round); a reopen therefore writes two rows — the
--     uniform transition fact plus the defect context. Consumers key on
--     payload->>'event'.
--   * งาน group rows roll up child status changes (wp_rollup_status), so
--     derived group transitions are logged too, flagged is_group.
--
-- audit_log INSERT is service-role-only under RLS (#242): the trigger function
-- is SECURITY DEFINER so the insert succeeds from any triggering context.

create function public.wp_transition_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_log
      (actor_id, actor_role, action, target_table, target_id, payload)
    values
      (auth.uid(), public.current_user_role(), 'other', 'work_packages', new.id,
       jsonb_build_object(
         'event', 'wp_status_transition',
         'from_status', old.status,
         'to_status', new.status,
         'rework_round', new.rework_round,
         'is_group', new.is_group));
  end if;

  if (new.planned_start is distinct from old.planned_start)
     or (new.planned_end is distinct from old.planned_end) then
    insert into public.audit_log
      (actor_id, actor_role, action, target_table, target_id, payload)
    values
      (auth.uid(), public.current_user_role(), 'other', 'work_packages', new.id,
       jsonb_build_object(
         'event', 'wp_schedule_edited',
         'old_start', old.planned_start,
         'new_start', new.planned_start,
         'old_end', old.planned_end,
         'new_end', new.planned_end,
         'is_group', new.is_group));
  end if;

  return null;
end;
$$;

revoke all on function public.wp_transition_audit() from public, anon, authenticated;

create trigger work_packages_transition_audit
  after update on public.work_packages
  for each row
  when (old.status is distinct from new.status
        or old.planned_start is distinct from new.planned_start
        or old.planned_end is distinct from new.planned_end)
  execute function public.wp_transition_audit();
