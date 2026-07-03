# Spec 262 — Procurement purchase reports (รายงานยอดสั่งซื้อ)

**Status:** DRAFT (2026-07-04) — **HARD dependencies: spec 260** (PO-level
charges; totals are wrong without them) **and spec 261** (the RPC gate below
names the `procurement_manager` enum literal in-database — an RPC referencing
a non-existent enum value raises `invalid input value for enum user_role` at
execution, so 261's ADD VALUE must be committed first). Build order:
**260 → 261 → 262**.
**Origin:** Procurement team (translated): no report system exists for
purchasing — they hand-collate from multiple screens. Asked for: totals by
day/month/year, sliced by project / vendor / product category / purchaser;
budget vs actual; trends; audit-friendly lookback; management decision
support.

**Ground truth this spec is built on** (verified 2026-07-04): the app already
has a real purchase register at `/accounting/purchases` (spec 196/211 —
period window, gross/VAT/net totals, per-PO subtotals, project filter,
voucher drill) but it is gated `accounting | super_admin` and has no export.
There is **no time-bucketing anywhere in the app, no charting library, no
xlsx code**; the only CSV export is payroll's — whose route gate famously
rejects roles its button renders for (separately-flagged bug; this spec must
not repeat it: **page gate and export-route gate are the same constant**).
Procurement's KPI tiles today are screen-only TS sums over `/requests` reads.

## Units

### U1 — data layer: `purchase_report` RPC (+ pgTAP)

One SECURITY DEFINER RPC, one shape, buckets × groups:

```
purchase_report(p_from date, p_to date,
                p_bucket text,      -- 'day' | 'month' | 'year'
                p_group_by text,    -- 'project' | 'supplier' | 'category' | 'purchaser' | 'none'
                p_project_id uuid default null)
  returns table (bucket date, group_key text, group_label text,
                 line_gross numeric, charge_gross numeric, gross numeric,
                 net numeric, vat numeric, pr_count int)
```

- **Population:** `purchase_requests` with `status in ('purchased',
  'on_route','delivered','site_purchased')` — the same "committed spend"
  status set the dashboard uses — bucketed by **`purchased_at`** (ยอดสั่งซื้อ
  = when the order was placed; a delivered-basis view is v2 if asked).
- **Money:** per ADR 0045 `amount` is gross; net/VAT derived via `vat_rate`
  (`amount / (1 + vat_rate/100)` — same arithmetic as `item_price_history`).
  Satang-safe summing (`round2` at the line, sum the rounded — match
  `summarizePurchases`' discipline).
- **Charges (spec 260):** PO-level charges join in **allocated
  proportionally over the PO's member lines by line net amount** (transport/
  other add, discount subtracts) so every slice — including by-project on a
  mixed-project PO — sums exactly to the true total. Exact-sum rounding:
  remainder to the largest share. `charge_gross` is reported as its own
  column so the UI can show "รวมค่าขนส่ง/ส่วนลดแล้ว" transparency.
- **Dimensions:**
  - `project` → `purchase_requests.project_id` (NOT NULL, safe);
  - `supplier` → `supplier_id` (label from `suppliers.name`; the rare null =
    "ไม่ระบุผู้ขาย" bucket);
  - `category` → `catalog_item_id → catalog_items.category_id →
    catalog_categories` top-level; free-text lines (null `catalog_item_id`)
    fall into "ไม่ระบุหมวด" — shown, never dropped (data-quality signal the
    manager should see);
  - `purchaser` → `requested_by → users.full_name`; **nullable** — the
    `pr_native_has_requester` CHECK only forces it for `source='app'` rows,
    so AppSheet-era rows can be null → "ไม่ระบุผู้สั่งซื้อ" bucket, shown
    never dropped (mirrors the null-category/null-supplier handling);
  - `none` → single series (the trend view).
- **Gate:** `procurement | procurement_manager | project_manager |
  project_director | super_admin | accounting` — one shared constant
  mirrored TS-side (see U2 gate note). By-purchaser (`p_group_by =
  'purchaser'`) additionally requires manager tier ∪ `procurement_manager`
  (staff-performance data; RAISE for plain procurement) — enforced in the
  RPC, not just the UI.
- pgTAP: gate matrix incl. the purchaser-slice narrowing; bucket edges
  (month boundary, year boundary, `p_to` inclusive like the register);
  charge allocation exactness on a mixed WP+store, mixed-project PO with a
  discount; VAT split agreement with `item_price_history` arithmetic;
  cancelled/rejected/requested/approved rows excluded.

### U2 — report UI + CSV export

Route **`/requests/reports`** (procurement's own wing; accounting reaches it
too — do NOT fork a second implementation under `/accounting`):

- Period picker: presets วันนี้ / เดือนนี้ / ปีนี้ / custom from–to;
  bucket switch วัน / เดือน / ปี; group-by switch โครงการ / ผู้ขาย /
  หมวดวัสดุ / ผู้สั่งซื้อ (ผู้สั่งซื้อ visible to the manager gate only);
  project filter.
- Totals strip: gross / net / VAT / charges component — reuse the
  `summarizePurchases` presentation language from `/accounting/purchases`
  so the two surfaces can never disagree in style or rounding.
- Trend: **hand-rolled bar chart** (Tailwind div bars — the established
  dashboard pattern, `SpendBar` family). NO new charting dependency;
  declined deliberately (consistency + bundle).
- Table: one row per bucket×group with drill — a row links to the existing
  register-style list filtered to that slice (reuse
  `load-purchases.ts`/`purchases-view.ts` helpers; extract, don't copy).
- **CSV export**: `/requests/reports/export` route handler streaming the
  current filter's rows (Thai headers per `labels.ts`). **The route imports
  the exact same gate constant as the page** — the payroll page/route gate
  drift is the named anti-pattern here. UTF-8 BOM so Thai opens clean in
  Excel. xlsx declined for v1 (zero xlsx code in app; CSV covers the "ผู้บริหาร
  นำข้อมูลไปใช้" ask).
- Budget-vs-actual (the team asked; scoped honestly): a per-project strip —
  `projects.budget_amount_thb` vs **this report's own committed-spend basis**
  (Σ PR amount + allocated charges, U1's number) — **project grain only**.
  Deliberately NOT the dashboard's budget-bar basis: the dashboard's
  `breakdown.total` is a total-project-cost figure (labor + materials
  excluding store-bound PRs + store issues at cost − returns), a structurally
  different number. Mixing the two on one page would show two irreconcilable
  "actuals"; this page uses one basis throughout and labels the strip
  ยอดสั่งซื้อสะสมเทียบงบ (committed purchases vs budget), with a caption
  noting it excludes labor (ไม่รวมค่าแรง) so nobody reads it as total project
  cost. Per-category and time-phased budgets do NOT exist in the schema
  (verified; BOQ has no project FK, supply plans are qty-only, S10 estimate
  epic is PARKED by the operator) — v1 shows what is real instead of
  inventing a budget editor. Recorded as the v2 seam.

### U3 — PO list page (`/requests/orders`)

Verified gap: PO detail exists, **no PO list**. The team's "ตรวจสอบย้อนหลัง"
(audit lookback) ask lands here: filterable list (supplier, project, period,
derived status via `derivePurchaseOrderStatus`), columns po_number /
supplier / line count / grand total (incl. charges, spec 260's
`purchaseOrderTotal`) / status / aging (days since `ordered_at` for
undelivered). Links from the report drill and from PO detail's back nav.

### U4 — procurement home tiles

`/requests` worklist header gains: เดือนนี้สั่งซื้อ (this-month committed,
vs last month ±%), PO ค้างส่ง (undelivered POs, worst aging), ค้างรับเข้า
(delivered-not-yet-received store arrivals). Tiles link into
`/requests/reports` / `/requests/orders` pre-filtered. Reuses U1's RPC with
`p_bucket='month', p_group_by='none'` — no separate aggregation path.

## Out of scope

- xlsx export; charting library; scheduled/emailed reports; PDF.
- Delivered-basis (accrual-style) reporting toggle — v2 if asked.
- Per-category / time-phased budgets, budget editing UI — no schema; v2
  seam, coordinate with parked S10 before any build.
- Supplier scorecards (lead-time reliability etc.) — own spec if asked.
- Touching `/accounting/purchases` beyond extracting shared helpers.

## Verification checklist

- U1 pgTAP suite above; U2/U3/U4 Vitest: bucket labels (Thai month names),
  CSV shape + BOM + gate-constant identity test (page gate === route gate —
  a literal unit test importing both), purchaser-slice hidden for plain
  procurement; totals equal register totals for the same window (fixture
  parity test).
- `pnpm lint && pnpm typecheck && pnpm test`; real-browser walk per role:
  procurement (no purchaser slice), procurement_manager (all), accounting
  (reaches route), site_admin (404/redirect).
