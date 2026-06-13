# Spec 69 — DC payroll export (subcontractor days, per period)

Status: **COMPLETE**
Depends on: spec 46 (labor capture), spec 68 (money posture / cost aggregation)
Migration: **none** — pure read + aggregation. No `db:push`, no prod gate.

## Context

Spec 68 froze per-WP labor **cost** at close (an accounting lens, scoped to one
WP). It does not answer the operator's actual cash question:

> "It's the end of the period — how many days did each subcontractor (DC) crew
> work across all my jobs, and what do I owe them?"

You pay a **direct-contractor (DC)** crew per day worked, pooled **across work
packages**, for a **calendar period** — independent of whether any WP is closed
or frozen. spec 68's `wp_labor_costs` snapshot is the wrong basis (per-WP,
close-gated). Payroll reads the live `labor_logs` current state, windowed by
work date, rolled up by **contractor → worker**.

Own crew are out of scope: they are salaried (paid by month, not per logged
day), so per-day payout from this report would be wrong. **DC only** in v1.

## Decision

A **PM-only** cross-WP period payroll surface plus a CSV export:

- Read `labor_logs` for a date window via the **admin client** (the
  `day_rate_snapshot` money column has zero authenticated grant — spec 68).
  Gate the page and the export route on `requireRole(PM_ROLES)`. No money
  column or derived amount ever reaches a `site_admin`-reachable surface or a
  client bundle (Server Component renders text; the CSV is built server-side).
- Aggregate in pure, unit-tested code: current-state filter (ADR 0009 supersede
  anti-join + ADR 0015 tombstone), keep `worker_type_snapshot = 'dc'`, group by
  `contractor_id_snapshot` then `worker_id`, sum days (Σ fraction) and amount
  (Σ fraction × **per-row** rate snapshot — honours mid-period rate changes,
  same rule as spec 68 `cost.ts`).
- **No new DB object, no audit row.** The existing reports/export path
  (`run-report-job.ts`) writes no audit row when it produces a download, and
  the source `labor_logs` are each already audited at insert — so the export is
  a derived read and stays write-free. (Auditing each export — reuse
  `action='export'` — is a recorded seam, not v1.)

## Data (no schema change)

Read columns (admin client): `id, worker_id, worker_name_snapshot,
worker_type_snapshot, day_fraction, day_rate_snapshot, contractor_id_snapshot,
superseded_by, work_date`. Contractor display names come from `contractors`
(`id, name`) — **current** name (not snapshotted; names rarely change —
snapshotting a contractor name is a recorded seam).

**Fetch all worker types in the window**, run the current-state filter, _then_
keep DC in pure code — not a DB `eq('dc')`. Reason: a supersede correction
re-snapshots `worker_type_snapshot`; an own→dc (or dc→own) type flip would let a
DB-level type filter drop the superseding row and miscount the stale one. JS
filtering after the anti-join is correct; the window volume (one period) is
small.

**Same-date supersede assumption:** windowing by `work_date` is sound because
corrections (fraction fix) and tombstones (delete) preserve the row's
`work_date`. A correction that _moves_ a day to a different date is out of scope
(recorded seam).

## Pure lib — `src/lib/labor/payroll.ts` (TDD target)

- `PayrollInputRow` = `Pick<labor_logs.Row, id | worker_id |
worker_name_snapshot | worker_type_snapshot | day_fraction |
day_rate_snapshot | contractor_id_snapshot | superseded_by | work_date>`.
- `aggregatePayroll(rows, contractorNames: ReadonlyMap<string,string>):
PayrollReport`
  - current-state filter (inline, ADR 0009/0015 — same trivial filter as
    `current-logs.ts` / `cost.ts`; replicated, not cross-imported, to keep
    modules decoupled);
  - keep `worker_type_snapshot === 'dc'`;
  - group by contractor (null → an `unassigned` sentinel group, sorted last),
    then by `worker_id`: `days += fraction`, `amount += fraction × rate`;
  - `PayrollReport = { contractors: ContractorGroup[], totalDays, totalAmount,
workerCount }`; `ContractorGroup = { contractorId: string | null,
contractorName, workers: WorkerPay[], days, amount }`; `WorkerPay =
{ workerId, name, days, amount }`;
  - contractors sorted by name (th), `unassigned` last; workers by name (th).
- `payrollToCsv(report, range): string` — UTF-8 **BOM** (`﻿`, Excel-Thai),
  RFC-4180 quoting (wrap on `" , \n \r`, double internal quotes), one header
  row `ผู้รับเหมา,ช่าง,จำนวนวัน,ค่าแรง (บาท)`, one row per worker (raw numeric
  days / amount — no separators, no ฿, amount 2-dp), a trailing
  `รวม` grand-total row.
- `buildPayrollFileName(range): string` → `payroll-dc-YYYYMMDD-YYYYMMDD.csv`
  (ASCII-safe).
- `monthRangeOf(todayIso): { from, to }` — first/last calendar day of the
  Bangkok month containing `todayIso` (pure; deterministic `Date.UTC`, no
  `now()`). Default period.
- `parsePayrollRange(from?, to?, todayIso): { from, to }` — accept `YYYY-MM-DD`
  params, fall back to `monthRangeOf(todayIso)` on missing/malformed (a bad
  query string never crashes the page).

## Surfaces

- **`/pm/payroll`** (Server Component, `requireRole(PM_ROLES)`):
  - period form: two `min-h-11` date inputs (`from`/`to`) + submit, `method=get`
    — zero-client-JS, same searchParams pattern as `/requests`. Default =
    current Bangkok month.
  - grouped table: per contractor → workers (days, amount บาท), contractor
    subtotal, grand total. Empty period → `EmptyNotice`.
  - **download**: a plain `<a download>` (NOT `next/link` — avoid prefetch
    firing the route) to `/pm/payroll/export?from=…&to=…`, label
    `ดาวน์โหลด CSV`.
- **`/pm/payroll/export`** route handler (`requireRole(PM_ROLES)` first):
  builds the same report, returns `text/csv; charset=utf-8` with
  `Content-Disposition: attachment; filename="…"`.
- **PM hub nav**: add `{ label: "ค่าจ้าง", href: "/pm/payroll" }` to
  `PM_HUB_NAV` (4th item). PM surfaces are already PM/super-gated, so money
  discoverability here leaks nothing to SA.
- `loading.tsx` for the new route (PM-page parity).

WP-centric note: spec 68's per-WP cost view stays the WP-identity money surface;
payroll is the orthogonal **period × contractor** lens. It rolls up _by worker_,
never truncating WP identity on a WP surface.

## Tests (TDD — failing first)

Unit (`tests/unit/labor-payroll.test.ts`):

- `aggregatePayroll`: own excluded; superseded + tombstone excluded; group by
  contractor; worker multi-day rolled into one line (days + amount summed);
  per-row rate honoured (blended amount on mid-period change); null contractor
  → `unassigned`, sorted last; totals across groups; empty → zeros.
- `payrollToCsv`: BOM present; header row exact; a name containing `,`/`"` is
  quoted/escaped; amount 2-dp, days raw; trailing total row matches
  `totalAmount`.
- `buildPayrollFileName`, `monthRangeOf` (month-length + leap + Bangkok), and
  `parsePayrollRange` (valid passthrough, malformed → default) boundaries.

No pgTAP: no new DB object, RLS, or grant. The money posture is already pinned —
existing pgTAP proves authenticated cannot read `day_rate_snapshot`; the new
reads go through the admin client behind `requireRole(PM_ROLES)`, the same
trusted gate spec 68's PM cost view uses.

## Verification

`pnpm lint && pnpm typecheck && pnpm test && pnpm build` green. No `db:push`
(no migration). Commit + push to `main` (non-risky, additive). Operator phone
pass: open `/pm/payroll`, confirm DC-only rollup by contractor for the month,
change the period, download the CSV and open it in Excel (Thai renders, numbers
parse), confirm the SA screens still show no money.

## Recorded seams (not in this unit)

- Audit each export (reuse `action='export'`) — money-trail of who pulled which
  period.
- Own-crew payroll (different pay model — salaried/monthly).
- Snapshot the contractor name on the labor row (today uses current name).
- Date-moving corrections across the period boundary.
- A "mark this period paid" / reconciliation state.
