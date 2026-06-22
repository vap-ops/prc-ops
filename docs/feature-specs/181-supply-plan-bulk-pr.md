# Spec 181 — Supply Plan: procurement bulk workspace + plan → PR generation

Status: U1 + U2 SHIPPED to prod — 2026-06-23. U3–U4 in progress.
Builds on: spec 176 (Supply Plan — the PM-accuracy engine), spec 179/180 (PR
links a catalog item; the catalog picker), spec 171/172 (procurement acts in the
PM's stead, the cross-project procurement arm).

## Why / operator (2026-06-23)

"What's the status on the bulk PR (planned purchases)?" → the supply plan (spec 176) is the planned-purchases baseline, but there's no way to turn an approved
plan into actual purchase requests in bulk. The operator wants that, AND wants
procurement to drive it **in the PM's stead for the moment**, AND wants the
planning itself done by procurement for now — all in a **table (multi-item)**
workspace, not the one-item-at-a-time sheet.

The operator's canonical flow: **PM plans → procurement compares prices → PD
approves → procurement makes the purchase.** For the moment procurement also does
the planning (PM's stead). PD approval stays required.

## Decisions (operator AskUserQuestion, 2026-06-23)

- **Governance:** the plan must be **PD-approved** before procurement generates
  PRs (keeps the frozen baseline + accuracy honest). The generated PRs are **born
  `approved`** — they inherit the plan's PD approval (no per-PR re-approval), so
  they land ready for procurement's existing price-compare / PO flow.
- **Procurement in PM's stead:** procurement can create / add / remove / submit a
  plan (the PM role) AND generate the PRs (the purchase step). **Approve/reject
  stay PD/super** — procurement does not approve its own plan.
- **Entry:** an **inline editable grid** (add rows, pick item per cell via the
  spec-180 catalog picker, qty + WP inline, bulk-save). No paste-import in v1.
- **Accuracy correctness (design catch):** a plan-generated PR is _planned_, not
  _reactive_. Each generated PR links back to its plan line and is **excluded**
  from the `unplanned_miss` accuracy measure (spec 176 U5) — else generating PRs
  from the plan would read as planning failures and corrupt the metric.

## Unit arc

- **U1 — procurement access (this unit):** procurement reads supply plans
  cross-project (RLS arm, no membership gate) + drives create / add / remove /
  submit (RPC role-list += procurement, membership skipped for it, mirroring
  spec 171/172); the `/projects/[id]/supply-plan` page admits procurement. The
  accuracy card stays planner-only. Approve/reject unchanged (PD/super).
- **U2 — bulk-add + the inline grid editor:** `add_supply_plan_lines` bulk RPC +
  the table editor UI (add rows, pick item/qty/WP, bulk-save) replacing the
  one-at-a-time sheet for the edit mode.
- **U3 — plan → PR generation engine:** `purchase_requests.supply_plan_line_id`
  (nullable FK, unique = idempotent) + `generate_purchase_requests_from_plan`
  (gate PM/super/director/procurement; plan must be `approved`; born-`approved`
  PRs inheriting the plan approver; skip already-linked lines; returns count) +
  amend `supply_plan_accuracy` to exclude plan-linked PRs.
- **U4 — convert mode UI:** the table's สร้างคำขอซื้อ mode — checkboxes,
  select-all, per-row converted badge, bulk action → the generate RPC.

## U1 — procurement access

- New role set `SUPPLY_PLAN_ROLES = [...PM_ROLES, "procurement"]` (members
  coincide with WORKER_ROSTER_ROLES today; meaning differs — "who plans supply",
  keep separate per the role-doctrine).
- Migration (RLS + RPC widening, no signature change → `alter policy` +
  `CREATE OR REPLACE`, bodies sourced from LIVE = the spec-176 U3 versions):
  - `supply_plans` / `supply_plan_lines` SELECT policies gain a
    `current_user_role() = 'procurement'` arm beside `can_see_project` (procurement
    is cross-project, so its arm carries no membership gate — spec 171/173 pattern).
  - `create_supply_plan` / `add_supply_plan_line` / `remove_supply_plan_line` /
    `submit_supply_plan`: role list += `procurement`; the membership check is
    skipped for procurement (`role <> 'procurement' AND NOT can_see_project`).
  - `approve_supply_plan` / `reject_supply_plan` **unchanged** (PD/super only).
- Page: `requireRole(SUPPLY_PLAN_ROLES)`; the SupplyPlanAccuracy card is rendered
  only for the planner tier (not procurement — `supply_plan_accuracy` stays
  PM-gated, and accuracy is the PM's measure). `canApprove` stays PD/super, so
  procurement sees add/submit but no approve.

### Verification (U1)

- `role-sets.test.ts`: `SUPPLY_PLAN_ROLES` = PM tier + procurement; excludes
  site_admin / visitor; includes project_director.
- pgTAP `189`: a cross-project procurement (non-member) can `create_supply_plan`
  - `add_supply_plan_line` + `submit_supply_plan` + `remove_supply_plan_line` and
    READ the plan; **cannot** `approve_supply_plan` (42501); a non-member PM is
    still denied (the procurement arm didn't widen PM).
- `pnpm lint && typecheck && test`, then `db:push && db:test`, then `build`.

## Out of scope (later units / follow-ups)

- Paste-from-spreadsheet import (U2 is grid-only).
- Plan versioning / amendments after approval.
- Per-PM attribution of the accuracy measure (spec 176 left this a follow-up).
- Letting procurement approve its own plan (governance: PD approves).
