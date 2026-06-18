# Spec 143 — Membership-scoped project visibility

Operator (2026-06-18): a **project manager** should see only the projects they're
involved with; a **project_coordinator** should see all. See ADR 0056 (amends
ADR 0013) for the model. Operator decisions: **full RLS isolation** (projects +
every child table, not just the hub list); **site_admin scoped** too;
**procurement keeps** its cross-project read (spec 102); coordinator + super see
all.

## Unit map

| Unit   | Scope                                                                                                                                                               | Status    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **U1** | DB: `can_see_project` / `can_see_wp` helpers + rewrite SELECT policies on the 7 project-scoped tables + lead→member backfill + pgTAP                                | THIS UNIT |
| U2     | Enable `project_coordinator` as a real role: routing (`roleHome` → `/projects`) + page allowlists (`PROJECT_VIEW_ROLES` etc.) so the see-all coordinator can browse | later     |

## U1 — DB enforcement

### Involvement

`can_see_project(p_project_id)` (SECURITY DEFINER, STABLE):

- `super_admin`, `project_coordinator` → `true` (see all).
- `project_manager`, `site_admin` → `true` iff the caller is a member
  (`project_members`) **or** the project's `project_lead_id`.
- else → `false` (and `false`, never NULL, for an unbound caller — closes the
  RLS self-check coalesce trap, ADR 0011 / [[rls-self-check-coalesce]]).

`can_see_wp(p_work_package_id)` resolves the WP's project and defers to
`can_see_project` (coalesced to `false` if the WP is gone). Definer so the
helpers read `project_members`/`projects`/`work_packages` without re-triggering
the policies that call them (no recursion).

### SELECT policies (rewritten; writes unchanged)

Preserving each table's existing exceptions exactly:

| Table                                   | New SELECT `using`                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `projects`                              | `current_user_role()='procurement' OR can_see_project(id)`                                    |
| `work_packages`                         | `current_user_role()='procurement' OR can_see_project(project_id)`                            |
| `deliverables`                          | `can_see_project(project_id)`                                                                 |
| `photo_logs`                            | `can_see_wp(work_package_id)`                                                                 |
| `approvals`                             | `can_see_wp(work_package_id)`                                                                 |
| `purchase_requests` (own-or-privileged) | `requested_by=auth.uid() OR current_user_role()='procurement' OR can_see_wp(work_package_id)` |
| `reports`                               | `can_see_project(project_id) AND current_user_role()<>'site_admin'`                           |

The separate `purchase_requests` `appsheet_writer select by status` policy (a
different DB role) is untouched. All policies use the eval-once wrapped form
`(select …)` (pgTAP file 40).

### Backfill

One-time, in the same migration: add each project's `project_lead_id` as a
`project_members` row (`on conflict do nothing`, `added_by = lead`). Keeps
current leads visible to themselves once scoping turns on.

### Test plan (pgTAP `70-project-visibility-scope.test.sql`)

Two projects (P1 with a PM member + lead; P2 with neither). Roles: super,
coordinator, pm_member, pm_other (not on P1/P2), site_member, site_other,
procurement, visitor. Assert per table that: super + coordinator see both;
procurement sees `projects`/`work_packages`/`purchase_requests` for both but not
`reports`/`photo_logs`/`approvals`/`deliverables`; a member PM/site_admin sees P1
rows; a non-member PM/site_admin sees neither P1 nor P2; `reports` is invisible
to even a member site_admin; the requester self-read on `purchase_requests`
still works; visitor sees nothing.

### Rollout hazard (operator-facing)

Turning this on hides existing projects from PMs/site_admins who aren't a member
or lead. Data today is tiny (2 projects) and `super_admin` sees all, so the
backfill + the spec-80 "add member" settings UI cover it — but the operator must
add the right people to each project. Flagged on merge.

### Verification checklist

- [ ] `pnpm db:push` applies (helpers + 7 policies + backfill).
- [ ] `pnpm db:test` — file 70 green, whole suite green.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green (no app change in U1; RLS
      does the filtering — confirm nothing regressed).
