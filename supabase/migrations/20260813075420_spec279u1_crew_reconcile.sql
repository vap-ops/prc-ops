-- ============================================================================
-- Spec 279 U1 — post-push reconcile (two things the full pgTAP suite caught vs
-- 075410, both fixed here since an applied migration can't be edited in place):
--
--   * anon EXECUTE (229-anon-exec guard): Supabase grants EXECUTE to `anon`
--     EXPLICITLY (via ALTER DEFAULT PRIVILEGES), NOT through PUBLIC — so 075410's
--     `revoke ... from public` left `anon` able to call these SECURITY DEFINER
--     functions (which bypass RLS). Revoke from `anon` (the anon-exec-lockdown
--     idiom); `authenticated` keeps EXECUTE.
--
--   * rls-eval-once (40-rls-eval-once guard): 075410's crews/crew_members SELECT
--     policies called the STABLE helpers BARE. Wrap them in scalar subqueries so
--     the planner evaluates them once per query (InitPlan), not per row.
-- ============================================================================

revoke execute on function public.create_crew(uuid, text, uuid, text, numeric) from anon;
revoke execute on function public.reassign_crew_lead(uuid, uuid) from anon;
revoke execute on function public.current_user_led_crew_ids() from anon;

alter policy crews_select on public.crews
using (
  public.is_back_office((select public.current_user_role()))
  or coalesce((select public.current_user_worker_id()) = lead_worker_id, false)
);

alter policy crew_members_select on public.crew_members
using (
  public.is_back_office((select public.current_user_role()))
  or crew_id in (select public.current_user_led_crew_ids())
);
