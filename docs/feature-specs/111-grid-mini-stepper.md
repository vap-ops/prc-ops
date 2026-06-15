# Spec 111 — Compact process mini-bar in the grid status cell

**Status:** COMPLETE (2026-06-15; no DB change; acceptance = procurement-user tablet/PC).
**Driver:** operator noticed the desktop grid's สถานะ cell shows only a pill, while the process
bar (`PurchaseRequestTracker`) appears on the cards, the detail page, and the spec-109 drawer.
Decision (AskUserQuestion): **add a compact mini-bar** to the grid cell — the grid-density echo of
the stepper everyone else sees. (Full stepper in the cell was rejected: a ~20% table column can't
fit 5 labeled stages + dates; the bands already carry stage; rejected/cancelled don't fit a linear
bar — the pill names all 8 states.)

## What ships (app-only, no schema/migration)

- **`src/lib/purchasing/order-stages.ts`** (NEW, pure) — `ORDER_STAGES` (the five lifecycle
  stages) + `orderStageStates(status)` → per-stage `{ stage, state, isCurrent, reached }`
  (`state`: done | pending | rejected | cancelled). This is exactly the stage-state logic that was
  inline in `PurchaseRequestTracker`; extracted so the tracker and the new mini-bar share ONE
  source of truth (no duplicated `STATUS_RANK`).
- **`src/components/features/purchase-request-tracker.tsx`** — refactored to consume
  `orderStageStates` (and neighbour states for connector fill); the `data-stage` / `data-state` /
  label / date / ETA output is byte-for-byte the same (the spec-22 tracker test stays green).
- **`src/components/features/purchase-mini-stepper.tsx`** (NEW) — a compact, **decorative**
  (`aria-hidden`) 5-segment progress bar from `orderStageStates`: reached = done-strong,
  rejected = danger, un-reached = edge. No labels, no dates. The pill remains the accessible status.
- **`src/components/features/procurement-grid.tsx`** — the สถานะ cell renders the mini-bar above
  the existing pill + ETA. (Grid only — cards/detail/drawer keep the full tracker.)

## Why a shared helper (not a second rank map)

`PurchaseRequestTracker` already encodes the stage-state rules (rank, rejected terminal, cancelled
muting). Duplicating them in the mini-bar would be two sources of truth for the same lifecycle. The
spec-22 tracker test pins the data contract, so extracting the logic and pointing both components
at it is safe and consolidating (spec-65 ethos).

## Tests

- **TDD:** `tests/unit/order-stages.test.ts` first (RED) — the per-stage state for requested /
  in-flight / delivered / rejected / cancelled (mirrors the tracker test at the data level).
- The existing `purchase-request-tracker.test.tsx` is the regression guard for the refactor.
- The mini-bar is decorative presentational over the tested helper → checklist.

## Acceptance

Procurement user on a PC: each grid row's สถานะ cell shows a small 5-segment bar filled to the
record's stage (plus the pill + ETA). Cards, detail, drawer unchanged. The spec-22 tracker behaves
identically.

## Seams (recorded)

- The mini-bar is a 5-segment fill (no per-stage dots/labels) — deliberately minimal for density.
- rejected/cancelled show as a short/red bar; the pill carries the exact terminal word.
