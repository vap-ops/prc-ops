# Spec 184 — Approval-type awareness (purchase requests + bank changes)

## Origin

Follow-up to spec 183. Operator: "All approvals need noti, but you can design
them separately as you see fit" → "both, one at a time" (after the spec-183
desktop hub-strip badge: this is the second item). Extends spec 183's awareness
pattern ([[183-approvals-awareness]]) from work-package approvals to the other
PM-tier approval flows.

## The flows (mapped)

| Flow                   | Table · "awaiting" status                     | Decider (RLS)     | Nav surface today                                 |
| ---------------------- | --------------------------------------------- | ----------------- | ------------------------------------------------- |
| WP approval (spec 183) | `work_packages` · `pending_approval`          | pm/super/director | ภาพรวม tab + dashboard card                       |
| Purchase request       | `purchase_requests` · `requested`             | pm/super/director | คำขอซื้อ (`/requests`) tab                        |
| Contractor bank change | `contractor_bank_change_requests` · `pending` | pm/super/director | **none** — only on `/contacts/[type]/[id]` detail |
| Consent                | —                                             | —                 | no approval queue (recorded, not approved)        |

`project_director` is on every relevant SELECT/UPDATE policy (migration
20260752, reconstructed from live catalog), so all three gate to `isManagerRole`
— same as the WP badge.

## Design rule

A flow that **has its own tab** gets a **count badge on that tab** (awareness
where you already go to act). A flow with **no nav surface** gets a **dashboard
card** (the dashboard is the PM home; that's where otherwise-invisible work
surfaces). So:

- WP (spec 183): tab badge (ภาพรวม) + card (its tab was removed → card is home).
- PR: **badge on the คำขอซื้อ tab** — the tab stays, just gains the count.
- Bank change: **dashboard card** — it has no tab at all today (the blind spot).

The count is "decisions YOU owe", so every badge/card is gated to the PM tier
(`isManagerRole`) — site_admin / procurement share the คำขอซื้อ tab but don't
decide, so no PR badge for them.

Consent: nothing to surface (no pending state). Out of scope.

## Units

### U1 — Purchase-request awaiting-decision badge on the คำขอซื้อ tab

- Generalize the self-fetching badge: extract a generic `SelfCountBadge`
  ({ load, position, label }) from spec 183's `PendingApprovalsBadge`; keep
  `PendingApprovalsBadge` as a thin wrapper (WP loader, default label) so the
  existing ภาพรวม wiring is unchanged. Add `PendingPurchaseDecisionsBadge`
  (loader = `purchase_requests` head-count where `status='requested'`, label
  "คำขอซื้อรอพิจารณา").
- `ApprovalsBadge` gains an optional `label` (the aria-label noun, default
  "รอตรวจ") so the PR badge reads correctly to screen readers.
- Wire `PendingPurchaseDecisionsBadge` onto the คำขอซื้อ tab in `BottomTabBar`
  (over the icon) and the `/requests` item in `HubNav` (inline), both gated
  `href==="/requests" && isManagerRole(role)`.
- Test-first: `SelfCountBadge`/label render; the PR loader query shape;
  formatBadgeCount already covered.

### U2 — Contractor bank-change awaiting-approval dashboard card

- Add `getPendingBankChangeCount(supabase)` (RLS-scoped head-count of
  `contractor_bank_change_requests` where `status='pending'`).
- A dashboard card (PM tier) under the รอตรวจ card: "การเปลี่ยนบัญชีรอการอนุมัติ"
  with the count, linking to the contractor list (`/contacts/subcontractors`)
  where the PM drills into the flagged contractor to decide. Hidden / calm when
  zero (mirrors the WP card's empty treatment), or omitted at zero to avoid
  dashboard clutter (decide during build).
- Test-first: the count helper; the card render (count + link, nothing at zero).

## Acceptance

- A PM sees, without hunting: WP approvals (spec 183), purchase requests awaiting
  decision (คำขอซื้อ tab badge), and bank changes awaiting approval (dashboard
  card — previously visible only on a contractor's detail page).
- Counts are RLS-scoped and gate to the PM tier; SA / procurement nav unchanged.
- `pnpm lint && pnpm typecheck && pnpm test` green.

## Notes

- No DB changes — all three counts are reads against existing tables/policies.
- A dedicated bank-change _queue page_ (vs. drilling from the contractor list) is
  a possible follow-up; U2 delivers the awareness count first.
- Worker (DC) bank changes: ADR 0062 U4c-2 (staged worker bank-change → PM
  approval) is not built yet; when it lands, its count folds into U2's card.
