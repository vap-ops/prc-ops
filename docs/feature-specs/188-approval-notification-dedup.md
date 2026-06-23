# Spec 188 — Approval-notification de-duplication (PR owns its tab)

**Operator (2026-06-23):** "PR approval notification — check for notification
redundancy. The notification showing on คำขอซื้อ and ภาพรวม is confusing."

## The redundancy

For the PM tier (PM / project_director / super_admin) a purchase request with
`status='requested'` was counted in **two** nav badges:

- **ภาพรวม** (รออนุมัติ) = `loadTotalPendingApprovals` = WP + **PR** + contractor-bank
  - worker-bank.
- **คำขอซื้อ** (รอพิจารณา) = `loadPendingPurchaseDecisions` = **PR** — the _same_
  `purchase_requests where status='requested'` query that fed the total's PR slice.

Same query, 100% overlap, on both the desktop hub strip and the phone bottom bar.
By-design per specs 184/185 (ภาพรวม = grand total, คำขอซื้อ = the PR subset), but the
badges gave no "subset-of" cue, so one pending PR read as two separate alerts. The
dashboard also surfaced PR a third time as an `AwarenessCard`.

## Decision (operator): "each tab owns its count"

A pending item is badged in **exactly one place** — the tab that owns the action.
PR owns the คำขอซื้อ tab, so PR leaves ภาพรวม entirely:

- `loadTotalPendingApprovals` drops the PR term → **WP + bank only** (the tabless
  approvals whose only home is the dashboard inbox).
- The dashboard's PR `AwarenessCard` (คำขอซื้อรอพิจารณา → /requests) is removed, so
  the ภาพรวม nav badge still equals the sum of the cards shown on the page.
- The คำขอซื้อ tab badge (`PendingPurchaseDecisionsBadge`) is **unchanged** — PR's
  single home.

Net: ภาพรวม badge = WP review + bank changes; คำขอซื้อ badge = PR. No double-count.

## Changes (code-only, no DB)

- `src/components/features/dashboard/pending-approvals-badge.tsx` —
  `loadTotalPendingApprovals` sums `[wp, bank, workerBank]` (PR removed).
- `src/app/dashboard/page.tsx` — removed the PR `AwarenessCard` + its
  `pendingPurchases` fetch + the now-unused `ShoppingCart` import.
- Deleted the now-dead `src/lib/approvals/pending-purchase-decisions.ts` (the
  dashboard was its only caller; the คำขอซื้อ badge uses the browser-client
  `loadPendingPurchaseDecisions` in the badge module).

Doctrine note: WP review and bank changes have no dedicated bottom tab, so they
correctly live on ภาพรวม; PR has the คำขอซื้อ tab, so it lives there. This refines
the "tabbed → tab badge, tabless → dashboard" rule from spec 183/185.
