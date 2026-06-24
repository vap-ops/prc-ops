# ADR 0063 — Project-level purchasing: a purchase request's work package is optional (amends ADR 0022, extends ADR 0056)

## Status

Accepted (2026-06-24). Operator decision, spec 195.

## Context

The WP-centric principle (the operator's organising rule, 2026-06-13) made the
**work package the center of information** — scope, time, and resource all map
against a WP. Purchasing inherited this literally: a `purchase_request` has
**`work_package_id NOT NULL`** (ADR 0022), so every requisition is raised
against one WP, and a WP carries the material cost at **purchase** time.

The operator now wants procurement to work at the **project** level
(spec 195, 2026-06-24):

> "Full plan, purchasing will no longer be WP-centric (selectable, but not
> compulsory). WP will track from usage."

Material is bought **for the project**, received into the **on-site store**
(spec 177/178), and a WP's material cost is attributed **when the WP withdraws
(เบิก) from the store** — at moving-average cost — not at purchase. The store
half is already built: a เบิก issues stock to a WP and spec 178 U4 folds that
issue into `wp_profit` materials at the issue price. The missing piece is
letting a purchase request exist **without** a WP, scoped to the project.

This **amends the WP-centric principle**, so it gets an ADR. It also touches a
security boundary: `purchase_requests` SELECT visibility is `can_see_wp`-scoped
(ADR 0056). A WP-less PR has no WP to gate on, so visibility must move to a
**project** gate without widening WP-bound PR visibility.

## Decision

1. **The work package becomes optional on a purchase request.** A PR is scoped
   to a **project**, optionally to a WP within it:
   - `purchase_requests.work_package_id` → **NULLABLE**.
   - Add `purchase_requests.project_id uuid NOT NULL` (FK → `projects(id)`,
     `on delete cascade`, mirroring the WP FK's defensive cascade). Backfilled
     from each existing row's `work_package_id → work_packages.project_id`
     (all 27 prod rows have a valid WP; the backfill is total).
   - A WP-bound PR's `project_id` is **derived from its WP, authoritatively** —
     a `BEFORE INSERT` trigger sets `project_id := work_packages.project_id`
     whenever `work_package_id` is present, so a WP-bound PR can never carry a
     `project_id` that disagrees with its WP (removes a visibility-misfile
     vector — see point 3). A WP-less PR's `project_id` is client-set and gated
     by RLS.

2. **The WP-centric principle is amended, not abandoned.** The work package
   stays the center for **work and progress** (photos, approvals, labor,
   schedule). **Procurement** moves to the project level (material flows into
   the project store); a WP's **material cost** is attributed at **usage**
   (the เบิก/issue), not at purchase. So the WP is still where material cost
   lands — at withdrawal, not at buy.

3. **RLS — a project-scoped visibility arm (extends ADR 0056).** The
   `purchase_requests` SELECT policy keeps the requester self-read, the
   `procurement` cross-project read, and the `can_see_wp(work_package_id)` arm,
   and **adds** an `OR can_see_project(project_id)` arm. For a WP-bound PR this
   adds nothing — `project_id = wp.project_id`, so `can_see_project(project_id)`
   is exactly `can_see_wp(work_package_id)` — so **WP-bound PR visibility does
   not widen**; the new arm only covers WP-less PRs (where `can_see_wp(null)` is
   false). The INSERT policy gains a parallel WP-less arm: the sa/pm/super/
   director role set may insert a WP-less PR gated on
   `can_see_project(project_id)`, beside the existing WP-bound `can_see_wp` arm
   and the cross-project `procurement` arm. UPDATE is unchanged (role-level
   pm/super/director, as today).

4. **Phased build (spec 195).** This ADR's schema + RLS is **Phase 1**.
   Phase 2 makes the supply plan generate WP-less PRs; Phase 3 receives a
   store-destined PO line into a `stock_receipt`; Phase 4 reconciles cost so
   material lands once (inventory at receipt, WP cost at เบิก). Phases 2–4 are
   out of scope here.

## Consequences

- A WP-less PR shows at the **project** level — on `/requests` and as a
  project-scoped (not WP-nested) requisition. WP-bound PRs are unchanged.
- The `project_id`-from-WP trigger means the app does not compute `project_id`
  for WP-bound PRs, and a WP-bound PR is always filed under its WP's project —
  no client can mis-file it into another project to leak visibility.
- ADR 0022's "single stateful row, dual-identity" design is otherwise intact;
  the `appsheet_writer` policies and the lifecycle/audit triggers are untouched
  (the AppSheet path still writes WP-bound rows; the trigger fills `project_id`).
- The existing `can_see_wp` pins (pgTAP 70/73/17) stay green — the arm is kept,
  not replaced.

## Alternatives rejected

- **Keep `work_package_id NOT NULL`; model a project-wide PR as a row against a
  synthetic "project" WP.** Pollutes the WP table with non-work rows and breaks
  every WP list/progress view. The optional FK is honest.
- **Replace the `can_see_wp` SELECT arm with `can_see_project(project_id)`
  outright.** Logically equivalent for WP-bound rows, but drops the `can_see_wp`
  pins (files 70/73/17) and loses the explicit WP-scoping signal. Keep both arms.
- **Validate `project_id = wp.project_id` in the INSERT policy with a subquery
  instead of a trigger.** Works, but re-evaluates a correlated subquery per row
  inside RLS and leaves `project_id` client-controlled on the row. The
  derive-trigger is cleaner and removes client control entirely.
