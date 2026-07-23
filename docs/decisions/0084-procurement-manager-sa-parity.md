# ADR 0084 — procurement_manager is a site_admin superset (SA parity, see-all)

Date: 2026-07-23
Status: Accepted (operator, in-chat brainstorm 2026-07-23)
Spec: `docs/feature-specs/348-procurement-manager-sa-parity.md`
Extends: ADR 0070 (procurement_manager = procurement superset)

## Context

The procurement manager trains and supports the site admins — she must be able
to reach every SA feature, see real data on it, and operate it herself to teach
it. ADR 0070 made `procurement_manager` a full superset of `procurement` plus
manager-tier authority (destructive procurement actions, PR decide, staff
approval). It had none of the SA field-capture tier: `can_see_project` returned
false for both procurement tiers, `is_site_staff` excluded them, ~35 policies
and ~44 functions gate SA surfaces on `site_admin` literals, and spec 171/261
deliberately made the WP detail read-only for proc roles.

A TS-layer view-as without DB backing (spec 274's mechanism) was considered and
rejected for this need: it renders SA screens whose reads come back empty and
whose writes fail — a hollow shell that cannot demonstrate anything.

## Decision

1. `procurement_manager` = union(`procurement`, `site_admin`) + its existing
   manager-tier extras. Every gate that admits `site_admin` admits
   `procurement_manager` under the same conditions — and none beyond: where an
   arm deliberately excludes site_admin, it excludes procurement_manager too.
   SA parity is a ceiling, not a floor.
2. Visibility scope is **see-all**: `procurement_manager` joins the see-all arm
   of `can_see_project` (alongside super_admin / project_coordinator /
   project_director), not the membership arm. No `project_members` rows are
   needed or meaningful for it; the team-add picker keeps it out.
3. The grant is **role-level**. Any user assigned procurement_manager —
   including via the staff-approval flow, where the role is already offered —
   carries the full set. Approvers assign it knowingly.
4. Spec 274's view-as extends with a per-assumer allowlist:
   `procurement_manager` may assume `site_admin` only, as a teaching lens. It
   ships only after DB parity lands, so the lens is backed by real authority
   and anything un-widened fails closed at the DB.
5. Plain `procurement` is unchanged everywhere, permanently the read-only WP
   viewer. The SA↔money separation is untouched (it excludes site_admin from
   money; procurement_manager already holds the money side).

## Consequences

- The role gains cross-project field-capture write authority — wider than any
  single membership-scoped SA. Accepted: audit attribution (ADR/spec 337 U1)
  records the actor on every write, and all build units are danger-path,
  operator-held.
- `SITE_STAFF_ROLES`, `is_site_staff()`, `can_see_project()`, the SA literal
  policy/RPC arms, and `isReadOnlyWpViewer` all change under spec 348's units;
  role-set guard pins update deliberately.
- Future SA features must admit procurement_manager by construction (via the
  widened sets/helpers) — inline `site_admin` literals are the drift risk the
  sets exist to prevent.
