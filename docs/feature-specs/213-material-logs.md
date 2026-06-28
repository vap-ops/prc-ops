# 213 — Material logs (ประวัติวัสดุ)

Status: IN PROGRESS — design confirmed with the operator 2026-06-28.
Relates: spec 177 (store: รับเข้า/เบิก/ตรวจนับ/reversal), spec 178 (store P&L + sell
price), spec 209 (store returns), spec 197 (per-project store console), spec 63
(DetailHeader), spec 100 (money gating). Doctrine: self-governance, WP-centric,
Field-First.

## Why

Feedback `15151fb3` (project_director, on the คลัง screen):

> "อยากให้ทำ Dashboard ของวัสดุนั้นๆ แสดงประวัติและสถานะของ (คล้ายๆ ของการสั่งของแต่ละ
> รายการว่าสถานะเป็นยังไง)"

The PD wants, per material, its **history and current status** — "like order
tracking." Today the store console (`/projects/[projectId]/store`) shows the data
**by movement type, store-wide**: the 10 most-recent รับเข้า, the 10 most-recent
ตรวจนับ, and a flat on-hand list — but there is **no way to ask "what happened to
_this_ material?"** A single item's life is scattered across five append-only
tables (`stock_receipts`, `stock_issues`, `stock_counts`, `stock_returns`,
`stock_reversals`) and the derived `stock_on_hand`, never assembled in one place.

Operator clarification (2026-06-28): **"There is no need to be a dashboard, it can
be item-specific logs."** So this is NOT a KPI dashboard — it is a clean,
chronological **activity log** for one material, with its current status at the top.

## Scope (what this is / is not)

- **Is:** a read-only, per-(project, item) chronological log of every stock
  movement, reached by tapping a material on the store on-hand list. Current
  on-hand status (qty + moving-avg cost + value) sits at the top.
- **Is not:** charts, KPIs, trends, or a "dashboard." No new movement actions —
  recording/undo stay where they are (store console + WP detail). No schema change.

## Money rule (mirror the store console exactly)

The store console already shows **cost** (`stock_on_hand.total_value`,
`stock_receipts.unit_cost`) to every store-page viewer (`WP_DETAIL_ROLES`,
RLS-scoped to project members). The money **gate** (`canSeePnl` =
super_admin/project_director) covers only **sell price / margin / P&L aggregates**
(`store_pnl`). This log follows the same line:

- **Cost** (unit cost, line cost, on-hand value, count variance value) — shown to
  all store-page viewers, exactly as the console already does.
- **Sell price / margin** (`stock_issues.sell_price` / `total_sell`) — NOT shown
  in the log (that is P&L-tier). The log is cost-side only.

## Data (no migration — code-only assembly)

Every source already keys on `(project_id, catalog_item_id)` and carries a
timestamp + an actor. RLS on all six tables is `can_see_project(project_id) OR
role='procurement'`, so reads are naturally scoped to project members. We assemble
the log from **six RLS-scoped reads in the server component** (no new RPC, no
migration — mirrors how the store console already reads each table separately):

| Source            | kind                               | when          | qty Δ (on-hand)                    | cost shown                | extra             |
| ----------------- | ---------------------------------- | ------------- | ---------------------------------- | ------------------------- | ----------------- |
| `stock_receipts`  | `receipt` (รับเข้า)                | `received_at` | `+qty`                             | `unit_cost`, `total_cost` | supplier?         |
| `stock_issues`    | `issue` (เบิก)                     | `issued_at`   | `−qty`                             | `unit_cost`, `total_cost` | WP, receiver      |
| `stock_counts`    | `count` (ตรวจนับ)                  | `counted_at`  | `+variance` (= counted − system)   | `variance_value`          | counted vs system |
| `stock_returns`   | `return` (คืนเข้าคลัง)             | `returned_at` | `+qty`                             | `total_cost`              | WP, source issue  |
| `stock_reversals` | `reversal` (แก้รายการที่บันทึกผิด) | `reversed_at` | `−qty` if `receipt_id` else `+qty` | `value_delta`             | which movement    |
| `stock_on_hand`   | (status header, not a log row)     | `updated_at`  | —                                  | `total_value`, avg cost   | current qty       |

Running balance: cumulative sum of the signed deltas in **ascending** time lands
on the current `stock_on_hand.qty_on_hand` (each count's variance reconciles the
running total to the counted truth at that instant). The authoritative current
on-hand is still read straight from `stock_on_hand` and shown in the header; the
per-row balance is a convenience and an assembly invariant to test.

## Units

### U1 — assembly lib (`src/lib/store/material-log.ts`) + types

A pure function `buildMaterialLog(sources)` that takes the five mapped movement
arrays and returns a `MaterialLogEntry[]` sorted **descending** by timestamp, each
with: `kind` (discriminated), `at`, `qtyDelta` (signed), `cost` (cost-side only,
nullable), `actorId`, optional `workPackage` (code/name) for issue/return, optional
`note`, and `balanceAfter` (from the ascending cumulative sum). Stable tie-break on
equal timestamps by `created_at` then id. Pure, fully unit-tested (TDD): ordering,
signed deltas per kind (incl. count = variance, reversal sign by FK), running
balance ending at on-hand, empty input.

### U2 — route + page + log view

Route `/projects/[projectId]/store/items/[catalogItemId]/page.tsx`
(`requireRole(WP_DETAIL_ROLES)`; RLS 404s a non-member or unknown item). Six
RLS-scoped reads → `buildMaterialLog` → render:

- `DetailHeader` (back to the store console via `?from`/store href; nameplate =
  `base_item` + `spec_attrs`, meta = category + unit),
- a **status card**: current on-hand qty + unit, moving-avg cost, total value,
- `MaterialLogView` — the chronological list: per entry an icon + Thai kind label
  - signed qty + unit + cost + actor + date (+ WP chip for issue/return + note +
    running balance). Empty state when the item has no movements.
    All Thai terms reuse the `labels.ts` SSOT (`STORE_*`, `STORE_FIX_WRONG_ENTRY_LABEL`,
    etc.); add only a new `MATERIAL_LOG_LABEL` = "ประวัติวัสดุ".

### U3 — navigation (drill-in)

Make the store console on-hand row a link to its item log
(`/projects/[projectId]/store/items/[catalogItemId]?from=<store>`). Keep the
existing per-row "ตรวจนับ" action working (the row becomes a link wrapping the
identity, with the action button beside it, not nested in the anchor).

## Verification

- `pnpm lint && pnpm typecheck && pnpm test` green each unit.
- U1: assembly unit tests (ordering, deltas, balance invariant, empty).
- U2/U3: component render tests (log entries shown, cost shown, sell/margin NOT
  shown; row links to the item log).
- Manual: a project_director opens คลัง → taps a material → sees its full log with
  current status; a site_admin sees the same cost-side log (no margin); a non-member
  404s.

## Open questions

- Pagination/virtualization if an item has hundreds of movements — deferred; v1
  reads all and renders a simple list (store items are low-cardinality per project).
- Filter-by-kind chips — deferred; the plain chronological log answers the request.
