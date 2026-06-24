# Spec 195 — project-level purchasing (supply plan → store → เบิก)

**Status:** DESIGN — operator-approved direction 2026-06-24, phased build pending.

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
