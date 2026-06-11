# Spec 27 — Cancellation + PR running number

**Origin:** 2026-06-11 schema-gap analysis; operator picked the
top-priority pair ("proceed"). Decisions in ADR 0031.

## Part A — DB

1. Migration `20260614120000_add_cancelled_status.sql`:
   `alter type purchase_request_status add value 'cancelled' after
'rejected'` (own file — new enum value unusable in its own txn).
2. Migration `20260614120100_purchase_requests_cancellation_pr_number.sql`:
   - `cancelled_at timestamptz NULL`, `cancelled_by uuid NULL references
users(id)`, `cancellation_reason text NULL`;
   - CHECK `pr_cancel_shape (status <> 'cancelled' or cancelled_at is not null)`;
   - sequence `purchase_requests_pr_number_seq` + `pr_number bigint`
     backfilled by `requested_at` order, then NOT NULL + UNIQUE +
     DEFAULT nextval (sequence restarted above the backfill max);
   - AFTER UPDATE audit trigger WHEN approved→cancelled (action
     'update', payload per ADR 0031).
3. pgTAP: file 17 enum pin → seven labels; NEW file 22 — columns/CHECK/
   unique pins, backfill monotonic vs requested_at, PM role-sim cancel
   lives + status flips + audit row written, cancel on a requested row
   affects 0 rows (two-layer guard), SA cancel affects 0 rows (no UPDATE
   policy), cancelled rows invisible under the appsheet stage gates
   (qual already excludes by listing statuses).

## Part B — App

- `PURCHASE_REQUEST_STATUS_LABEL.cancelled = "ยกเลิกแล้ว"`; pill =
  muted zinc (closed/inactive slot); tracker: `cancelled` renders stages
  ส่งคำขอ + อนุมัติ as done, the remaining stages muted `cancelled`
  state, no red (it is an administrative close, not a refusal) —
  failing tracker test first.
- New server action `cancelPurchaseRequest({id})` (PM/super): two-layer
  guard `.eq('status','approved')`, sets status/cancelled_at/
  cancelled_by. Thai errors mirror decide.
- UI: approved cards show ยกเลิกคำขอ (decider-only, `window.confirm`
  ยกเลิกคำขอซื้อนี้หรือไม่?) — new small client component.
- PR number: `PR-{String(pr_number).padStart(4,"0")}` mono prefix on
  `/requests` cards and the WP-inline list (selects gain `pr_number`).

## Operator follow-ups

- AppSheet column config: mark `pr_number`, `cancelled_at`,
  `cancelled_by`, `cancellation_reason` READ-ONLY before the next row
  save (go-live §2a rule), then re-run Tier-2 smoke.

## Out of scope

Requester self-cancel (recorded seam), cancellation-reason UI prompt,
post-purchase cancellation, suppliers table (next queue item).

## Verification checklist

- [ ] pgTAP green post-push; file 17 pin updated; file 22 added.
- [ ] Tracker test RED→GREEN; lint/typecheck/unit green.
- [ ] Manual: cancel an approved request as PM → card shows ยกเลิกแล้ว,
      muted tracker; PR-numbers visible on cards.
