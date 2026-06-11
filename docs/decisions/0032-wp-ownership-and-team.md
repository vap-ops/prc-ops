# ADR 0032 — Work-package owner + team (assignment metadata)

**Status:** Accepted — 2026-06-11. Spec 28 Part A. Extends (does NOT
reverse) ADR 0013.

## Context

The WP detail redesign (spec 28) needs "whose job is this" — but no
ownership/assignment data exists anywhere. ADR 0013 decided access is
role-level with no project membership (both pilots share all staff).
That stays true; what's missing is accountability DISPLAY, not an
access gate.

## Decision

- `work_packages.owner_id uuid NULL references users(id)` — the single
  accountable person. Written through the existing PM/super UPDATE
  policy (no new policy; the open-policy two-layer-guard posture of
  ADR 0026 applies — the server action is the only writer).
- New table `work_package_members` (`work_package_id`, `user_id`,
  `added_by`, `added_at`, PK (work_package_id, user_id)) — the crew.
  **Plain mutable table, real DELETEs**: assignment is operational
  metadata, not evidence — the append-only ceremony (ADR 0004/0015) is
  for records that prove something happened; who is currently assigned
  proves nothing historical. This is the repo's first deliberately
  mutable domain table and this paragraph is the justification.
- RLS: SELECT for requester-capable staff (site_admin / project_manager
  / super_admin — visitors excluded); INSERT/DELETE for PM/super only,
  INSERT pins `added_by = auth.uid()`. Revoke-all-first per platform
  default-privileges rule.
- **Membership is NOT an access gate** — no policy anywhere may
  reference work_package_members for visibility (ADR 0013 boundary).
  A future "งานของฉัน" filter is a display filter only.
- appsheet_writer: no grants (procurement doesn't manage site crews).
- Staff picker data path: server-side via the admin client (users table
  RLS stays locked; the page passes {id, name} pairs of
  sa/pm/super-role users to the client picker — same exposure class as
  fetchDisplayNames, recorded here).

## Consequences

- Unlocks (not built here): งานของฉัน WP filter, received_by as a user
  reference, team-scoped notifications.
- Empty-chips risk recorded: the feature is only as good as PMs
  maintaining assignments — operator accepted in chat ("full").
- pgTAP file 23 covers the matrix + role-sims; spec-28 checklist owns
  UI verification.
