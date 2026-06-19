# ADR 0059 — Work-package mutation lifecycle (bind deliverable · edit · delete/cancel)

## Status

Accepted (2026-06-20). Extends ADR 0016 (deliverables + `work_packages.deliverable_id`),
ADR 0004 / 0015 (immutability + append-only/supersede), ADR 0056 (membership-scoped
visibility), ADR 0058 (`project_director`). Relates spec 145 (completed-project lock),
spec 144 (rework reopen).

## Context

A work package is **create-only** for its definitional fields. After
`create_work_package` (spec 142) there is no sanctioned path to:

- **re-bind / move** a WP to a งวดงาน (`deliverable_id` is set ONLY by the manual
  `seed-deliverables.sql` upsert; in-app-created projects have it `NULL` forever),
- **rename** a WP (`name` / `code` are immutable; `code` is the composite-unique
  business key `unique(project_id, code)`),
- **remove** a WP (no DELETE RLS policy → app-path delete is a silent no-op).

The operator wants all three. The hard constraint is the immutability doctrine:
a WP's children carry **captured site evidence that must survive** — `photo_logs`,
`approvals`, and `labor_logs` are append-only (REVOKE + RLS + `BEFORE DELETE`
trigger raising `P0001`). `photo_logs` + `approvals` CASCADE from a WP, so a
service-role hard-delete of a WP that has any of them would **abort** on those
triggers; `labor_logs.work_package_id` is a **bare column with no FK**, so a
delete would orphan it. Destructive delete is therefore both doctrinally wrong
and mechanically blocked.

The house pattern for WP mutations is **one SECURITY DEFINER RPC per field**
(`set_work_package_priority` / `_notes` / `_contractor` / `_schedule`), each with
a `current_user_role()` gate; the lifecycle-significant `reopen_work_package_for_defect`
additionally gates `can_see_wp()` (ADR 0056) and writes an `audit_log` row.

## Decision

1. **Bind deliverable post-create — allowed.** New `set_work_package_deliverable(
p_work_package_id, p_deliverable_id|null)`. `null` = ungroup. A non-null
   deliverable **must share the WP's `project_id`** (cross-project binding is
   rejected — the FK alone won't enforce it). The read/grouping path (deliverable
   lens) already consumes `deliverable_id`; no read change. Creating งวดงาน
   in-app (`create_deliverable`) is a **separate, deferred** capability — until it
   ships, binding is only useful on seeded projects (recorded dependency).

2. **Editable fields widen to include `name`.** New `set_work_package_name(
p_work_package_id, p_name)` (non-empty + length CHECK, mirrors
   `set_work_package_notes`). Renames propagate everywhere `name` is read live
   (no denormalized copies). **`code` stays immutable for now** — it is the
   business key shown across PR cards / reports / lists, and editing it needs
   uniqueness re-validation; deferred to its own unit pending operator sign-off.

3. **Delete = two tiers, never a destructive cascade.**
   - **Tier 1 — hard delete only when empty.** `delete_work_package(p_id)` refuses
     (raises `P0001`) if ANY child row exists (`photo_logs`, `labor_logs`,
     `approvals`, `purchase_requests`, `work_package_members`, schedule
     dependencies), else deletes the row. This covers the real case — a WP created
     by mistake, with no captured evidence — with zero risk: empty means the
     append-only-trigger / orphan conflict never fires.
   - **Tier 2 — cancel (reversible) when there IS history.** A WP with
     photos/labor/approvals is never destroyed; it gets a new
     `work_package_status` value `cancelled` (ยกเลิก) via `cancel_work_package` /
     `restore_work_package`. Cancelled WPs drop out of the active lenses and out
     of progress **denominators** (like the done band collapses), but the
     evidence persists. **Deferred to its own spec** — the enum value needs its
     own migration (ALTER TYPE ADD VALUE can't share a tx with its use, ADR 0008
     precedent / DB-migration lesson) and touches every status-exhaustive switch
     (`deriveActionBand`, `deriveDeliverableProgress`, status pills, labels).

4. **Gates.** Every new mutation RPC is manager-gated
   (`project_manager, super_admin, project_director` — `project_director` in
   every PM gate per ADR 0058) AND membership-gated via `can_see_wp()`
   (ADR 0056), matching the `reopen` precedent. `site_admin` is excluded
   (these are definitional/billing edits, not field capture).

5. **Closed projects.** Binding, name-edit, cancel, and empty-delete are all
   allowed on completed/archived projects — they are reclassification / cleanup,
   not _new work_. Spec 145's lock is a `BEFORE INSERT` trigger only; UPDATE/DELETE
   are intentionally untouched.

6. **Audit.** `delete_work_package` and `cancel`/`restore` write `audit_log` rows
   (lifecycle-significant, like `reopen`). `set_work_package_deliverable` and
   `set_work_package_name` are unaudited (benign metadata, matching
   `set_priority` / `set_notes`).

## Consequences

- **`labor_logs.work_package_id` FK debt.** It is a bare column (schema oversight).
  Tier-1's empty-check must query it regardless, and a `cancelled` WP must keep its
  labor rows readable. Add the missing FK (own migration) so integrity holds —
  recorded as an adjacent fix in the delete spec.
- The `cancelled` status (Tier 2) is a **wide but mechanical** touch of every
  status-exhaustive site (bands, progress, pills, labels) — its own spec.
- Per-field RPC proliferation continues (now 6+ `set_work_package_*`). Accepted —
  column-level gating is the point; a generic `update_work_package` would lose it.

## Alternatives rejected

- **Hard-delete always** (service-role + disable append-only triggers). Destroys
  captured site evidence; break-glass-only, never a routine feature.
- **Soft-delete boolean (`archived_at`) instead of a status value.** The app models
  WP lifecycle through the `work_package_status` enum; a status value flows through
  the existing lenses/progress for free and reads idiomatically. A parallel boolean
  is a second source of "is this WP live?".
- **One generic `update_work_package(name, code, priority, deliverable, …)` RPC.**
  Collapses the column-level gates the house pattern relies on (e.g. SA may set
  notes but not priority). Keep per-field RPCs.
- **Allow `code` rename now.** `code` is a cross-surface business key; renaming it
  is higher-risk and the operator hasn't asked. Deferred, not refused.
