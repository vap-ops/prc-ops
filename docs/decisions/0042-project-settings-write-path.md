# ADR 0042 — Project settings write path (back-office RPC)

**Status:** Accepted 2026-06-13
**Spec:** 58

## Context

Operator: "Add Project setting page for back office people." ADR 0013
made projects super_admin-only for INSERT/UPDATE; no UI writes projects
at all today (rows arrive via import/seed). Back office needs to rename
a project and move it through its lifecycle (active / on_hold /
completed / archived) without a console round-trip.

## Decision

1. **SECURITY DEFINER RPC, not a policy widening** —
   `public.update_project_settings(p_project_id, p_name, p_status)`.
   Widening the ADR-0013 UPDATE policy would hand PM every column and
   every future column; the RPC writes exactly `name` + `status`
   (column-scoping by definition — the spec-31
   `set_work_package_contractor` precedent). ADR 0011 checklist applies:
   `search_path = public` pinned, role check inside (42501),
   revoke-then-grant execute.
2. **Gate = project_manager + super_admin.** "Back office" today.
   `procurement` is in the spec-33 back-office helper but has NO
   projects SELECT (ADR 0013) and no reachable UI (recorded seam since
   spec 33) — widening its read posture is the procurement-onboarding
   unit's job, not this one's. The page itself gates pm/super; the
   in-app helper set and the RPC stay in lockstep when that unit lands.
3. **`code` is immutable from the app.** The WP import contract
   (ADR 0014) and human references key on it. The RPC cannot touch it.
4. **Name validation in both layers** — app validator (trim, 1–200
   chars) AND the RPC (22023 on blank/oversized) so no future caller
   can write a blank project name.
5. **No audit rows** — consistent with every other status/metadata edit
   (spec 52 hold toggle precedent); `updated_at` records when. An
   audit_action addition = own ADR if ever wanted.
6. **No DELETE, ever** — unchanged ADR 0013 posture; `archived` is the
   terminal state.

## Consequences

- New migration + pgTAP file 32 (function pins + role sims).
- `/sa/projects/[projectId]/settings` page (pm/super via requireRole);
  gear entry on the project page rendered for pm/super only.
- SA keeps read-only projects; AppSheet untouched (ADR 0034 freeze).
