# Spec 189 — Multiple supply plans per project

## Why

Spec 176 modeled **one** supply plan per project (a single evolving baseline,
enforced by `unique (project_id)` + a get-or-create RPC + a single-plan UI). The
operator wants a project to hold **several** plans (e.g. per phase or period).

## Decisions (operator)

- **Plan identity:** auto numbered/dated — no title field. Plans are labeled
  `แผน #N` by creation order, shown with their created date. (No `title` column.)
- **Scope:** built in one session — U1 (DB) + U2 (UI).

## Out of scope (downstream already plan-agnostic / per-plan)

- `supply_plan_accuracy(project)` already aggregates **all** of a project's plan
  lines per WP — unchanged by multi-plan.
- `generate_purchase_requests_from_plan(plan_id, line_ids)` is per-plan — unchanged.
- Per-plan accuracy, cross-plan dedup of planned items, plan delete/rename — later.

## U1 — DB (`20260811000100_spec189u1_multi_supply_plan.sql`, pgTAP 191)

- Drop `supply_plans_project_unique`.
- `create_supply_plan(project)` was get-or-create (idempotent); now **always
  inserts a new draft plan**. Planner-tier (PM/super/director) + `can_see_project`
  membership gates unchanged. `CREATE OR REPLACE` (same signature → grants kept).
- pgTAP 191: two calls → two distinct plans; both persist; site_admin → 42501
  (role); non-member PM → 42501 (membership); unknown project → 22023.
- pgTAP 176 idempotency assert updated to the new always-create contract.

## U2 — UI

- **`createPlan(projectId)`** server action → `create_supply_plan`, returns the
  new `planId`. **`addPlanLine` / `bulkAddPlanLines`** now take an explicit
  `planId` (no longer get-or-create) — lines target the chosen plan.
- **`NewPlanButton`** (`'use client'` — onClick + navigation): creates a plan,
  navigates to `?plan=<id>`.
- **`buildPlanList`** (pure, unit-tested): plans → list view models (auto-label
  `แผน #N`, status, line count, selected flag).
- **Planning page** lists all of a project's plans (date · line count · status)
  - the new-plan button; `?plan=<id>` opens that plan in the existing
    `SupplyPlanManager`. `PLAN_STATUS_LABEL` exported from the manager (single
    source for the status text).

## Verification

`pnpm lint` · `pnpm typecheck` · `pnpm test` (plan-list, new-button, manager) ·
`pnpm db:test` (191 + updated 176) all green; `db:push` applied; preview smoke of
create → list → select → add line.
