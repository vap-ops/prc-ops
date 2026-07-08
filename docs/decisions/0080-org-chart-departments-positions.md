# ADR 0080 — Org model: separate department · role · level · position (departments as open data)

**Status:** Proposed (design approved by operator 2026-07-08; build not started) ·
**Spec:** [284](../feature-specs/284-org-chart-departments-legal.md) ·
**Relates to** [ADR 0010](0010-visitor-default-role.md) (visitor default / role-based access),
[ADR 0013](0013-project-access-model.md) (project-access model — worker record ≠ login),
[ADR 0070](0070-procurement-manager-role.md) (department-manager precedent),
[ADR 0071](0071-technician-roles-and-registration.md) (site_owner/auditor stubs),
[ADR 0072](0072-staff-self-onboarding.md) (office-staff record seam, §4),
[ADR 0073](0073-worker-identity-merge.md) (worker identity axes).

## Context

The firm just added a **Legal** department. There is nowhere to put it: the app has **no
department concept**. The `user_role` enum (16 values) has been doubling as a de-facto
department label — `procurement`≈purchasing, `accounting`≈finance, `hr`≈HR — so every new
org function has meant **enum surgery + an ADR + role-set edits + nav-set edits**. Three
enum values (`site_owner`, `subcon_manager`, `auditor`) are behavior-free stubs that route
to `/coming-soon`; they conflate a _title_ or _oversight function_ with a _login type_.

A grounded read of the codebase (2026-07-08 org-model sweep) confirms the firm actually has
**four orthogonal axes that today are collapsed into one enum**:

- **Department** — the org box you sit in. _No representation today._
- **Role (auth)** — what app features you can touch. `users.role`, single-valued, enforced
  by SQL RLS (`current_user_role()` + null-safe wrappers), the TS page gate `requireRole()`,
  and the action gate `requireActionRole()`; capability sets are hand-enumerated in
  `src/lib/auth/role-home.ts`.
- **Level** — seniority/grade. Already exists as `workers.level` (senior|mid|junior|apprentice),
  set by `set_worker_level()`; drives sell-rate economics only.
- **Position** — a named job title, often scoped. The one instance today is
  `projects.ht_worker_id` (หัวหน้าช่าง / Head Technician), a project-scoped promotion that
  grants WP ownership + a coin bonus but **no app access**.

The operator's framing that crystallized this: _"position is like Site Owner when role is
Technician"_ — a title, not a login.

**Operator constraints (2026-07-08 brainstorm):** departments must be **open** (add one
anytime, no migration); **one primary role per person** (no multi-hat); **access stays
role-gated** now with a **seam** for dept-scoped RLS later; level/position on **workers only**
now (office-staff seam deferred); **one head per department**, modeled as a **field, not a
role**.

## Decision

Formalize the four axes as distinct concepts, model **Department** and **Position** as
**open data** (rows, not enums), keep **Role** small and engineered, **reuse** the existing
**Level**, and deliver **Legal** as the first tenant on the proven money/document posture.

1. **`departments` is first-class OPEN data, non-gating.** A new department = **INSERT a
   row** — no migration, no enum value, no ADR. Columns: `id, key, name_th, name_en,
is_active, head_user_id, sort_order`. Seed **6 active** (site, procurement, accounting,
   pmo, executive, **legal**) + **2 inactive** (hr, subcon_mgmt — the current role stubs,
   parked as inactive rows, flipped active when built).

2. **A login belongs to one primary department** via `users.department_id` (nullable FK →
   `departments`). Applies to office and field logins alike. **Multi-dept membership is
   deferred** (YAGNI) — the open table lets a `user_departments` bridge be added later
   without touching this decision.

3. **Department is NON-GATING.** RLS and nav continue to key off `users.role`, unchanged.
   The table is shaped so **dept-scoped RLS can be added later** (a `department_id` predicate
   in a policy), but **no policy references it in v1**. This keeps the money-domain RLS
   invariants (fail-closed wrappers, zero-grant tables) untouched.

4. **One head per department** via `departments.head_user_id` (a **field**, not a role).
   Headship is org data; it does **not** proliferate `*_manager` enum values.
   (`procurement_manager`, ADR 0070, remains as-is — legacy; headship for new departments,
   including Legal, is the field.)

5. **`user_role` stays small and engineered — add exactly one value, `legal`.** Legal needs
   genuinely new feature surfaces (contracts, document approval) **and** data isolation, so it
   earns a role. The rule going forward: **a new department reuses existing roles by default;
   a new role is added only when the department introduces new capability + isolation** — not
   merely because it is a new org box.

6. **Four axes, named and separated:** Department (open data, on `users`) · Role (auth enum,
   on `users`, 1 per user) · Level (`workers.level`, **reused unchanged**) · Position (open
   data, on `workers` in v1).

7. **`positions` + `worker_positions` are OPEN data (phase 2), non-gating.** Generalize
   `projects.ht_worker_id` into the first `worker_positions` row (scope='project'); `positions`
   carries `key, name_th, name_en, scope (firm|site|project), is_active`. A position grants
   **accountability/title, never app access**.

8. **Reclassify the mis-modeled role stubs.** `site_owner` and `subcon_manager` become
   **Positions**; their enum values are **deprecated additively** (routed away, kept in place)
   and dropped only in a later **operator-held** cleanup. `auditor` **stays a Role** —
   oversight is real, distinct feature access, not just a title.

9. **Level and Position attach to `workers` only in v1.** Office staff (a `users` row with no
   `workers` row) get **Department + Role** only. The **person seam** flagged in ADR 0072 §4
   is built toward — level/position **can** extend to office staff later — but it is **not
   closed** now.

10. **Legal is delivered on the money/document posture.** New `contracts` (cloning the
    `subcontracts` shape + an append-only `contract_attachments` table) and a generalized
    `document_approvals` (from the append-only `approvals` decision-log). All Legal ฿/document
    tables are **zero-authenticated-grant**, read via the admin client behind
    `requireRole(LEGAL_ROLES)`, with SECURITY DEFINER RPCs and `anon` revoked. **Permits and
    disputes/claims are deferred** (greenfield, phase 3).

**Non-goals (explicit):** M:N multi-role · a full reporting tree (dept-head is the only
hierarchy) · dept-scoped RLS in v1 (seam only) · an office-staff person record in v1 (seam
only) · permits and disputes in v1.

## Consequences

- **Role stops meaning "department."** Adding org units becomes a data operation, not a
  migration. The recurring enum-surgery tax on every new function is retired.
- **Small, contained auth change.** One additive enum value (`legal`) + the `01-users.test.sql`
  pin update + a new `LEGAL_ROLES` set + `/legal` routing. This unit is danger-path
  (role enum + auth) and is **operator-held** per the build fence.
- **Two stubs deprecated additively.** `site_owner`/`subcon_manager` are routed away and
  become Positions; the destructive `DROP`/enum-value removal and the `ht_worker_id` retirement
  are **separate operator-held break-glass cleanups**, out of the additive lane.
- **The dept table must ship with a real consumer** (org-chart display card + a dept filter on
  the `/registrations` approver queue) so it does not rot into an unused stub like
  `site_owner`/`auditor` did.
- **Money posture unchanged.** Legal's tables inherit the binding zero-grant/admin-read/DEFINER
  posture verbatim; no new posture is invented.
- **The full org taxonomy stays reachable without a big-bang migration.** Dept-scoped RLS,
  office-staff positions, and a reporting tree are all future increments behind the same tables,
  chosen when a real need appears (AI-first "prove-value").
