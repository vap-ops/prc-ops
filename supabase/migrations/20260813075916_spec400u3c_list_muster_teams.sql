-- Spec 400 U3c, schema half — the READ the add-person picker needs.
--
-- ============================================================================
-- WHY THIS EXISTS
-- ============================================================================
-- U3a widened `muster_scan_in` to `procurement`; U4 gave a correction a real
-- `in_at` via `muster_correct_session`. The WRITE is therefore complete, and the
-- picker still cannot be built, because every write takes `p_team` and four of
-- the five procurement people cannot learn a team id:
--
--   `muster_teams` RLS is one policy, `can_see_project(project_id)` (read live)
--   `can_see_project` falls to `else false` for `procurement`
--   ⇒ a team picker on the session client is EMPTY for plain procurement.
--
-- This was U3b's FINDING 2 and is why U3b shipped without add-person.
--
-- ============================================================================
-- WHY A DEFINER RPC AND NOT THE OTHER TWO SEAMS
-- ============================================================================
-- Chosen by PRECEDENT rather than taste: `procurement` already reads every
-- project's attendance through `audit_attendance_summary` / `audit_attendance_
-- detail`, both SECURITY DEFINER. A definer listing RPC is the seam this exact
-- audience already uses for this exact data, so it adds no new kind of trust.
--
--   ✗ admin client (service-role) in the server component — moves a real
--     authorization decision out of the database into TS, where no pgTAP can
--     drive it over the role domain.
--   ✗ widening `muster_teams` RLS — would widen the table for EVERY existing
--     reader that joins it. Spec 400 U2 paid for that lesson: a surface joining
--     a TABLE read to an RPC read inherits the WIDER of the two gates, and the
--     PM would have been shown 41 workers as "never scanned".
--
-- ============================================================================
-- GATE AND SCOPE ARE TWO SEPARATE ROLE LISTS
-- ============================================================================
-- Same shape as `muster_correct_session`, deliberately copied rather than
-- reinvented (spec 397's lesson: a definer RPC can gate and scope with two
-- different lists, and widening one produces a SILENT EMPTY rather than a
-- refusal):
--
--   gate  = {super_admin, procurement_manager, procurement} — the correction
--           audience. `site_admin` is absent: she reads `muster_teams` through
--           RLS already and has no surface here, so adding her would be
--           privilege with no door.
--   scope = `can_see_project`, EXCEPT `procurement`, which is cross-project.
--
-- An unseeable project is a REFUSAL, not an empty list: an empty list reads as
-- "that day had no teams", which is a different fact and the one a corrector
-- would act on.
--
-- ============================================================================
-- WHAT EACH ROW CARRIES, AND WHY IT IS NOT JUST AN ID
-- ============================================================================
-- Live, a project-day carries ONE team on 7 days and 2–5 on 10, so an "if there
-- is only one team, skip the picker" shortcut would cover 41% and strand the
-- rest — a picker is genuinely required. A picker of unlabelled uuids is not a
-- choice, so each row carries the lead's name, the headcount, and the kind.
--
-- ⚠️ LEFT join to `workers`: an OFFICE team has no lead (`muster_teams_crew_has_
-- lead` applies to `kind='crew'` only), and an INNER join would silently drop it
-- from the picker — the same defect spec 397 U4 fixed inside `muster_scan_in`,
-- where an inner join turned "they are in the office team" into "somewhere
-- elsewhere". Zero office teams exist today; all 44 live teams are `crew`.
create or replace function public.list_muster_teams_for_day(
  p_project uuid,
  p_date    date
) returns table (
  team_id        uuid,
  kind           public.muster_team_kind,
  lead_worker_id uuid,
  lead_name      text,
  headcount      int
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true (the
  -- rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'super_admin', 'procurement_manager', 'procurement'
  ) then
    raise exception 'list_muster_teams_for_day: role not permitted' using errcode = '42501';
  end if;

  if p_project is null or p_date is null then
    raise exception 'list_muster_teams_for_day: project and date are required'
      using errcode = 'P0001';
  end if;

  -- Membership for the roles that HAVE membership; procurement is cross-project.
  if v_role <> 'procurement' and not public.can_see_project(p_project) then
    raise exception 'list_muster_teams_for_day: not a member of this project'
      using errcode = '42501';
  end if;

  return query
    select t.id,
           t.kind,
           t.lead_worker_id,
           w.name,
           (select count(*)::int from public.muster_attendance a where a.team_id = t.id)
      from public.muster_teams t
      left join public.workers w on w.id = t.lead_worker_id
     where t.project_id = p_project
       and t.work_date = p_date
     -- Deterministic and human: by the label the picker shows, then by id so two
     -- teams under the same lead never swap places between renders.
     order by w.name nulls last, t.id;
end;
$function$;

comment on function public.list_muster_teams_for_day(uuid, date) is
  'Spec 400 U3c. Lists a project-day''s muster teams for the correction audience ({super_admin, procurement_manager, procurement}), because muster_teams RLS is can_see_project and that helper refuses `procurement` — so the add-person picker would otherwise be empty for 4 of the 5 people U3a widened the write for. Read-only.';

-- A function is born PUBLIC in this project: the default grants hand EXECUTE to
-- anon and authenticated, so the revoke is the posture and the absence of a
-- grant statement proves nothing.
revoke all on function public.list_muster_teams_for_day(uuid, date) from public, anon;
grant execute on function public.list_muster_teams_for_day(uuid, date) to authenticated;
