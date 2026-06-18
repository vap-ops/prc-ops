# ADR 0056 — Membership-scoped project visibility (amends ADR 0013)

## Status

Accepted (2026-06-18).

## Context

ADR 0013 set a **role-level** access model: `site_admin` / `project_manager` /
`super_admin` (and later `procurement`, spec 102) could SELECT **every** project
and its children. `project_members` (spec 80) and `project_lead_id` (spec 79)
existed but were display/accountability metadata only (ADR 0032) — never an
access gate.

The operator now wants project visibility scoped to involvement: a
**project manager** (and **site_admin**) should see only the projects they are
on; a **project_coordinator** should see all (oversight); `super_admin` keeps
all. `procurement` keeps its cross-project read (spec 102 — it needs every
project/WP for purchasing context).

The hard part is the cascade: each project-scoped child table
(`work_packages`, `photo_logs`, `approvals`, `reports`, `deliverables`,
`purchase_requests`) grants read **independently by role** today. Scoping only
the `projects` row would leave children reachable by direct query — not a real
boundary. So this is enforced at **every** project-scoped table.

## Decision

1. **Involvement** = the caller is a member (`project_members`) of the project
   **or** is its `project_lead_id`.

2. Two `SECURITY DEFINER STABLE` helpers (ADR 0011 precedent — definer reads
   `project_members`/`projects` without re-triggering the policies that call
   them, avoiding recursion):
   - `can_see_project(p_project_id)` — `true` for `super_admin` /
     `project_coordinator` (see-all); for `project_manager` / `site_admin`,
     `true` iff involved; else `false`. Returns `false` (never NULL) for an
     unbound caller — closes the [[rls-self-check-coalesce]] trap.
   - `can_see_wp(p_work_package_id)` — resolves the WP's project and defers to
     `can_see_project` (coalesced to `false` if the WP is gone).

3. Each project-scoped table's SELECT policy is rewritten to gate on the
   relevant helper, **preserving each table's existing exceptions**:
   - `projects`, `work_packages` — `can_see_project(...)` **OR** caller is
     `procurement` (keeps spec-102 cross-project read).
   - `deliverables` — `can_see_project(project_id)` (procurement never had it).
   - `photo_logs`, `approvals` — `can_see_wp(work_package_id)`.
   - `purchase_requests` — `requested_by = auth.uid()` **OR** `procurement`
     **OR** `can_see_wp(work_package_id)` (keeps the requester self-read; the
     separate `appsheet_writer` status policy is untouched).
   - `reports` — `can_see_project(project_id)` **AND** caller is not
     `site_admin` (reports stay PM/super/coordinator only, spec 19).

   Writes/INSERT/UPDATE policies are **unchanged** — this ADR is about read
   visibility. `super_admin` and `project_coordinator` are unaffected by the
   membership branch; `procurement`'s reach is preserved exactly.

4. **`project_coordinator` becomes a real, see-all role.** Routing + page
   allowlists that admit it to the project surfaces are a follow-on unit; the
   DB grant lands here.

## Consequences

- A PM/site_admin sees only involved projects across the whole app — the
  worklists, payroll, reports lists, etc. filter automatically via RLS, no
  per-query app changes.
- **Rollout hazard:** existing projects where a PM/site_admin is neither a
  member nor the lead become invisible to them. Mitigation: a one-time backfill
  adds each project's `project_lead_id` as a member; beyond that the operator
  adds members via project settings (spec 80 UI). `super_admin` always sees all,
  so nothing is lost operationally.
- Children are gated through definer helpers, so a future change to "involved"
  is one function edit, not seven policy rewrites.
- `can_see_wp` adds one indexed lookup per child-row visibility check; the WP
  `id` PK + `project_members` PK make it cheap.

## Alternatives rejected

- **Scope only the `projects` list (app-level filter).** Leaky — deep links and
  child queries still return other projects' rows. Not a security boundary.
- **Membership table as the sole signal (no lead).** Would hide a project from
  its own lead until separately added; `project_lead_id` is a real involvement
  signal, so it counts.
