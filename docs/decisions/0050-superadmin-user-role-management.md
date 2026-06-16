# ADR 0050 — super_admin user & role management

- Status: Accepted (design) — 2026-06-16. Build TBD (its own spec). Generalizes
  ADR 0010; the coarsest access lever behind ADR 0049.
- Context: today role assignment is out-of-band — ADR 0010 defaults new signups to
  `visitor` and promotion is manual (DB / console). The operator wants `super_admin`
  to **change a user's role in-app**. Role is also the broadest AI-access lever (ADR
  0049): changing a role changes what AI — and everything else — that user can reach.
  Constraint: ADR 0019 REVOKEd `UPDATE` on `public.users` from `authenticated`, so
  there is deliberately **no direct user-write path**; a role change must go through
  a gated, owner-privileged RPC.

## Decisions

1. **`set_user_role` SECURITY DEFINER RPC, super_admin-only, audited.** The owner
   bypasses the ADR-0019 revoke, so the "no direct user write" doctrine stays intact
   while this one gated path exists. Gate: `current_user_role() = 'super_admin'` on
   the **authenticated** session (the spec-68 lesson — never call it via the admin
   client; service-role has no `auth.uid()` and would fail the gate and the actor
   stamp). Writes exactly one `audit_log` row (actor, target, old→new role).

2. **Guardrails (refuse, don't silently no-op).**
   - **Lockout prevention:** cannot remove the **last** `super_admin` (the RPC counts
     remaining super_admins and refuses if this change would leave zero).
   - **Self-demotion guard:** a super_admin cannot change **their own** role (forces a
     second super_admin to do it — avoids accidental self-lockout).
   - **Valid target only:** `p_role` must be a real `users.role` enum value (no
     arbitrary string; enum-typed param enforces it).
   - Visitors are promoted through this same RPC — it subsumes ADR 0010's manual step.

3. **Surface:** a `super_admin`-only user list under the admin/control area
   (`requireRole(super_admin)`, same home as the ADR 0049 AI controls) — list users
   (name, email, current role), change role via a confirm dialog. No bulk edits v1.

## Consequences

- In-app, audited, guard-railed role assignment replaces out-of-band promotion;
  ADR 0010's "manual promotion" is now this RPC.
- This is the **coarse** tier of AI access (ADR 0049): role → per-feature
  `allowed_roles` → per-user override. Changing a role re-derives all of that user's
  AI access (and all non-AI access) at once.
- Money/immutability posture unchanged: users-table write stays revoked from
  `authenticated`; this RPC is the single owner-privileged, audited exception.
- Out of scope: inviting/creating users (signup stays LINE OAuth → `visitor`),
  deleting users, per-permission ACLs (role is the unit, per ADR 0013 role-level
  access). Related: ADR 0010, 0013, 0019, 0049.
