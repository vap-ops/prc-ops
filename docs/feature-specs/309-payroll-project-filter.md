# Spec 309 — payroll per-project filter + procurement ค่าแรง nav

Status: in progress (2026-07-12). Builds on **spec 69** (dc-payroll-export) and
**spec 187** (procurement payroll parity). Owner: operator-requested 2026-07-12.

## Problem

Procurement is in charge of **summarising wages per person**, and works
project-by-project ("see all technicians under each project"). Today:

- `/payroll` (ค่าแรง) already rolls up wages **per worker**, but pools **every
  project** into one date window — there is no way to scope it to one project.
- The page is reachable by procurement (spec 187 parity) but **buried** — only
  via ตั้งค่า → ทีมช่าง → ค่าแรง; it is not in procurement's nav strip.

This was raised as "is it worth a **new menu**?" Answer: **no** — the per-person
roll-up already exists and procurement already has access. The genuine gaps are
(a) a **project axis** on the existing roll-up, and (b) **discoverability**.
Neither warrants a new top-level destination.

## Decision

Single code-only unit (no schema, no `labels.ts`):

1. **Project filter on `/payroll`.** Add a zero-client-JS `<select name="project">`
   to the existing period GET form. Empty value = all projects (today's
   behaviour). When a project is chosen, the per-worker roll-up is scoped to
   labour logged on that project's work packages, for the selected date range.
   The CSV export (`/payroll/export`) honours the same `project` param so the
   download matches the screen.

2. **Surface ค่าแรง for procurement.** Add a `ค่าแรง → /payroll` entry to
   `PROCUREMENT_HUB_NAV` and `PROCUREMENT_MANAGER_HUB_NAV` (desktop strip),
   placed after ทีมงาน (roster + wages read together). Inline Thai, matching the
   other entries — no `labels.ts` change.

## How the filter works (correctness)

`aggregatePayroll` already fetches **all** pay types across the window and filters
to daily-pay **after** the current-state anti-join, because a supersede
correction re-snapshots fields and a DB-level filter could drop a superseding row
and miscount the stale one (spec 69 comment). A project filter has the **same
hazard** — a labour log can be superseded onto a different work package (hence a
different project). So the project scope is applied the **same way**: after the
current-state + daily pass, in JS, never as a DB-level `WHERE`.

- `fetchPayrollReport(admin, range, projectId?)` — still fetches the whole
  window (so the supersede anti-join is complete), now also selecting
  `work_package_id`. When `projectId` is given it reads that project's work-package
  ids once and passes them to the aggregator.
- `aggregatePayroll(rows, opts?: { workPackageIds?: ReadonlySet<string> })` —
  after current-state + daily filtering, keeps only rows whose `work_package_id`
  is in the set. `PayrollInputRow` gains `work_package_id`.
- Projects list for the dropdown: server (RLS) client
  `.from("projects").select("id, code, name").order("code")` — the same source
  and visibility as the `/workers` assigner (procurement sees all).

## Out of scope

- No mobile bottom-tab change — spec 70 keeps procurement's bar lean; ตั้งค่า
  already lights on `/payroll`.
- No new KPI tile, no new RPC, no schema.
- No per-project **incentive/variance** view (that is spec 271's lane).

## Verification

- Unit: `aggregatePayroll` scopes to the WP set (incl. a supersede-moved-WP case
  proving the post-anti-join ordering); `project` param parsing (empty/unknown →
  all).
- `pnpm lint && pnpm typecheck && pnpm test` green.
- Browser (dev-preview as procurement): open `/payroll`, pick a project → list +
  totals + CSV scope to that project; clear → all projects.

## Data reality

Works today for projects with real daily-ช่าง labour logs. Newly SA-onboarded
crew rosters are still empty (awaiting real crew), so those projects render the
existing "ไม่มีบันทึกค่าแรงในช่วงนี้" empty state until labour is logged.
