# Spec 253 — Finance project drill: `/accounting/projects/[projectId]`

**Status:** APPROVED (operator-aligned design 2026-07-03; capstone of the Finance build 249–253)
**Origin:** Finance's asks all converge on "per project, show me the money story". Specs 249–252 create the data + access; this spec is the surface. Also finally surfaces `wp_profit()` (built spec 178 U4, zero UI until now).

## Goals

One project page answering Finance end-to-end:

1. **Revenue funnel:** quotation(s) → client PO(s) → contract + งวดเบิก → billings → receipts (incl. unallocated advances) → outstanding.
2. **Cost:** labor (own/DC) · materials (**committed vs actual**) · subcontracts (agreed/paid) · equipment.
3. **P&L:** per-WP `wp_profit()` rows + project totals.

## Routes (all Server Components; access = ACCOUNTING_ROLES ∪ PM_ROLES read)

- **`/accounting/projects`** — project list: each row = name/code + compact funnel figures (billed · received · outstanding) + cost total. Link from the `/accounting` hub.
- **`/accounting/projects/[projectId]`** — the drill, three sections:

**Revenue (top).** Quotation list + status chips + create/edit (PM_ROLES; spec 250 RPCs) · client PO list + form · contract card + งวด table (per-งวด amount/billed/received, Σ-vs-value warning badge) · billings list (status, per-billing coverage from spec 249) · receipts block incl. "เงินรับล่วงหน้า (ยังไม่ตัดบิล)" + record/re-allocate (PM_ROLES) · headline tiles: billed / received / outstanding / advances.

**Cost (middle).** Labor: own vs DC totals (reuse `aggregateLaborCost` / `wp_labor_costs`) · Materials: **committed** (open PO deliveries not yet received + spend-status PRs with amounts — reuse/extend `src/lib/dashboard/spend.ts` helpers) vs **actual** (WP-level materials + store issues − returns, same netting as the dashboard) + store pool on hand · Subcontracts: deals table + payments drawer (spec 251 blocks render here) · Equipment: from `wp_profit` equipment figures.

**P&L (bottom).** Per-WP table via `wp_profit()` (budget · labor · materials · equipment · subcon future-note · profit) + project totals row. Gate admits accounting after spec 252.

**Empty states matter** (slow-contract case): every block renders a quiet "ยังไม่มีข้อมูล" + (for PM_ROLES) its create action — receipts can exist while quotation/PO/contract blocks are all empty; nothing looks broken.

## Implementation notes

- Pure view-model layer `src/lib/accounting/project-drill.ts` (unit-tested): assembles funnel + cost + P&L models from the readers; NO business math in components.
- Reads: RLS server client where arms exist; admin client behind the app gate for money reads that lack arms (same shape as `/payroll`/`/dashboard` today — spec 252 posture).
- Committed-materials definition (v1, documented in-code): Σ undelivered `purchase_order_deliveries` line values + Σ `purchase_requests.amount` in spend statuses not yet received; PRs with NULL amount excluded and COUNTED separately as "รอราคา N รายการ" so Finance knows the blind spot.
- Thai labels via `labels.ts` for any term used 2+ places (SSOT rule).
- Mobile-first per Field-First tokens; horizontal-scroll strips get the `[touch-action:pan-x_pinch-zoom]` pair (guard test exists).

## Units

| Unit | Lane | Content                                                                                          |
| ---- | ---- | ------------------------------------------------------------------------------------------------ |
| U1   | code | View-model layer + `/accounting/projects` list + drill page with revenue section (250/249 forms) |
| U2   | code | Cost + P&L sections (labor/materials committed-vs-actual/subcon/equipment + wp_profit table)     |

No schema. Depends on 249–252 merged.

Out of scope: PDF export of the drill; time-series charts; per-งวด reminders/notifications; PEAK sync of any new entity.

## Verification checklist

- [ ] Unit: view-model assembly (funnel with gaps — receipts-only project; committed-vs-actual math incl. NULL-amount PR bucket; per-งวด rollup threading).
- [ ] Render tests: role affordances (accounting sees no create buttons; PM sees them); empty states.
- [ ] Real-browser (dev-preview): drill renders for a real project at 375px; accounting + super_admin both load it.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green.
