# Spec 195 — project-level purchasing (supply plan → store → เบิก)

**Status:** COMPLETE — all four phases shipped 2026-06-24 (ADR 0063).
P1 PR WP-optional + RLS (mig …300, pgTAP 211) · P2 plan→WP-less PRs (mig …400,
pgTAP 191) · P3 receive-into-store (mig …500, pgTAP 212) · P4 cost-integrity
verification (pgTAP 213).

**P4 finding (cost lands once, no double-count):** the store-bound buy → receive
→ เบิก cycle books material exactly once. A WP-less purchase posts NO GL
(`post_purchase_to_gl` no-ops; the enqueue triggers skip it); the **receipt** is
the single AP event (`Dr Inventory 1500 / Cr AP`, P3); เบิก then moves it
`Dr WIP 1400 / Cr 1500` and folds into `wp_profit` materials at the sell price
(`stock_issues`-sourced, disjoint from the `purchase_requests`-sourced 1400 term —
no double). `gl_reconciliation` (1500 ↔ Σ on-hand) holds. The dashboard's
materials-by-project is purchase-amount-based and excludes WP-less PRs (query +
guard), so store-bound material is not double-counted there either.

**Follow-up RESOLVED 2026-06-24 (dashboard store-material, no DB):** the manager
dashboard's materials-by-project now adds the project's non-reversed `stock_issues`
(เบิก) at **cost** (`total_cost`) alongside the direct WP-bound purchase amounts.
Disjoint sources — store-bound material comes from WP-less PRs, which `sumMaterials`
excludes — so additive with no double-count. Valued at cost (not the sell layer
`wp_profit` folds in) to keep the budget-vs-spend view on the money-out basis the
dashboard already uses for labor (cost) and purchases (supplier amount); the store's
internal transfer margin is not external spend. New pure helper `sumStoreIssues`
(`src/lib/dashboard/spend.ts`) + a 4th/5th admin read (`stock_issues` /
`stock_reversals`) in `src/app/dashboard/page.tsx`. A project that procures heavily
into the store no longer shows artificially low dashboard materials.

## The decision (operator, 2026-06-24)

> "all items in supply plan will go to store first, then withdraw by WP" …
> "Full plan, purchasing will no longer be WP-centric (selectable, but not
> compulsory). WP will track from usage."

Procurement becomes **project-level**: a purchase request's work package is
**optional** (selectable, not compulsory). Material is bought for the project,
received into the **on-site store**, and a work package's material cost is
attributed **when the WP withdraws (เบิก) from the store** — not at purchase.

**Doctrine reconciliation ([[prc-ops-wp-centric-principle]] — worth an ADR
amendment):** the work package stays the center for WORK and PROGRESS. PROCUREMENT
moves to the project level (into the store); WP _cost_ attribution moves to
**usage** (the เบิก/issue already prices material to the WP at moving-average cost,
spec 177/178). So the WP is still where cost lands — just at withdrawal, not buy.

## What already exists (half the flow is built)

- Supply plan lines are already WP-optional ("ทั้งโครงการ" in the grid editor).
- The store (spec 177): stock-in → on-hand (moving-avg) → **เบิก to a WP with
  custody**. spec 178 U4 already folds store issues into `wp_profit` materials at
  the issue (sell) price. **The "withdraw by WP, cost from usage" half is DONE.**

The missing link: getting procured material from the (project-level) plan **into the
store**, through the existing purchasing discipline.

## Phased plan (foundational — each phase is a unit; Phase 1 is the risky one)

**Phase 1 — purchase requests become WP-optional (the foundation + the RLS rewire).**

- `purchase_requests.work_package_id` → nullable; the PR form's WP becomes optional
  (a "ทั้งโครงการ / เข้าสโตร์" choice).
- **RLS (the careful part):** PR visibility is `can_see_wp`-scoped today. A WP-less
  PR needs a **project-scoped** visibility arm (project member / the project-view
  roles) — without widening WP-bound PR visibility. This is the security-sensitive
  piece; it gets its own pgTAP + a close review.
- `/requests` worklist + the WP-detail คำขอซื้อ tab handle a WP-less PR (it shows at
  the project level, not under a WP).

**Phase 2 — the supply plan generates project-level PRs.**

- `generate_purchase_requests_from_plan` drops the null-WP → 22023 guard; a
  whole-project plan line now converts to a WP-less PR (born-approved, as today).

**Phase 3 — receive into the store (the PO → store link, currently missing).**

- When a WP-less / store-destined PO line is received, it creates a `stock_receipt`
  (stock-in into the store at cost) instead of a WP delivery. This is the join
  between the purchasing flow and the store (today stock-in is manual/standalone).

**Phase 4 — cost integrity.**

- Ensure a WP-less PR's cost is NOT attributed to a WP at purchase (it's project /
  inventory cost) and is NOT double-counted once the material is issued to a WP
  (spec 178 already adds store issues to `wp_profit`). Reconcile the dashboard /
  wp_profit / GL so material cost lands once: as inventory at receipt, then as WP
  cost at เบิก.

## Why phased, not one-shot

Phase 1 reverses the WP-centric purchasing assumption and rewires PR RLS (a
security boundary). It deserves its own focused unit with a careful RLS review +
pgTAP, not a rushed build. Phases 2–4 build on it. An ADR should record the
doctrine amendment before Phase 1 lands.
