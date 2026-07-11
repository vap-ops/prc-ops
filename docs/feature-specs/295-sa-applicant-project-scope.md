# Spec 295 — Scope the SA pending-applicant queue to the SA's project

**Status:** ✅ U1 SHIPPED (2026-07-11). From feedback `b0ff6cea` (site_admin).
**Type:** correctness + least-privilege. **Class:** danger-path (RLS helper) — operator-merged.
**Parent:** spec 279 self-gov onboarding.

## Problem (confirmed LIVE)

Every site_admin saw the **entire firm-wide pending-applicant queue** ("รอตรวจ" on
`/sa/crew` + `/sa/registrations`), including applicants for projects the SA is not a
member of. The RLS helper `can_see_staff_registration` SA/site_owner arm gated on
`status='pending'` **only** — no project scoping.

## Key finding — the project edge already exists

`staff_registrations.invited_project_id` (+ `invited_by`) is **already stamped** from
the SA's per-project self-onboard QR (spec 279 F2a/F2b) at `start_staff_registration`
time (live at `/sa/crew`). Only the read arm never consulted it — its own comment named
this exact task ("narrowed to project scope by a future referring-SA edge"). So the fix
is **one RLS-helper rewrite, no new schema**.

## The change (mig `20260813075680`)

`CREATE OR REPLACE can_see_staff_registration` — SA/site_owner arm narrowed to:
`status='pending' AND invited_project_id IS NOT NULL AND can_see_project(invited_project_id)`.

- Multi-project SA = union of their projects (via `can_see_project`, which checks all
  memberships).
- **Unreferred (NULL `invited_project_id`) pending rows → back-office ONLY** (option A,
  least-privilege). The back-office arm (procurement_manager/project_director/super_admin)
  is unchanged and still sees every registration.
- `invited_project_id` stays visitor-supplied/advisory (spec 279 F2b) — here it can only
  NARROW an already role-gated read, never grant a non-SA anything; a forged/stale ref is
  existence-coerced to NULL at write time and fails the predicate closed.

## Verify

pgTAP `295-sa-applicant-project-scope.test.sql` (10 assertions) proves the full matrix:
SA sees own-project pending ✅ / not cross-project ✅ / not unreferred ✅ / not non-pending ✅;
the mirror SA; site_owner rides the same arm; back-office still sees unreferred + non-pending.
`264b` updated to the scoped seam. Behaviour also confirmed against the live function.

## Adoption note

The current pending applicants registered via the generic link (NULL `invited_project_id`),
so post-change SAs see zero until applicants use the per-project QR — the correct
least-privilege state, and it nudges the intended QR onboarding flow (spec 279).

## Out of scope

Applicant-picks-project or invite-only registration (options B/C, declined); an
`/sa/registrations` empty-state copy nudge (optional follow-up).
