# ADR 0070: `procurement_manager` role — a dept-manager superset of `procurement`

## Status

Accepted — 2026-07-04. Extends ADR 0008 (role enum expansion), ADR 0058
(`project_director` as a see-all `project_manager`), ADR 0050 (super_admin role
management), ADR 0013 (role-level access). Spec 261.

## Context

The procurement team asked for a "manager user". Today the single `procurement`
role is flat — it raises PRs, creates POs, voids POs (spec 259 gave the whole
create-audience the void), receives goods, curates suppliers/contractors, plans
supply, and pays DC payroll, with no senior/junior distinction and no
dept-level master-data authority. The operator then set the first concrete rule:
**cancelling a PO is manager-only**.

The entire gate infrastructure keys on the single `users.role` enum — TS
allowlists in `src/lib/auth/role-home.ts`, SQL `current_user_role()` checks in
RLS policies and `SECURITY DEFINER` RPCs. The role is resolved **live from
`public.users` on every request** (`loadUserContext` in `require-role.ts`, a
per-request React `cache()` memo; the middleware only verifies the session and
never reads role, and no JWT claim carries role) — so a new enum value flows
through with zero middleware or cache work.

Two rejected alternatives:

- **A boolean flag on `users`** — `users` has no flag columns, and a flag would
  need a parallel gate channel in every TS allowlist and every SQL helper. The
  enum is the existing seam.
- **Overloading the existing manager tier** (`is_manager()` / `PM_ROLES` =
  project_manager / super_admin / project_director) — that tier is
  **project-side seniority**, not procurement-dept seniority. Overloading it
  would hand every PM all procurement master-data powers. Wrong shape.

## Decision

Add one enum value `procurement_manager` to `public.user_role`.

`procurement_manager` = **everything `procurement` can do (full parity), plus a
manager-only set**. It is a superset of `procurement`, NOT a member of the
project-manager tier (`is_manager()` is untouched).

**Doctrine recorded here:** dept-manager roles are **enum values, not flags**.
The next department that needs a manager tier follows this precedent (its own
ADR + spec), rather than introducing a flag column.

### Parity (additive)

For `procurement_manager` to "do everything procurement can do", it is appended
alongside every literal `'procurement'` role gate — the shared `is_back_office()`
helper, ~47 `SECURITY DEFINER` RPCs, and ~47 RLS policies — plus the TS
allowlist constants that contain `'procurement'`. A pgTAP source-scan invariant
asserts that every function/policy admitting `procurement` also admits
`procurement_manager`, so no gate is silently missed.

### Manager-only set (v1)

| #   | Capability                        | Change                                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Void PO**                       | `void_purchase_order` gate TIGHTENS: plain `procurement` is **removed**, `procurement_manager` added → `project_manager \| project_director \| super_admin \| procurement_manager`. Deliberately walks back half of spec 259's grant (operator directive). UI button follows.                                                                                                    |
| 2   | **Void PO charge** (spec 260)     | `void_purchase_order_charge` gate widened from `is_manager()` to `is_manager() OR procurement_manager`.                                                                                                                                                                                                                                                                          |
| 3   | **Cancel an approved PR**         | a new transition-scoped RLS UPDATE policy admits `procurement_manager` to the `approved → cancelled` transition ONLY (USING old.status='approved', WITH CHECK new.status='cancelled'). The PM-tier `approved/rejected` decision path is untouched, so approval stays DB-blocked for `procurement_manager` (see below). UI cancel button follows via a cancel-specific predicate. |
| 4   | **Supplier/contractor blacklist** | flipping a contact's status to/from `blacklisted` is gated to the manager set (`PM_ROLES + procurement_manager`) at the server action; plain `procurement` keeps read + ordinary edits (name/phone/active↔probation) but not the blacklist boundary.                                                                                                                             |

### Explicitly NOT granted (v1)

- **PR approval** (`requested → approved/rejected`) stays PM-tier only. Spend
  authorization is project-side; the procurement manager runs buying execution.
  The `approve/reject` transition is enforced by the unchanged PM-tier RLS UPDATE
  policy and the `isDecider` UI predicate; `procurement_manager` is added to
  neither, so its approval attempt is refused at the database, not just the UI.
- **Supply-plan approval** stays PD/super (`approve_supply_plan`).
- Any accounting surface (`/accounting/*`, GL RPCs) — unchanged.

### Deferred, NOT v1

Master-data narrowing (ordering-plan template editing, catalog taxonomy write
side) is recorded but deferred: both reuse shared RPCs that must keep admitting
plain procurement, so narrowing means forking those RPCs onto a bespoke manager
gate — its own follow-up unit.

### Migration shape

Two migrations, per the Postgres rule that a new enum value cannot be used in
the transaction that adds it (mirrors spec 260's audit-action split):

1. Migration A — `ALTER TYPE public.user_role ADD VALUE 'procurement_manager'`
   (own transaction).
2. Migration B — the parity sweep + the four-item manager set, every function
   body/policy re-sourced VERBATIM from the live DB (`pg_get_functiondef` /
   `pg_policies`), never an old migration file (db-migration-lessons). Existing
   policies are widened via `ALTER POLICY ... USING/WITH CHECK` (preserves
   cmd/roles/permissive verbatim — the lower-risk equivalent of DROP+CREATE for a
   qual-only widening).

### Promotion path

super_admin promotes via the existing user-admin surface
(`/settings/roles`); the picker renders `Object.entries(USER_ROLE_LABEL)`, so the
`หัวหน้าจัดซื้อ` label entry is what makes the option appear. `set_user_role`
takes the enum type directly — no RPC change.

## Consequences

**Positive**

- One enum value inherits the whole gate infrastructure. Parity is a mechanical,
  invariant-checked sweep; the manager-only set is four scoped changes.
- The project-manager tier (`is_manager()`) is untouched — no PM gains
  procurement master-data powers.

**Negative**

- `ALTER TYPE … ADD VALUE` cannot run inside a transaction with its first use, so
  the change is two migrations.
- Parity means touching ~94 gate objects; a future `CREATE OR REPLACE` on any of
  them could drop the `procurement_manager` arm — the pgTAP grep pins guard this.
- Item 1 removes a capability plain procurement had for nine days (spec 259 void).

**Neutral**

- `roleHome('procurement_manager')` → `/requests`, identical to `procurement`.
- Enum ordering is not load-bearing (ADR 0008); the value is appended last.

## Open questions

Flagged to the operator on the held PR (future widenings, each its own one-line
change if approved): whether `procurement_manager` should ever approve PRs
(currently NO), and whether to build the deferred master-data narrowing unit.

## References

- ADR 0008 — Role enum expansion (no enum change without an ADR)
- ADR 0058 — `project_director` role (the see-all PM tier this does NOT join)
- ADR 0050 — super_admin user & role management (the promotion surface)
- ADR 0013 — role-level access model
- Spec 261 — `docs/feature-specs/261-procurement-manager-role.md`
- Spec 259 (void PO, item 1 walk-back), spec 260 (PO charges, item 2)
