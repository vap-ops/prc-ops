# ADR 0058 — `project_director` role (see-all `project_manager`)

## Status

Accepted (2026-06-19). Extends ADR 0008 (role enum expansion), ADR 0013 / ADR
0056 (project access model), ADR 0050 (super_admin user/role management).

## Context

The operator wants a **project director** role "similar to super_admin".

`super_admin` in this app is the full-access **operator / system-owner** role: it
sees every project (ADR 0056), passes every gate, AND owns operator-only surfaces
— user/role management (ADR 0050), the OperatorHub on `/coming-soon`, and the
notification-recipient machinery. A *project director* is an executive over
project **delivery** — they should see and run every project, but they are not a
system operator and must not inherit user/role administration.

Architectural constraint: this codebase has **no role-group indirection in SQL**.
Every authorization gate is either a literal `current_user_role()` comparison (in
~100 migration policies + the SECURITY DEFINER RPCs) or a TypeScript role array.
There is no `is_super()` / `has_role()` helper. So a new role that "behaves like"
an existing one means **adding the enum value, then adding it everywhere the
template role appears** — there is no single switch.

## Decision

1. **Add the enum value** `project_director` to `public.user_role`. Its own
   migration — `ALTER TYPE … ADD VALUE` cannot share a transaction with a
   statement that uses the new value (ADR 0008 precedent; the same trap that
   forced a standalone migration for every prior role add).

2. **Semantics: `project_director` = `project_manager`'s permissions everywhere,
   with ONE difference — visibility is see-all** (like `super_admin` /
   `project_coordinator`) instead of membership-scoped. Concretely:
   - Add `project_director` to the **see-all** branch of `can_see_project`
     (ADR 0056). Child tables inherit via `can_see_wp` / `can_see_photo_log` — one
     function edit, not seven, exactly as ADR 0056 §Consequences intended.
   - Add `project_director` **everywhere `project_manager` appears** in a gate:
     TS role arrays (`PM_ROLES` and the sets built on it), page `requireRole`
     allowlists + inline manager checks, the SECURITY DEFINER RPC allowlists, and
     the table write RLS policies.

3. **NOT granted — operator/system-only surfaces** where `super_admin` stands
   alone: user/role management (ADR 0050), the `/coming-soon` OperatorHub
   (`super_admin` branch), and the notification-recipient queries
   (`drain` / `resolve-recipients`). Any single-role `= 'super_admin'` check is
   left untouched. A delivery executive is not a system operator; cloning
   operator powers onto it is a privilege-escalation surface, not a convenience.

4. **Landing:** `roleHome(project_director)` → `/review` (the PM/super review
   queue), and the role gets the `PM_TABS` bottom-bar set.

## Consequences

- A director sees and can act on **every** project with no `project_members`
  rows — the see-all branch does it; nothing to backfill (contrast ADR 0056's
  rollout hazard for membership-scoped PMs).
- Because the model is "PM + see-all", the change is a **wide but mechanical
  sweep**: every `project_manager`-bearing gate gains `project_director`.
  Delivered in three units (spec 152): U1 identity + visibility + nav, U2 RPC
  action gates, U3 table write RLS policies.
- The missing role-group helper (`is_super` / `has_role`) is **not** introduced
  here — it would mean rewriting ~100 literal policies in one change. The literal
  sweep is the in-scope path; the helper is recorded debt.
- **Drift risk:** future code that hardcodes `project_manager` / `super_admin`
  must remember `project_director`. Mitigation: prefer the `PM_ROLES` array over
  inline literals going forward (flagged in spec 152 open questions).

## Alternatives rejected

- **Full `super_admin` clone (identical access, incl. operator surfaces).** The
  operator chose the executive-director tier, not a second operator. Granting
  user/role management to a delivery role is privilege escalation.
- **`is_admin_role()` helper + rewrite every policy to use it.** Cleaner
  long-term, but a ~100-policy rewrite in one change — deferred as debt.
- **Make `current_user_role()` return `project_manager` for directors.** Erases
  the distinct role (its label, its see-all visibility). Rejected.
