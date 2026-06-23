# Spec 185 — One number for all approvals (unified pending on the home)

## Origin

Operator, after specs 183 + 184: "proceed" → "design the process yourself."
The capstone of the approvals-awareness arc. The operator's ORIGINAL ask (spec 183) was "notification of how many **Approvals** are pending" — a single total.
Specs 183/184 delivered per-type awareness (WP card + ภาพรวม badge, PR tab badge,
bank-change card). This unifies them into one number.

## Why not a header bell

The natural "unified inbox" pattern is a header bell with a total count. But this
app has **no global header** — the persistent chrome is the BottomTabBar (phone) +
HubNav strip (desktop), and pages render their own headers (some none, e.g.
/dashboard). A bell has no consistent home. So instead of inventing one, fold the
total into the existing idiom: the ภาพรวม (home) nav badge + the dashboard as the
complete inbox.

## Design

- The **ภาพรวม nav badge** = the **total** pending across all three PM-tier
  approval types (WP `pending_approval` + PR `requested` + contractor bank-change
  `pending`), not WP-only. Relabelled "รออนุมัติ". So the number on the main menu
  answers the original question: how many approvals are pending, total.
- The **dashboard** is the complete inbox: the รอตรวจ hero card (WP, always shown)
  - the PR card + the bank-change card (each shown when pending). Tapping ภาพรวม
    (or its badge) lands here and shows the breakdown that sums to the badge.
- The คำขอซื้อ tab keeps its PR-only badge (per-surface drill-down signal) — the
  ภาพรวม total is the aggregate, the คำขอซื้อ badge is the subset on its own
  worklist. Consistent drill-down semantics.

## Units

### U1 — Complete the dashboard inbox (generic awareness card + PR card)

- Generalize the awareness card: extract `AwarenessCard({ count, label, href,
icon })` (renders only when count>0, attention palette, links to its decision
  surface) from `BankChangeAwarenessCard`; the bank card and the new PR card both
  use it. Remove the now-subsumed `BankChangeAwarenessCard`.
- Add `getPendingPurchaseDecisionCount(supabase)` (server, RLS-scoped head-count
  of `purchase_requests` at `requested`).
- Dashboard (PM tier): render the PR awareness card (→ `/requests`) and the
  bank-change card (→ `/contacts/subcontractors`) under the รอตรวจ hero, via the
  generic card.
- Test-first: `AwarenessCard` (nothing at 0; count+label+link at >0).

### U2 — ภาพรวม badge shows the total of all three

- Generalize the badge loader: the ภาพรวม badge sums WP + PR + bank pending counts
  (three RLS-scoped head-counts), relabelled "รออนุมัติ". The คำขอซื้อ badge stays
  PR-only.
- Test-first: a pure `sumApprovalCounts` helper (the badge loader composes it).

## Acceptance

- The number on the ภาพรวม nav item (both surfaces) = total pending approvals
  across WP + PR + bank, for the PM tier.
- The dashboard shows the breakdown (WP hero + PR + bank cards) that reconciles
  with that total.
- SA / procurement nav unchanged; no badge/card for non-deciders.
- `pnpm lint && pnpm typecheck && pnpm test` green. No DB.

## Notes

- Worker-DC bank changes (ADR 0062 U4c-2) are not built; when they land, fold
  their count into both the total and a dashboard card.
- A dedicated `/approvals` route was considered and rejected: with all three types
  on the dashboard (the PM home), a separate page would duplicate it.
