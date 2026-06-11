# ADR 0031 — Request cancellation + PR running number

**Status:** Accepted — 2026-06-11. Spec 27. From the 2026-06-11 schema-gap
analysis (operator: "proceed" on the top-priority pair).

## Decision 1 — `cancelled` status (approved-stage only, decider-only)

- Enum gains `cancelled` after `rejected` (terminal grouping). Lifecycle:
  `approved → cancelled` is the ONLY legal entry; `requested` rows that
  shouldn't proceed already have `rejected`, and post-purchase rows
  involve money/goods in motion — un-buying is a procurement workflow,
  not a status flip.
- **Writer: PM/super via the existing open UPDATE policy** — the exact
  `decidePurchaseRequest` pattern (JS predicate + SQL
  `.eq('status','approved')` two-layer guard). site_admin gets NO write
  path (no UPDATE policy exists for SA; a requester-cancel RPC is a
  recorded seam, not built — the requester phones the PM, which matches
  how rejection works today).
- Facts: `cancelled_at timestamptz`, `cancelled_by uuid → users`,
  `cancellation_reason text NULL` (column ships; UI prompt deferred).
  CHECK `pr_cancel_shape`: a cancelled row must carry `cancelled_at`.
- **Audit:** new AFTER UPDATE trigger
  (`purchase_requests_audit_cancellation`, WHEN approved→cancelled)
  writes action `'update'` with payload
  `{principal, transition: ['approved','cancelled'], cancelled_by,
cancellation_reason}` — third use of the no-new-audit-action stance
  (ADR 0027/0030 precedent). Disjoint WHEN vs the decision trigger
  (old.status='requested') and the AppSheet correction arm (which
  requires a GRANTED column diff; status alone never matches).
- **AppSheet:** cancelled rows drop out of appsheet_writer's stage-gated
  SELECT/UPDATE policies automatically — procurement can no longer see
  or act on them. Deliberate: a cancelled requisition must vanish from
  the buy queue.

## Decision 2 — `pr_number` running number

- `pr_number bigint NOT NULL UNIQUE`, fed by a dedicated sequence;
  existing rows backfilled in `requested_at` order so history reads
  chronologically. Display format `PR-{zero-padded-4}` is UI-only — the
  DB stores the bare integer (no year segment: pilot volume makes
  year-reset ceremony pointless, and a TEXT format column would invite
  drift).
- Default `nextval(...)` — INSERT path untouched (column-scoped INSERT
  grants don't list it; default fills it).
- **Operational requirement:** `pr_number`, `cancelled_at`,
  `cancelled_by`, `cancellation_reason` must be marked READ-ONLY in the
  AppSheet column config before the next AppSheet row save (AppSheet
  UPDATEs SET every editable column → un-granted columns fail saves
  wholesale, 42501 — the standing go-live §2a rule).

## Consequences

- Tracker/pills/labels gain the cancelled state (exhaustive switches
  force the updates at typecheck).
- pgTAP file 17's enum pin updates to seven values; new file 22 covers
  columns, backfill monotonicity, the two-layer cancel guard, the audit
  row, and SA's lack of a write path.
- Requester-side self-cancel RPC: recorded seam for a future spec.
