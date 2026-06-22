# Spec 176 — Supply Plan (the PM-accuracy engine)

## Why

The operator's purpose for the on-site store (see `docs/inventory-store/README.md`, spec 175):
measure **PM planning accuracy**. A PM bulk-plans the materials a project needs — quantities of
catalog items, allocated per work package — up front. That plan becomes a **frozen baseline**.
Later, what was actually ordered / issued / bought-reactively is compared against it: did the PM
plan the right items in the right quantities for the right WPs? "If the PM plans perfectly, the
site admin never has to scramble-order." This spec builds that planning + measurement engine.

It sits on the **item catalog** (spec 175) — plan lines reference catalog items, so plan → order
→ issue → consumption can be matched (the whole reason the catalog exists).

## The arc (multi-unit)

- **U1 — data foundation** (this unit): `supply_plans` + `supply_plan_lines` tables + the
  `create_supply_plan` / `add_supply_plan_line` RPCs.
- **U2 — planning UI**: PM opens a project's plan, adds lines (catalog item picker + WP + qty),
  edits/removes draft lines.
- **U3 — submit + PD approve/reject**: freezes the plan (the immutable baseline).
- **U4 — reactive-PR reason codes**: tag each reactive purchase (`unplanned-miss` dings the PM;
  rework / breakage / scope-change / unforeseeable don't).
- **U5 — measurement**: planned vs issued vs reactive, per project / per WP / per PM.

## U1 — data foundation

### Data model

- New enum `supply_plan_status` — `draft` → `submitted` → `approved` / `rejected`.
- `supply_plans`: `id`, `project_id` (FK projects, **unique — one plan per project**), `status`
  (default `draft`), `note`, `created_by` (`default auth.uid()`), `created_at`, `submitted_at`,
  `approved_by`, `approved_at`.
- `supply_plan_lines`: `id`, `supply_plan_id` (FK, cascade), `catalog_item_id` (FK catalog_items),
  `work_package_id` (FK work_packages, **nullable = site-general**), `qty numeric(12,2)` (CHECK > 0),
  `note`, `created_at`. **Unique** `(supply_plan_id, catalog_item_id, coalesce(work_package_id, <sentinel>))`
  — one allocation per item per WP (null WP collapses to a sentinel so a site-general line is unique).
- **RLS**: both tables READ via `can_see_project` (ADR 0056 — super/director/coordinator see all;
  PM/SA by membership). **No write policy** — the SECURITY DEFINER RPCs are the sole write path
  (the catalog / deliverables posture).

### RPCs (planner tier = PM / super_admin / project_director)

- `create_supply_plan(project_id) returns uuid` — **get-or-create** a project's plan (returns the
  existing one if present). Role gate + `can_see_project` membership + project-exists (`22023`).
- `add_supply_plan_line(plan_id, catalog_item_id, work_package_id, qty, note) returns uuid` — adds
  a line to a **draft** plan (a submitted/approved plan is frozen → `22023`). Validates: qty > 0,
  catalog item exists + `is_active`, the WP (if given) belongs to the plan's project; duplicate
  `(item, WP)` → `23505`. All `22023`/`42501` mapped for the UI later.

### Tests

pgTAP `176-supply-plan` (19): tables + RLS, RPCs exist + anon-deny; create is idempotent; add
returns id; qty≤0 / WP-other-project / inactive-item / duplicate / frozen-plan all rejected;
non-member PM + visitor denied; super on unknown project → 22023.

## Open decisions (flagged for the operator before U2/U3 lock them)

1. **One plan per project** (no versioning/amendments yet) — is a single living plan right, or do
   you want versioned plans (re-plan mid-project)? Affects how "frozen baseline" is preserved.
2. **No price/ETA in the plan** — the plan is PM _intent_ (item + qty + WP). Buy-price / ETA /
   compared quotations live in the procurement-execution flow (later), not the plan. OK?
3. **Reason-code taxonomy** for reactive PRs (U4): proposed `unplanned-miss` / `rework` /
   `breakage` / `scope-change` / `unforeseeable` — only `unplanned-miss` counts against the PM.
   Confirm the list.

## Verification

`pnpm lint && pnpm typecheck`; `pnpm db:test` (file 176 green, suite green); `pnpm build`.
DB-only foundation — no app surface this unit (verified by pgTAP).
