# ADR 0077 — super_admin "View as role": a TS-layer role override, not user impersonation

**Status:** Accepted (operator-approved design 2026-07-07; U1 backend built) · **Spec:**
[274](../feature-specs/274-superadmin-view-as-role.md)

## Context

`super_admin` is the full-access operator role, admitted to every served surface — but it cannot
_experience_ another role's view. It lands on `/dashboard` with the PM nav; single-role pages gate an
exact role (`/technician` → `["technician"]`, `/portal` → `["contractor"]`, `/client` → `["client"]`)
and redirect super_admin away; and no role's tailored home + nav + page-set is reachable. To support
users, QA flows, and verify what each role actually sees, the operator wants super_admin to render the
app **as any role**.

Two shapes were considered:

- **Impersonate a specific user** — adopt a chosen person's identity so RLS returns _their_ data.
  Powerful for support, but a session-takeover: RLS re-scoping, dual-actor audit, tight write
  guardrails. Rejected for v1 (large, security-heavy).
- **View-as-role** — re-interpret the caller's _role_ while keeping super_admin's own auth identity
  and RLS. Chosen.

The operator confirmed: **view-as-role** (not user-impersonation); **fully active** (the assumed role
gates actions too, not read-only); entry from the Settings admin section, exit from a persistent
banner.

## Decision

1. **The override is a single TS-layer re-interpretation of the caller's role.** One pure resolver,
   `resolveEffectiveRole(realRole, cookieValue)` (`src/lib/auth/effective-role.ts`), is the SSOT:
   it returns the assumed role **iff** the real role is `super_admin` and the cookie value is in the
   `ASSUMABLE_ROLES` allowlist; otherwise the real role, unchanged. Wired into the two central gates —
   `loadUserContext` (→ `requireRole`, `roleHome`, every nav builder) and `requireActionRole` — so the
   whole role-gated surface follows from one place. State lives in an httpOnly `assumed_role` cookie.

2. **The `realRole === "super_admin"` check is the security boundary (the forge-guard), re-evaluated
   every request.** A non-super caller who forges the cookie gets **zero** effect. The resolver is pure
   so no call site can skip the guard. Enter/exit actions resolve the **real** role directly (never the
   overridden gate) so a super_admin who assumed a narrower role can always switch or exit.

3. **Postgres never sees the cookie — this is the deliberate fidelity ceiling.** RLS + SECURITY DEFINER
   RPCs resolve role via `current_user_role()` = `select role from users where id = auth.uid()`, and
   `auth.uid()` stays super_admin. Consequences we **accept**, not fight:
   - **No new privilege.** super_admin is already top; assuming a narrower role can never grant data
     its own uid cannot already reach. This is why the feature is safe by construction.
   - **"Fully active" is faithful at the TS gate, not at the DB.** The UI lets through / blocks actions
     as the assumed role would, but a write that passes executes with super*admin authority underneath.
     A faithful \_experience*, not a data sandbox. A request-scoped GUC to make Postgres see the assumed
     role is explicitly **out of scope** (fragile under connection pooling, and itself risky).
   - **Assumed-role audit is emitted in the TS layer** — the DB only ever stamps super_admin.

4. **Assumable = served roles with a real UI.** `ASSUMABLE_ROLES` excludes super_admin itself (no
   self-assume) and every unbuilt `/coming-soon` role (visitor, hr, subcon_manager, site_owner,
   auditor). Identity-scoped roles (technician, contractor, client) ARE assumable but render a "no
   personal data in this view" placeholder — their self-scoped reads key on super_admin's own (empty)
   records. Pinned by `effective-role.test.ts` so any widen is a deliberate in/out decision.

5. **`/settings` stays on the REAL role.** It reads role independently of `loadUserContext`, so the
   enter card + exit stay reachable while a role is assumed — `/settings` is the real-identity control
   panel. Logout clears the cookie so a "view as" never survives sign-out.

## Consequences

- **Small, centralized enforcement for reads/nav/page-gates.** One resolver + two gate edits cover
  every `requireRole`/`requireActionRole` path.
- **Write fidelity is partial in v1.** ~30 server actions read `users.role` inline (not via
  `requireActionRole`); those keep super_admin write power regardless of the assumed role — a fidelity
  gap, never an escalation. Migrating them to the shared resolver is a deliberate follow-up unit, not a
  silent omission.
- **Danger-path.** Touches `src/lib/auth/**`; the PR is operator-held by the autonomous-build guard, as
  intended for an auth-doctrine change.
- **No schema.** Cookie + TS only; does not take the schema lane. Assumed-role audit reuses `audit_log`.

Extends the role-doctrine home ADR-set (0058/0070/0072). Independent of the money/RLS posture (0046, 0069) — grants no data reach beyond super_admin's own.
