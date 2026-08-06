-- Spec 400 U5 — the correction TRAIL: who edited this project-day after the fact.
--
-- ============================================================================
-- WHY THIS EXISTS
-- ============================================================================
-- U3a/U3b/U4/U3c shipped the whole WRITE side of the correction loop, and every
-- one of those writes already lands an `audit_log` row. Nothing in `src/` reads
-- any of them, so the question the trail exists to answer — who edited this day,
-- and what did the record say before — is answerable only by running SQL.
--
-- And it is not merely unbuilt, it is UNREACHABLE from the session client.
-- `audit_log`'s RLS is two policies (read live):
--
--   'audit_log select internal privileged' → {super_admin, project_director,
--                                             accounting, project_manager}
--   'audit_log select wp rework events'    → {site_admin, procurement,
--                                             procurement_manager} AND
--                                             payload->>'event' in two WP kinds
--
-- ⇒ `procurement` and `procurement_manager` — 5 of the people the correction
-- audience is made of — cannot read a single muster audit row. `hr` and
-- `project_coordinator` cannot read any audit row at all. A definer RPC is the
-- only seam that serves the audience the report already has.
--
-- ============================================================================
-- WHY A DEFINER RPC — the same three-way choice U3c already settled
-- ============================================================================
-- `audit_attendance_summary`, `audit_attendance_detail` and
-- `list_muster_teams_for_day` are all SECURITY DEFINER RPCs serving this exact
-- audience this exact data, so this adds no new kind of trust.
--   ✗ admin client — moves a real authorization decision into TS, where no pgTAP
--     can drive it over the role domain.
--   ✗ widening `audit_log` RLS — that table carries every domain's audit trail;
--     a payload-kind policy for muster would widen a table 14 other readers join.
--
-- ============================================================================
-- 🚨 THE MEASUREMENT THAT SHAPED THE QUERY
-- ============================================================================
-- Taken from the LIVE rows, not from the six producing functions: two of the six
-- payload shapes carry NO `project_id`.
--
--   muster_correction_scan_in · muster_correction_time              project_id ✓
--   muster_day_close · muster_day_reopen                            project_id ✓
--   muster_undo                          team_id only            → muster_teams
--   muster_move                          from_team/to_team only  → muster_teams
--
-- 13 of the 16 live rows are `muster_move`. A payload-only filter would have
-- rendered an EMPTY trail on every real day while every assertion about the other
-- four kinds passed. 400d pins each kind SEPARATELY for that reason — a total
-- would let one leak while another is over-filtered and still read 6.
--
-- The kind list is exhaustive as of this migration, derived rather than recalled:
-- `grep -rho "'kind', '[a-z_]*'" supabase/migrations/ | sort -u | grep muster`
-- returns exactly these six.
--
-- ============================================================================
-- GATE AND SCOPE ARE TWO ROLE LISTS
-- ============================================================================
--   gate  = ATTENDANCE_AUDIT_ROLES, byte-identical to `audit_attendance_summary`
--           — everyone who can already open the report. Deliberately WIDER than
--           the correction audience: `accounting` owns the wage consequence of a
--           correction, and a reader shown a hole must be able to see who has
--           already touched it. `site_admin` is outside it, as she is for every
--           past-day surface.
--   scope = the cross-project tier passes any project; `project_manager` is the
--           one audit role that must pass `can_see_project`. Same split as the
--           summary RPC, and spec 400 U2 paid for the distinction: a surface that
--           ignores it asserts a FINDING about rows the reader may not see.
--
-- An unseeable project is a REFUSAL, not an empty list. An empty trail reads as
-- "nobody edited this day", which is a different fact and the one a reader acts on.
--
-- ============================================================================
-- WHAT A ROW CARRIES
-- ============================================================================
-- `detail` is built EXPLICITLY per kind rather than passed through: the payloads
-- carry `before`/`row` whole-row snapshots (every column of `muster_attendance`)
-- and a closure snapshot, none of which has any business reaching a browser.
-- Timestamps stay as the ISO-8601 UTC strings the payload holds — the caller owns
-- Bangkok rendering, and re-casting here would invent a second encoding.
--
-- `actor_role` comes from the AUDIT ROW, not from `users`: it is the role the
-- actor held at the time, which is the only one that explains the edit.
create or replace function public.list_muster_day_audit(
  p_project uuid,
  p_date    date
) returns table (
  logged_at   timestamptz,
  kind        text,
  actor_id    uuid,
  actor_name  text,
  actor_role  public.user_role,
  worker_id   uuid,
  worker_name text,
  session     public.muster_session,
  detail      jsonb
)
language plpgsql
stable
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
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'procurement', 'super_admin', 'project_manager'
  ) then
    raise exception 'list_muster_day_audit: role not permitted' using errcode = '42501';
  end if;

  if p_project is null or p_date is null then
    raise exception 'list_muster_day_audit: project and date are required'
      using errcode = 'P0001';
  end if;

  -- The SECOND list. project_manager is the only audit role outside the
  -- cross-project tier, so it is the only one this can refuse.
  if v_role not in (
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'procurement', 'super_admin'
  ) and not public.can_see_project(p_project) then
    raise exception 'list_muster_day_audit: not a member of this project'
      using errcode = '42501';
  end if;

  return query
  with edits as (
    select al.id,
           al.created_at,
           al.actor_id  as a_id,
           al.actor_role as a_role,
           al.payload   as p,
           al.payload->>'kind' as k,
           -- The project of the row. Four kinds state it; two must be resolved
           -- through the team they name. `to_team` before `from_team` so a move
           -- is attributed to where the worker ENDED the day.
           coalesce(
             (al.payload->>'project_id')::uuid,
             (select t.project_id
                from public.muster_teams t
               where t.id = coalesce(
                 (al.payload->>'team_id')::uuid,
                 (al.payload->>'to_team')::uuid,
                 (al.payload->>'from_team')::uuid))
           ) as prj
      from public.audit_log al
     where al.action = 'crew_change'
       and al.payload->>'work_date' = p_date::text
       -- `action` alone is far too wide: daily_work_plan writes crew_change too.
       and al.payload->>'kind' in (
         'muster_correction_scan_in', 'muster_correction_time', 'muster_undo',
         'muster_move', 'muster_day_close', 'muster_day_reopen')
  )
  select e.created_at,
         e.k,
         e.a_id,
         u.full_name,
         e.a_role,
         (e.p->>'worker_id')::uuid,
         w.name,
         (e.p->>'session')::public.muster_session,
         case e.k
           when 'muster_correction_time' then jsonb_build_object(
             'in_at',         e.p->>'in_at',
             'out_at',        e.p->>'out_at',
             'before_in_at',  e.p#>>'{before,in_at}',
             'before_out_at', e.p#>>'{before,out_at}')
           when 'muster_correction_scan_in' then jsonb_build_object(
             'method', e.p->>'method')
           -- The undone row is the only surviving copy of what it said.
           when 'muster_undo' then jsonb_build_object(
             'before_in_at',  e.p#>>'{row,in_at}',
             'before_out_at', e.p#>>'{row,out_at}')
           -- A team is named by its lead, the label every muster surface uses.
           -- LEFT joins throughout: an office team has no lead, and an inner join
           -- would drop the whole move rather than report a null name.
           when 'muster_move' then jsonb_build_object(
             'from_team_name', (select lw.name from public.muster_teams lt
                                  left join public.workers lw on lw.id = lt.lead_worker_id
                                 where lt.id = (e.p->>'from_team')::uuid),
             'to_team_name',   (select lw.name from public.muster_teams lt
                                  left join public.workers lw on lw.id = lt.lead_worker_id
                                 where lt.id = (e.p->>'to_team')::uuid))
           when 'muster_day_reopen' then jsonb_build_object(
             'reason', e.p->>'reason')
           else '{}'::jsonb
         end
    from edits e
    left join public.users   u on u.id = e.a_id
    left join public.workers w on w.id = (e.p->>'worker_id')::uuid
   where e.prj = p_project
   -- Newest first: a reader opens this to see what just happened. `id` breaks the
   -- tie so two edits inside one transaction never swap places between renders.
   order by e.created_at desc, e.id desc;
end;
$function$;

comment on function public.list_muster_day_audit(uuid, date) is
  'Spec 400 U5. Lists every after-the-fact edit to one project-day — add-person, retime, undo, move, close, reopen — for ATTENDANCE_AUDIT_ROLES, because audit_log RLS gives procurement and procurement_manager exactly two WP payload kinds and no muster row at all. muster_undo and muster_move carry no project_id and are resolved through muster_teams. Read-only.';

-- A function is born PUBLIC in this project: the default grants hand EXECUTE to
-- anon and authenticated, so the revoke is the posture and the absence of a
-- grant statement proves nothing.
revoke all on function public.list_muster_day_audit(uuid, date) from public, anon;
grant execute on function public.list_muster_day_audit(uuid, date) to authenticated;
