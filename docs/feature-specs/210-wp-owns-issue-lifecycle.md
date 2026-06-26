# Spec 210 — the WP owns the เบิก lifecycle; the store console is inventory-only

**Status:** SHIPPED — 2026-06-27. Trigger: operator review of the SA daily loop
flagged "เบิก lives in two places" as the sharpest daily-UX friction. Code-only.

## The friction

Spec 208 U2 already moved เบิก **creation** to one place — the WP detail `เบิกของ`
tab (`WpIssueStock`); the store console's per-row button is now `ตรวจนับ` only. But
the **management** of an issue stayed split:

| Action on a เบิก | WP `เบิกของ` tab | Store console (`เบิกล่าสุด`) |
| ---------------- | ---------------- | ---------------------------- |
| create           | ✅               | —                            |
| history          | ✅ (this WP)     | ✅ (project-wide)            |
| undo (reverse)   | ✅               | ✅                           |
| confirm-on-behalf | ❌              | ✅ (only here)               |

So a เบิก made on WP-12 is reviewable and reversible from **two** screens, and to
attest receipt on a worker's behalf the SA had to leave the WP and go to the store
console. Two reverse buttons for the same row; the lifecycle is split.

## Operator decision (2026-06-27, AskUserQuestion)

**The WP owns its เบิก end-to-end.** Create + review + undo + confirm-on-behalf all
live on the WP it belongs to. The store console **drops `เบิกล่าสุด`** and becomes
pure inventory: on-hand · `รับเข้า`ล่าสุด (receipts + their reverse — inventory-*in*,
stays) · per-row `ตรวจนับ` · `ตรวจนับทั้งคลัง` · P&L.

Trade-off accepted: there is no longer a single project-wide เบิก list. If a
"everything that left the คลัง this week" view is wanted later, it returns as a
**read-only report**, not as an action surface on the console (separate spec).

## Changes (code-only — same RPCs, same gates, no migration)

- **`WpIssueStock`** (`src/components/features/store/wp-issue-stock.tsx`): each recent
  เบิก row gains a `ยืนยันรับแทน` (confirm-on-behalf) control, rendered when the issue
  names a receiver who is still `รอรับ` (`receiverName && !receivedAt`). Calls the
  existing `confirmStockIssueOnBehalf` action → `confirm_stock_issue_on_behalf` RPC
  (which already enforces separation-of-duties: the issuer is blocked and the error
  maps cleanly). The row already had history + reverse, so this is the only addition.
- **`StoreManager`** (`src/components/features/store/store-manager.tsx`): the whole
  `เบิกล่าสุด` block is removed (issues list + pending/received badge + confirm-on-behalf
  + issue-reverse). The dead `issues` prop, the `IssueRow` export, and the now-unused
  `confirmStockIssueOnBehalf` / `reverseStockIssue` imports go with it. `รับเข้า`,
  `ตรวจนับ`, count history, and receipt-reverse are untouched.
- **Project store page** (`src/app/projects/[projectId]/store/page.tsx`): drops the
  `stock_issues` fetch, the `issues` prop, and the `IssueRow` import.

## Verification

- `pnpm lint && pnpm typecheck && pnpm test` green.
- `wp-issue-stock.test.tsx`: new `confirm-on-behalf (spec 210)` block — offers
  `ยืนยันรับแทน` on a pending named issue, hides it once received / when no receiver,
  and calls `confirmStockIssueOnBehalf`.
- `store-manager.test.tsx`: the relocated เบิก-history / confirm-on-behalf /
  issue-reverse tests are removed; a `no เบิก surface (spec 210)` guard asserts the
  console renders no `เบิกล่าสุด` and no `ยืนยันรับแทน`. Receipt-reverse, count, and
  รับเข้า tests stay.

Builds on specs 177 (store), 178 (issue/confirm-on-behalf), 208 U2 (เบิก to the WP tab).
