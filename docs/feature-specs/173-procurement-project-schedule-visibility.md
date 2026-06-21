# Spec 173 — Procurement read-only project visibility (schedule + deliverables + WP nav + info)

**Operator request (2026-06-21):** "Procurement needs to see Project information
and schedule." Clarified (two questions): besides the schedule, procurement also
needs the **deliverables (งวดงาน) list**, to **open work-package details**, and
the project **info fields** (team members, PM/lead, dates, Google-Maps link,
address, status).

Audit of the current state (procurement is already a cross-project read-only
browse role — spec 102 `PROJECT_VIEW_ROLES`, spec 143/ADR 0056 visibility):

| Surface                                         | Today                                                                                        | Gap               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------- |
| `/projects` hub + `/projects/[id]` detail       | procurement reads (PROJECT_VIEW_ROLES)                                                       | — already visible |
| ⓘ info sheet (client/lead/team/type/address)    | renders, no gate                                                                             | — already visible |
| WP list (rows)                                  | renders, but `canOpen = SITE_STAFF` → rows non-clickable for procurement                     | U3                |
| งวดงาน grouping in WP list + schedule swimlanes | `deliverables` SELECT gates on `can_see_project` only → **procurement reads 0 deliverables** | U1                |
| dependency arrows on the schedule               | `work_package_dependencies` SELECT gates on `can_see_wp` only → **procurement reads 0**      | U1                |
| `/projects/[id]/schedule` route + chip          | `requireRole(SITE_STAFF_ROLES)`, chip hidden                                                 | U2                |
| dates / status / map link in the ⓘ sheet        | not shown to anyone                                                                          | U4                |

`projects` + `work_packages` SELECT already carry a `current_user_role() =
'procurement'` arm (spec 102/171); `deliverables` + `work_package_dependencies`
were never given one (they post-date the procurement browse work), so the schedule
and the งวดงาน grouping render empty for procurement. This spec closes that — a
read-only widening that mirrors the existing procurement posture, no writes.

## U1 — RLS: procurement reads deliverables + dependencies + members

Add a `current_user_role() = 'procurement'` OR-arm to the SELECT policy of
`deliverables` and `work_package_dependencies` (mirroring the arm already on
`projects` / `work_packages`), keeping the existing `can_see_project` /
`can_see_wp` predicate (the membership-scoped path for PM/site_admin is unchanged;
files 70/73 pin that the qual still references those helpers — the OR-arm
preserves it). Also append `procurement` to the flat staff role-list on
`project_members` SELECT — the ⓘ info sheet's **team** row resolves member names
through it (display names come from the admin client, but the member _ids_ come
from this table). procurement becomes a cross-project reader of งวดงาน +
dependency links + team rosters, consistent with its existing all-projects/all-WPs
read. No write arm; `project_director` stays in the members list (file 91).

- Migration: source the live policy bodies, `drop policy` + `create policy`
  reproducing them with the procurement arm added. RLS-only, reversible.
- pgTAP (new file 173): procurement SELECTs a cross-project deliverable, a
  cross-project dependency, and a project_members row; a membership-scoped PM
  still sees only its own deliverable; the quals still name `can_see_project` /
  `can_see_wp` (the 70/73 pins hold).

## U2 — Schedule route + chip admit procurement

- New role const `SCHEDULE_VIEW_ROLES` = `SITE_STAFF_ROLES` + procurement (NOT
  project_coordinator — spec 154 deliberately excludes it from the schedule).
- `/projects/[id]/schedule` `requireRole(SITE_STAFF_ROLES)` → `SCHEDULE_VIEW_ROLES`.
- On `/projects/[id]`, show the schedule (calendar) chip when the viewer is in
  `SCHEDULE_VIEW_ROLES` (a `canOpenSchedule` flag, replacing the `canOpenWp` reuse
  for the chip).
- Unit-test `SCHEDULE_VIEW_ROLES`.

## U3 — Procurement can open WP details from the project page

`canOpenWp` (the WP-row click gate) currently = `SITE_STAFF_ROLES.includes(role)`.
Re-express as `WP_DETAIL_ROLES.includes(role)` (= SITE_STAFF + procurement, spec 171) — procurement may already VIEW WP detail read-only, this just restores the
navigation path. project_coordinator stays excluded (not in WP_DETAIL_ROLES,
preserving spec 154). No new gate; the WP detail page already admits procurement.

**Implementation note (U2+U3):** the project detail page had a spec-102 procurement
early-return branch (a minimal names+status WP list, no ⓘ/schedule/grouping). U2+U3
make procurement a first-class read-only viewer, so that branch is REMOVED and
procurement flows through the main render path — every write affordance there is
already `isPmRole` / `isManagerRole`-gated (onboarding, seeding, the งวดงาน
manager, reports/gear chips all stay hidden), and `WorkPackageList` is role-agnostic
(procurement gets the งวดงาน lens by default + clickable rows via `canOpenWp`).

## U4 — Richer project info (dates, status, Google-Maps link)

Add to the `ProjectInfoButton` ⓘ sheet, for all roles (non-sensitive project
metadata; surfaced for procurement per the request):

- **status** — `project.status` via the existing status label.
- **dates** — `start_date` + `planned_completion_date` (Thai-formatted; omit nulls).
- **Google-Maps link** — there are no geo columns on `projects`, so the link is an
  address-derived maps search URL (`https://www.google.com/maps/search/?api=1&query=<encoded site_address>`),
  shown only when `site_address` is set. (A pinned-coordinate map would need a geo
  column — out of scope; flagged.)

## Out of scope

- Project **reports** (PDF) + **settings/budget** stay PM/super/director (money +
  authoring; the operator did not ask for these and budget is admin-only).
- Any WRITE capability for procurement on projects/WPs/deliverables/schedule.
- Geo coordinates / an embedded map (no geo data; address-link only).
- project_coordinator schedule access (spec 154 exclusion preserved).
