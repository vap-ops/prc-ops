# Spec 192 — First-real-project readiness

**Why:** the app is feature-complete but operator-incomplete — built far ahead of
real usage (≈0 workers, ≈2 contractors in prod). The highest-leverage work is no
longer breadth; it's removing the friction cliffs that would stop a _first real
project_ from producing trustworthy data. Two cliffs were mapped:

1. **Silent membership dead-end.** Project visibility is membership-gated
   (`can_see_project` = a `project_members` row OR `project_lead_id`, ADR 0056).
   A project with no members — or where the site admin was never added — is
   invisible to that person (a 404, not an explanation, and they can't even see it
   to ask). `removeProjectMember` had **no guard**: a PM could remove the last
   member (or themselves) and orphan the project, visible only to super_admin.
2. **No site-admin home** (the SA's daily loop — log labor / photos / PR — is
   buried 3–4 taps deep in a work-package tab). _(Later unit.)_

## U1 — membership safety net (shipped 2026-06-24)

The bounded, correctness-flavored first win. Keep the invariant **a project always
retains ≥1 member** and make self-removal an informed choice. No migration — a
UX-footgun guard at the right altitude (member add/remove are already direct
table ops under RLS, not RPCs; projects are never hard-deleted, so no cascade
concern).

- **Pure** `evaluateMemberRemoval({ totalMembers, removingSelf })` →
  `{ blocked, reason?, needsConfirm }`: blocks when `totalMembers <= 1` (last
  member); flags `needsConfirm` for a self-removal when others remain.
- **Server** `removeProjectMember` counts members first and refuses the last one
  with a clear Thai error (the load-bearing guard — can't be bypassed by the UI).
- **UI** (`settings-form.tsx`, new `currentUserId` prop): the last member's remove
  control is disabled with a "ต้องมีสมาชิกอย่างน้อย 1 คน" hint; removing **yourself**
  (when others remain) routes through the themed `ConfirmDialog`
  ("…คุณจะไม่เห็นโครงการนี้อีก…"), removing someone else stays one-click.

## U2+ (next, not in this unit)

- Onboarding leads with **add your team** (so the SA can see the project) — the
  checklist currently lists it without explaining the visibility consequence.
- A **site-admin home** surfacing the daily loop (log labor / photos / PR) in one
  tap, scoped to their projects.
- A non-member who opens a project URL gets an explanatory "ask the PM to add you"
  screen instead of a bare 404.
